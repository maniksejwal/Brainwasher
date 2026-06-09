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
import threading
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


# ── Offline write queue ───────────────────────────────────────────────────────
#
# When the Node.js server is unavailable, DB writes would be silently dropped,
# leaving orphaned run_ids, missing episode records, and lost turn data.
# Instead, failed writes are appended to a local JSONL queue file.  A
# background drain thread replays the queue whenever the server becomes
# reachable again, using exponential backoff between retries.
#
# Queue semantics:
#   - Each entry: {"url": str, "payload": dict, "ts": float, "attempts": int}
#   - Queue file: <run_dir>/offline_queue.jsonl (set via init_offline_queue())
#   - Drain is fire-and-forget; training never blocks on it.
#   - Queue is capped at MAX_QUEUE_ENTRIES to prevent unbounded disk growth.
#   - Entries that fail > MAX_DRAIN_ATTEMPTS times are dropped with a warning.

_queue_lock        = threading.Lock()
_queue_file:   Optional[Path] = None      # set by init_offline_queue()
_drain_thread: Optional[threading.Thread] = None
_drain_running = threading.Event()

MAX_QUEUE_ENTRIES   = 2_000    # hard cap; oldest entries evicted beyond this
MAX_DRAIN_ATTEMPTS  = 10       # entries exceeding this are permanently dropped
_DRAIN_INITIAL_WAIT = 5.0      # seconds before first drain attempt
_DRAIN_MAX_WAIT     = 30.0     # seconds cap for exponential backoff (reduced from 120)


def init_offline_queue(run_dir: "str | Path") -> None:
    """
    Point the offline queue at <run_dir>/offline_queue.jsonl.

    Must be called once per training run, before any DB writes.  Safe to call
    multiple times (idempotent after the first call per process).
    """
    global _queue_file, _drain_thread
    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    with _queue_lock:
        _queue_file = run_dir / "offline_queue.jsonl"
    _ensure_drain_thread()
    log.debug("Offline write queue initialised at %s", _queue_file)


def _ensure_drain_thread() -> None:
    global _drain_thread
    if _drain_thread is not None and _drain_thread.is_alive():
        return
    _drain_running.set()
    _drain_thread = threading.Thread(
        target=_drain_loop,
        name="node-client-drain",
        daemon=True,  # dies with the training process
    )
    _drain_thread.start()


def _enqueue(url: str, payload: dict) -> None:
    """Append one failed write to the offline queue file."""
    if _queue_file is None:
        log.debug("Offline queue not initialised; write dropped for %s", url)
        return
    entry = json.dumps({"url": url, "payload": payload,
                         "ts": time.time(), "attempts": 0})
    with _queue_lock:
        # Evict oldest entries if over cap
        try:
            lines = _queue_file.read_text(encoding="utf-8").splitlines() if _queue_file.exists() else []
        except OSError:
            lines = []
        lines.append(entry)
        if len(lines) > MAX_QUEUE_ENTRIES:
            dropped = len(lines) - MAX_QUEUE_ENTRIES
            log.warning("Offline queue capped; dropping %d oldest entries", dropped)
            lines = lines[dropped:]
        try:
            _queue_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
        except OSError as e:
            log.warning("Could not write offline queue: %s", e)


def _drain_loop() -> None:
    """Background thread: retry queued writes whenever Node.js is reachable."""
    wait = _DRAIN_INITIAL_WAIT
    while _drain_running.is_set():
        time.sleep(wait)
        if _queue_file is None or not _queue_file.exists():
            wait = min(wait * 2, _DRAIN_MAX_WAIT)
            continue

        # Quick connectivity probe before reading the full queue.
        # Avoids spending time loading and iterating entries when the server
        # is definitely down (saves CPU and avoids spurious attempt increments).
        try:
            http_post("/api/benchmarks/ping", {}, timeout=3.0)
            wait = _DRAIN_INITIAL_WAIT   # server is back — reset backoff
        except Exception:
            wait = min(wait * 2, _DRAIN_MAX_WAIT)
            continue

        with _queue_lock:
            try:
                raw = _queue_file.read_text(encoding="utf-8").splitlines()
            except OSError:
                raw = []

        if not raw:
            wait = min(wait * 1.5, _DRAIN_MAX_WAIT)
            continue

        remaining: list[str] = []
        success_count = 0
        for line in raw:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue  # corrupt entry, discard

            attempts = entry.get("attempts", 0)
            if attempts >= MAX_DRAIN_ATTEMPTS:
                log.warning("Offline queue entry permanently dropped after %d attempts: %s",
                            attempts, entry.get("url", "?"))
                continue

            try:
                http_post(entry["url"], entry["payload"], timeout=8.0)
                success_count += 1
            except Exception:
                entry["attempts"] = attempts + 1
                remaining.append(json.dumps(entry))

        if success_count:
            log.info("Offline queue: replayed %d writes (%d still pending)",
                     success_count, len(remaining))
            wait = _DRAIN_INITIAL_WAIT   # success → reset backoff

        with _queue_lock:
            try:
                if remaining:
                    _queue_file.write_text("\n".join(remaining) + "\n", encoding="utf-8")
                elif _queue_file.exists():
                    _queue_file.write_text("", encoding="utf-8")
            except OSError as e:
                log.warning("Could not update offline queue file: %s", e)

        if remaining:
            wait = min(wait * 2, _DRAIN_MAX_WAIT)
        else:
            wait = _DRAIN_INITIAL_WAIT


# ── Internal non-fatal wrapper ────────────────────────────────────────────────

def _node_post(path: str, payload: dict, timeout: float = 5.0) -> dict:
    """
    POST to a Node.js /api/benchmarks/* path.

    Non-fatal: on failure, enqueues the write to the offline queue and returns
    {} so training is never blocked.  The drain thread will replay the write
    when the server comes back up.
    """
    url = f"{NODE_URL}/api/benchmarks{path}"
    try:
        return http_post(url, payload, timeout=timeout)
    except Exception as exc:
        log.warning("DB write queued offline (%s arm=%s): %s",
                    path, payload.get("arm", "?"), exc)
        _enqueue(url, payload)
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
    skip_privacy_guard: bool = False,
) -> dict:
    """
    Forward a message to the Node.js companion and return its response.

    Used exclusively by OldschoolWorker (Arm 5 / Exp 5) which delegates all
    companion logic to the production Node.js system.

    Maps to POST /api/benchmark/message (note: singular 'benchmark', not plural).

    skip_privacy_guard: when True, instructs Node.js to omit privacyGuard from
    the CompanionCoordinator handler list (used for Exp 5a safety-ablation arm).
    """
    url = f"{NODE_URL}/api/benchmark/message"
    return http_post(url, {
        "message":          message,
        "circleId":         circle_id,
        "userId":           user_id,
        "sessionId":        session_id,
        "benchmark":        True,
        "arm":              arm,
        "skipPrivacyGuard": skip_privacy_guard,
    }, timeout=timeout)
