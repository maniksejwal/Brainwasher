"""
tensornets.a3c.node_client
==========================
Centralised Python client for all HTTP calls to the Node.js companion server
(default: http://localhost:8247).

Why this module exists
----------------------
Prior to this module, HTTP utility code was duplicated in four separate files:
  - arms.py          (private _http_post + _COMPANION_URL / _TENSORNETS_URL)
  - synthetic_patient.py  (own copy of _http_post + _TENSORNETS_URL)
  - train.py         (private _db_post calling /api/benchmarks/*)
  - worker.py        (new turn-logging call, no HTTP utilities of its own)

This violates the same layered/tiered principle the JS side already follows
(routes → db/queries → db/db.js).  Here Python follows the same discipline:

  train.py     ──┐
  arms.py      ──┤→  node_client.py  →  Node.js REST API  →  SQLite (via db/)
  worker.py    ──┘

Structure
---------
1. URL / env configuration  (NODE_URL, TENSORNETS_URL)
2. _http_post()             core retry-once POST utility
3. Benchmark DB helpers     one function per Node.js /api/benchmarks/* endpoint
4. Companion API helpers    oldschool arm → /api/benchmark/message
5. Scenario helpers         load scenarios from /api/training/scenarios

All functions are non-fatal by default: they log a warning and return {} on
failure.  Callers that need to raise should check the returned dict explicitly
(e.g. ``r.get("run_id") or raise ...``).

References
----------
- routes/benchmarks.js   — Node.js endpoint definitions
- db/queries_benchmarks.js — SQL layer that the routes call
- tensornets/server.py   — FastAPI server (LLM/MCTS calls stay in arms.py
                           and synthetic_patient.py; they use TENSORNETS_URL)
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

# ── URL configuration ─────────────────────────────────────────────────────────
# Both vars are read at import time; override via environment before starting
# training if the servers are on different hosts.
NODE_URL        = os.environ.get("COMPANION_URL",   "http://localhost:8247")
TENSORNETS_URL  = os.environ.get("TENSORNETS_URL",  "http://localhost:8765")


# ── Core HTTP utility ─────────────────────────────────────────────────────────

def http_post(url: str, payload: dict, timeout: float = 10.0) -> dict:
    """
    Minimal synchronous HTTP POST — no external dependencies (urllib only).

    Retries once on transient failure (connection reset, timeout) with a 1.5 s
    back-off.  Raises ``ConnectionError`` after both attempts fail so callers
    can decide whether to suppress or propagate.

    Args:
        url:     Full URL including scheme and path.
        payload: Dict serialised to JSON.
        timeout: Per-attempt timeout in seconds.

    Returns:
        Parsed JSON response dict.

    Raises:
        ConnectionError: If both attempts fail.
    """
    import urllib.request as _req

    data     = json.dumps(payload).encode()
    request  = _req.Request(url, data=data,
                            headers={"Content-Type": "application/json"})
    last_exc: Exception | None = None
    for attempt in range(2):
        try:
            with _req.urlopen(request, timeout=timeout) as resp:
                return json.loads(resp.read())
        except Exception as exc:
            last_exc = exc
            if attempt == 0:
                time.sleep(1.5)
    raise ConnectionError(f"POST {url} failed: {last_exc}") from last_exc


# ── Internal non-fatal wrapper ────────────────────────────────────────────────

def _node_post(path: str, payload: dict, timeout: float = 5.0) -> dict:
    """
    POST to a Node.js /api/benchmarks/* path.  Non-fatal: logs a warning and
    returns {} on failure so training is never blocked by a DB outage.
    """
    url = f"{NODE_URL}/api/benchmarks{path}"
    try:
        return http_post(url, payload, timeout=timeout)
    except Exception as exc:
        log.warning("DB write skipped (%s arm=%s): %s",
                    path, payload.get("arm", "?"), exc)
        return {}


# ── Benchmark run lifecycle ───────────────────────────────────────────────────

def create_run(
    run_dir: str,
    arm: str,
    total_episodes: int,
    patient_mode: str,
) -> Optional[str]:
    """
    Create one benchmark run record per arm at training start.

    Maps to POST /api/benchmarks/run → htn_benchmark_runs row.

    Returns:
        run_id string, or None if the DB call failed.
    """
    r = _node_post("/run", {
        "arm":          arm,
        "label":        f"{Path(run_dir).name} / {arm}",
        "scenario_set": "a3c_training",
        "config": {
            "run_dir":        Path(run_dir).name,
            "total_episodes": total_episodes,
            "patient_mode":   patient_mode,
        },
    })
    return r.get("run_id")


def finalise_run(run_id: Optional[str], total_eps: int, success: bool) -> None:
    """
    Mark a run as completed (or failed) after the arm finishes.

    Maps to POST /api/benchmarks/run/finalise.
    """
    if not run_id:
        return
    _node_post("/run/finalise", {
        "run_id":     run_id,
        "total_episodes": total_eps,
        "success":    success,
    })


def post_checkpoint(
    run_id: Optional[str],
    arm: str,
    episode: int,
    stopped: bool = False,
) -> None:
    """
    Write a progress checkpoint marker (used by the dashboard timeline).

    Maps to POST /api/benchmarks/checkpoint → insertCheckpointEvent().
    The route expects { run_id, arm, episode, stopped, ts } where ts is a
    Unix millisecond timestamp — generated here so the DB layer stays pure.
    """
    if not run_id:
        return
    _node_post("/checkpoint", {
        "run_id":  run_id,
        "arm":     arm,
        "episode": episode,
        "stopped": stopped,
        "ts":      int(time.time() * 1000),
    })


# ── Episode lifecycle ─────────────────────────────────────────────────────────

def create_episode(
    run_id: Optional[str],
    arm: str,
    scenario_id: str,
    episode_id: str,
) -> str:
    """
    Register an episode at its start.

    Maps to POST /api/benchmarks/episode.

    Returns:
        The episode_id (either echoed back from the server or the caller's
        own uuid if the DB call failed — JSONL filename stays consistent).
    """
    if not run_id:
        return episode_id
    r = _node_post("/episode", {
        "run_id":      run_id,
        "arm":         arm,
        "scenario_id": scenario_id,
        "persona_id":  "",
        "episode_id":  episode_id,   # worker uuid == DB id
    })
    return r.get("episode_id") or episode_id


def finalise_episode(
    episode_id: Optional[str],
    summary: dict,
) -> None:
    """
    Persist end-of-episode metrics.

    Maps to POST /api/benchmarks/episode/finalise.

    Args:
        episode_id: DB episode id (may be None if create_episode skipped).
        summary:    Dict produced by A3CWorker._flush_episode().
    """
    if not episode_id:
        return
    gm = summary.get("genuine_metrics", {})
    _node_post("/episode/finalise", {
        "episode_id": episode_id,
        "metrics": {
            "n_turns":                summary.get("n_turns", 0),
            "cumulative_reward":      summary.get("cumulative_reward", 0.0),
            "mean_reward":            summary.get("mean_reward", 0.0),
            "goal_achieved":          gm.get("goal_achieved", False),
            "turns_to_goal":          gm.get("turns_to_goal"),
            "stress_auc":             gm.get("stress_auc", 0.0),
            "trust_delta_final":      gm.get("trust_delta_final", 0.0),
            "turn_count":             gm.get("turn_count", summary.get("n_turns", 0)),
            "latency_ms_mean":        summary.get("mean_latency_ms", 0.0),
            "cost_usd_episode":       summary.get("total_cost_usd", 0.0),
            "llm_calls_episode":      summary.get("total_llm_calls", 0),
            "tokens_episode":         summary.get("total_tokens", 0),
        },
    })


# ── Turn logging ──────────────────────────────────────────────────────────────

def record_turn(
    episode_id: str,
    run_id: str,
    arm: str,
    turn_idx: int,
    action: str,
    response: str,
    stress_index: float,
    stress_bucket: str,
    hrv_ms: Optional[float],
    reward: dict,
    judge: dict,
    latency_ms: float,
    cost_usd: float,
    llm_calls: int,
) -> None:
    """
    Persist a single turn's data so reward-component charts, action-usage tables,
    and per-arm turn-level analytics have data for all Python arms.

    Why this was missing
    --------------------
    Prior to this function, only the oldschool arm (Arm 5) wrote turn rows —
    because its turns flow through the Node.js companion API which logs them
    automatically.  All other Python arms completed episodes but never called
    /api/benchmarks/turn, leaving htn_benchmark_turns empty for those arms.

    Maps to POST /api/benchmarks/turn → db/queries_benchmarks.recordBenchmarkTurn().

    Reward key mapping (Python dict → DB column):
        "goal_progress"  → reward_goal
        "stress"         → reward_stress
        "trust_delta"    → reward_trust
        "info_coverage"  → reward_info
        "consistency"    → reward_consistency

    The JS recordBenchmarkTurn helper accepts both prefixed (reward_goal) and
    bare (goal) key forms; we send bare keys here.
    """
    _node_post("/turn", {
        "episode_id":   episode_id,
        "run_id":       run_id,
        "arm":          arm,
        "turn_number":  turn_idx,
        "action":       action,
        "response":     response,
        "hrv_ms":       hrv_ms,
        "stress_label": stress_bucket,
        "stress_index": stress_index,
        # reward components — bare key form
        "goal":         reward.get("goal_progress"),
        "stress":       reward.get("stress"),
        "trust":        reward.get("trust_delta"),
        "info":         reward.get("info_coverage"),
        "consistency":  reward.get("consistency"),
        # judge / scoring dimensions
        "judge_clinical":  judge.get("clinical"),
        "judge_empathy":   judge.get("empathy"),
        "judge_safety":    judge.get("safety"),
        "judge_goal":      judge.get("goal"),
        "judge_strategy":  judge.get("strategy"),
        "latency_ms":      round(latency_ms),
        "cost_usd_turn":   round(cost_usd, 6),
        "llm_calls_turn":  llm_calls,
        "discrepancy_flag": 0,
    }, timeout=5.0)


# ── Companion API (oldschool arm) ─────────────────────────────────────────────

def send_benchmark_message(
    message: str,
    circle_id: str,
    user_id: str,
    session_id: str,
    arm: str,
    timeout: float = 30.0,
) -> dict:
    """
    Forward a message to the Node.js companion and return its response.

    Used exclusively by OldschoolWorker (Arm 5 / Exp 5) which delegates all
    companion logic to the production Node.js system.

    Maps to POST /api/benchmark/message (note: singular 'benchmark', not plural).
    """
    url = f"{NODE_URL}/api/benchmark/message"
    return http_post(url, {
        "message":   message,
        "circleId":  circle_id,
        "userId":    user_id,
        "sessionId": session_id,
        "benchmark": True,
        "arm":       arm,
    }, timeout=timeout)
