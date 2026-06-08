"""
tensornets.tensor_rag.episode_store
=====================================
EpisodeMemoryStore: index completed A3C training episodes.

Each episode summary from htn_benchmark_episodes is ingested as a chunk.
The text is a narrative summary of what happened; the physio_fp is
derived from the episode's mean stress/HRV metrics.

When the A3C worker encounters a new episode, it queries this store for
similar past episodes (same physiological zone, same scenario type) to
use as few-shot context.

UPDATE STRATEGY
---------------
- At training start: bulk-import all completed episodes (resume mode)
- During training: add each episode immediately after it completes
- Save every SAVE_EVERY_N new episodes
"""

from __future__ import annotations

import logging
import sqlite3
import time
from pathlib import Path
from typing import Optional

import numpy as np

from tensornets.tensor_rag.index     import PhysioConditionedIndex, RetrievedChunk
from tensornets.tensor_rag.encoder   import physio_features

log = logging.getLogger(__name__)

INDEX_PATH    = Path("data/rag/episode_memory.index")
SAVE_EVERY_N  = 25   # persist after every N new additions
SOURCE_TAG    = "episode_memory"


class EpisodeMemoryStore:
    """
    Indexes completed A3C episode summaries for TensorRAG retrieval.

    Provides relevant past episodes as few-shot examples, conditioned on
    the current physiological state AND the current query (scenario text).
    """

    def __init__(self, db_path: str, persist_path: Optional[Path] = None) -> None:
        self._db_path  = db_path
        self._index    = PhysioConditionedIndex(
            persist_path  = persist_path or INDEX_PATH,
            text_weight   = 0.55,
            physio_weight = 0.35,
            recency_weight= 0.10,
        )
        self._n_since_save = 0
        self._indexed_ids: set[str] = set()   # episode_ids already in the index

    # ── Bulk import ───────────────────────────────────────────────────────────

    def bulk_import(self, limit: int = 2000) -> int:
        """
        Import up to `limit` completed episodes from the DB.
        Skips episodes already in the index.
        Returns number added.
        """
        try:
            con  = sqlite3.connect(self._db_path)
            rows = con.execute(f"""
                SELECT e.episode_id, e.arm, e.scenario_id,
                       e.goal_achieved, e.cumulative_reward,
                       e.stress_auc, e.trust_delta_final,
                       e.summary, e.completed_at
                FROM htn_benchmark_episodes e
                WHERE e.completed_at IS NOT NULL
                  AND e.summary IS NOT NULL
                ORDER BY e.completed_at DESC
                LIMIT {limit}
            """).fetchall()
            con.close()
        except Exception as exc:
            log.warning("EpisodeMemoryStore bulk_import DB error: %s", exc)
            return 0

        added = 0
        for ep_id, arm, scenario_id, goal, reward, stress_auc, trust_delta, summary_json, completed_at in rows:
            if ep_id in self._indexed_ids:
                continue
            self._add_episode_row(
                ep_id, arm, scenario_id,
                goal, reward, stress_auc, trust_delta,
                summary_json, completed_at
            )
            added += 1

        if added:
            self._index.save()
            log.info("EpisodeMemoryStore: bulk imported %d episodes (%d total)", added, self._index.size)
        return added

    def add_episode(self, summary: dict) -> None:
        """
        Add one episode summary dict (as returned by worker.run_episode()).

        Parameters
        ----------
        summary : dict with keys episode_id, arm, scenario_id, goal_achieved,
                  cumulative_reward, stress_auc, mean_reward, genuine_metrics, ...
        """
        ep_id       = summary.get("episode_id", "")
        arm         = summary.get("arm", "")
        scenario_id = summary.get("scenario_id", "")
        goal        = summary.get("goal_achieved", False)
        reward      = summary.get("cumulative_reward", 0.0)
        stress_auc  = summary.get("stress_auc")
        trust_delta = summary.get("trust_delta_final")
        gm          = summary.get("genuine_metrics", {}) or {}

        # Build narrative text
        goal_str   = "ACHIEVED" if goal else "not achieved"
        stress_str = f"{stress_auc:.3f}" if stress_auc else "?"
        trust_str  = f"{trust_delta:+.3f}" if trust_delta is not None else "?"
        n_turns    = summary.get("n_turns", "?")
        stage_str  = f"stage_delta={gm.get('change_stage_delta','?')}"
        synthetic_dropout = summary.get("synthetic_dropout", False)

        text = (
            f"[{arm}] {scenario_id}: goal {goal_str} in {n_turns} turns. "
            f"Reward={reward:.3f}, stress_auc={stress_str}, trust_delta={trust_str}. "
            f"{stage_str}. "
            + ("Patient dropped out early. " if synthetic_dropout else "")
            + f"Scenario notes: {summary.get('session_goal','')[:120]}"
        )

        # Physio fingerprint from summary
        physio_dict = self._physio_from_summary(summary)
        physio_fp   = physio_features(**physio_dict)

        self._index.add(
            text      = text,
            physio_fp = physio_fp,
            metadata  = {
                "source":      SOURCE_TAG,
                "episode_id":  ep_id,
                "arm":         arm,
                "scenario_id": scenario_id,
                "goal":        goal,
                "reward":      reward,
            },
            ts = summary.get("completed_at") or time.time(),
        )
        self._indexed_ids.add(ep_id)
        self._n_since_save += 1

        if self._n_since_save >= SAVE_EVERY_N:
            self._index.save()
            self._n_since_save = 0

    def query(self, text: str, physio_fp=None, physio_dict: Optional[dict] = None,
              k: int = 3, arm_filter: Optional[str] = None) -> list[RetrievedChunk]:
        """Retrieve similar past episodes."""
        results = self._index.query(
            text       = text,
            physio_fp  = physio_fp,
            physio_dict= physio_dict,
            k          = k * 2 if arm_filter else k,
        )
        if arm_filter:
            results = [r for r in results if r.chunk.metadata.get("arm") == arm_filter]
        return results[:k]

    # ── Private helpers ───────────────────────────────────────────────────────

    def _add_episode_row(self, ep_id, arm, scenario_id, goal, reward,
                         stress_auc, trust_delta, summary_json, completed_at):
        if ep_id in self._indexed_ids:
            return
        import json as _json
        summary = {}
        if summary_json:
            try:
                summary = _json.loads(summary_json)
            except Exception:
                pass

        goal_str   = "ACHIEVED" if goal else "not achieved"
        stress_str = f"{stress_auc:.3f}" if stress_auc else "?"
        trust_str  = f"{trust_delta:+.3f}" if trust_delta is not None else "?"
        gm         = summary.get("genuine_metrics", {}) or {}
        stage_str  = f"stage_delta={gm.get('change_stage_delta','?')}"

        text = (
            f"[{arm}] {scenario_id}: goal {goal_str}. "
            f"Reward={reward:.3f}, stress_auc={stress_str}, trust_delta={trust_str}. "
            f"{stage_str}."
        )

        physio_dict = self._physio_from_summary(summary)
        physio_fp   = physio_features(**physio_dict)

        self._index.add(
            text      = text,
            physio_fp = physio_fp,
            metadata  = {
                "source":      SOURCE_TAG,
                "episode_id":  ep_id,
                "arm":         arm,
                "scenario_id": scenario_id,
                "goal":        bool(goal),
                "reward":      float(reward or 0),
            },
            ts = float(completed_at or 0) / 1000.0,
        )
        self._indexed_ids.add(ep_id)

    @staticmethod
    def _physio_from_summary(summary: dict) -> dict:
        """Extract physio features from an episode summary dict."""
        gm = summary.get("genuine_metrics", {}) or {}
        return {
            "hrv_ms":            float(gm.get("final_hrv_ms",    35.0) or 35.0),
            "stress_index":      float(gm.get("final_stress",     0.3) or gm.get("mean_stress", 0.3) or 0.3),
            "sleep_quality":     1.0,
            "therapeutic_stage": float(gm.get("final_stage_idx",  0.0) or 0.0) / 5.0,
        }
