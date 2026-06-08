"""
tensornets.tensor_rag.rag
==========================
TensorRAG: unified facade aggregating all retrieval sources.

Usage (Python)
--------------
from tensornets.tensor_rag.rag import TensorRAG
rag = TensorRAG(db_path="data/dbs/care_circle_dev.db")
rag.init()

context_str = rag.query_context(
    text="patient is experiencing cravings and low mood",
    physio_dict={"hrv_rmssd_ms": 18.0, "stress_index": 0.78},
    k=5,
    sources=["clinical_kb", "episode_memory"],
)
# → inject context_str into the companion system prompt

Usage (FastAPI) — see tensornets/server.py for the /rag/query endpoint.

Sources
-------
"clinical_kb"    : ClinicalKnowledgeBase  (always available)
"episode_memory" : EpisodeMemoryStore     (available after training started)
All sources queried simultaneously; results merged and re-ranked.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

import numpy as np

from tensornets.tensor_rag.index        import RetrievedChunk
from tensornets.tensor_rag.kb_store     import ClinicalKnowledgeBase
from tensornets.tensor_rag.episode_store import EpisodeMemoryStore

log = logging.getLogger(__name__)


class TensorRAG:
    """
    Unified TensorRAG facade.

    Parameters
    ----------
    db_path   : path to SQLite DB (for EpisodeMemoryStore)
    data_dir  : root directory for persisted indexes
    """

    def __init__(
        self,
        db_path:  str   = "data/dbs/care_circle_dev.db",
        data_dir: str   = "data/rag",
    ) -> None:
        data_dir = Path(data_dir)
        data_dir.mkdir(parents=True, exist_ok=True)

        self._kb  = ClinicalKnowledgeBase(persist_path=data_dir / "clinical_kb.index")
        self._eps = EpisodeMemoryStore(
            db_path      = db_path,
            persist_path = data_dir / "episode_memory.index",
        )
        self._ready = False

    def init(self) -> dict:
        """
        Load all retrieval sources.  Call once at startup.
        Returns a status dict.
        """
        kb_count  = self._kb.load()
        eps_count = self._eps.bulk_import()
        self._ready = True
        status = {
            "clinical_kb_entries":    self._kb._index.size,
            "episode_memory_entries": self._eps._index.size,
            "new_kb":                 kb_count,
            "new_episodes":           eps_count,
        }
        log.info("TensorRAG ready: %s", status)
        return status

    # ── Episode ingestion (called by A3C worker) ──────────────────────────────

    def add_episode(self, summary: dict) -> None:
        """Index a completed episode summary. Thread-safe."""
        self._eps.add_episode(summary)

    # ── Query ─────────────────────────────────────────────────────────────────

    def query(
        self,
        text:         str,
        physio_fp:    Optional[np.ndarray] = None,
        physio_dict:  Optional[dict]       = None,
        k:            int                  = 5,
        sources:      Optional[list[str]]  = None,
        arm_filter:   Optional[str]        = None,
    ) -> list[RetrievedChunk]:
        """
        Retrieve top-k chunks from all requested sources.

        Parameters
        ----------
        text         : query text
        physio_fp    : MPS bond fingerprint (from mps.bond_fingerprint().numpy())
        physio_dict  : fallback physio dict if no MPS available
                       {hrv_rmssd_ms, stress_index, sleep_quality, therapeutic_stage}
        k            : number of final results
        sources      : list of "clinical_kb" | "episode_memory"
                       (default: all)
        arm_filter   : if set, filter episode_memory results to this A3C arm

        Returns
        -------
        list[RetrievedChunk] sorted by composite score, descending
        """
        if not self._ready:
            log.warning("TensorRAG.query called before init() — returning empty")
            return []

        sources = sources or ["clinical_kb", "episode_memory"]
        per_source_k = k + 5  # over-fetch before merging

        all_results: list[RetrievedChunk] = []

        if "clinical_kb" in sources:
            all_results.extend(self._kb.query(
                text        = text,
                physio_fp   = physio_fp,
                physio_dict = physio_dict,
                k           = per_source_k,
            ))

        if "episode_memory" in sources and self._eps._index.size > 0:
            all_results.extend(self._eps.query(
                text        = text,
                physio_fp   = physio_fp,
                physio_dict = physio_dict,
                k           = per_source_k,
                arm_filter  = arm_filter,
            ))

        # Re-rank combined results by composite score
        all_results.sort(key=lambda r: r.score, reverse=True)

        # Deduplicate by chunk_id
        seen:        set[str]       = set()
        unique:      list[RetrievedChunk] = []
        for r in all_results:
            cid = r.chunk.chunk_id
            if cid not in seen:
                seen.add(cid)
                unique.append(r)
            if len(unique) >= k:
                break

        return unique

    def query_context(
        self,
        text:         str,
        physio_fp:    Optional[np.ndarray] = None,
        physio_dict:  Optional[dict]       = None,
        k:            int                  = 5,
        sources:      Optional[list[str]]  = None,
        arm_filter:   Optional[str]        = None,
        max_chars:    int                  = 2000,
    ) -> str:
        """
        Convenience wrapper: retrieves chunks and formats them as a
        context string suitable for injection into an LLM prompt.

        Returns
        -------
        str   — formatted context block, or "" if nothing retrieved
        """
        results = self.query(
            text        = text,
            physio_fp   = physio_fp,
            physio_dict = physio_dict,
            k           = k,
            sources     = sources,
            arm_filter  = arm_filter,
        )

        if not results:
            return ""

        lines = ["[TensorRAG Context — retrieved per patient physiological state]"]
        char_count = 0
        for i, r in enumerate(results, 1):
            src    = r.chunk.metadata.get("source", "?")
            score  = r.score
            chunk  = r.chunk.text
            if char_count + len(chunk) > max_chars:
                chunk = chunk[:max(50, max_chars - char_count)] + "..."
            lines.append(f"[{i}] ({src}, score={score:.3f})\n{chunk}")
            char_count += len(chunk)
            if char_count >= max_chars:
                break

        return "\n\n".join(lines)

    # ── Stats ─────────────────────────────────────────────────────────────────

    def stats(self) -> dict:
        return {
            "clinical_kb":     self._kb._index.stats(),
            "episode_memory":  self._eps._index.stats(),
            "ready":           self._ready,
        }
