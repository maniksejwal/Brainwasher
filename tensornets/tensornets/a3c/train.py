"""
tensornets.a3c.train — Resumable independent-per-arm A3C training loop.

Each arm trains its own independent Actor + Critic.  The three arms run in
round-robin order but never share weights.  This lets us compare the *learning
rate* of each environment (MCTS, JS companion, hysteresis-prompt) independently.

Usage
-----
    python -m tensornets.a3c.train \\
        --run-dir runs/run_001 \\
        --episodes 1000 \\
        --checkpoint-every 50 \\
        --prior bandit_actor_prior.json   # optional; cold-start if absent

Resume after a crash
--------------------
    python -m tensornets.a3c.train \\
        --run-dir runs/run_001 \\          # SAME run-dir as the failed run
        --episodes 1000

The script detects the latest checkpoint automatically and resumes from
the next episode.  All previously completed episode jsonl files are left
intact.  The episode counter advances from the checkpoint step, so the
total episode budget is honoured (i.e. --episodes means *total*, not
remaining).

Checkpoint layout
-----------------
    <run-dir>/
      arm_<name>/
        checkpoints/
          actor_<step>.json     ← Actor log-biases for this arm only
          critic_<step>.json    ← Critic weights for this arm only
          run_state.json        ← {last_step, ...}
        episodes/
          episode_<uuid>.jsonl  ← One file per completed episode for this arm
      run_manifest.json         ← Metadata written at run start / resume

Checkpoint frequency
--------------------
A checkpoint is written every --checkpoint-every episodes (default 50).
An *emergency checkpoint* is also written on SIGINT / SIGTERM so a
Ctrl-C or OS reboot does not lose the current session's updates.
"""

from __future__ import annotations

# Load .env from the project root (train.py lives four levels deep).
try:
    from dotenv import load_dotenv as _load_dotenv
    import pathlib as _pathlib
    _load_dotenv(_pathlib.Path(__file__).resolve().parents[3] / ".env")
except ImportError:
    pass

import argparse
import json
import logging
import os
import random
import signal
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from tensornets.a3c import node_client as _nc

log = logging.getLogger("tensornets.a3c.train")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)

# ── Constants ─────────────────────────────────────────────────────────────────

_ARM_CLASSES = None   # lazy import to avoid circular deps at module load

# Probability of using the prior session for longitudinal continuity in any
# given episode.  Set below 1.0 so the training distribution is not dominated
# by prior-session episodes: most episodes should start fresh, keeping the
# agent robust to cold-start scenarios.  0.20 = 1 in 5 episodes carry forward.
_PRIOR_SESSION_PROB = 0.20
# URL constants are owned by node_client; read them from there for consistency.
_TENSORNETS_URL = _nc.TENSORNETS_URL
_NODE_URL       = _nc.NODE_URL


def _get_arm_classes():
    global _ARM_CLASSES
    if _ARM_CLASSES is None:
        from tensornets.a3c.arms import (
            PhysioLLMWorker,
            PhysioLLMCoTMCTSWorker,
            PhysioMPSMCTSWorker,
            InertialPhysioMPSMCTSWorker,
            InertialPhysioLLMCoTMCTSWorker,
            OldschoolWorker,
            InertialHPVOOTPhysioMPSMCTSWorker,
            InertialHPVOOTPhysioLLMCoTMCTSWorker,
        )
        # Ordered by experiment number: 0-7
        _ARM_CLASSES = [
            PhysioLLMWorker,                       # Exp 0: physio_llm
            PhysioLLMCoTMCTSWorker,                # Exp 1: physio_llm_cot_mcts
            PhysioMPSMCTSWorker,                   # Exp 2: physio_mps_mcts
            InertialPhysioMPSMCTSWorker,           # Exp 3: inertial_physio_mps_mcts
            InertialPhysioLLMCoTMCTSWorker,        # Exp 4: inertial_physio_llm_cot_mcts
            OldschoolWorker,                       # Exp 5: oldschool
            InertialHPVOOTPhysioMPSMCTSWorker,     # Exp 6: inertial_hpvoot_physio_mps_mcts
            InertialHPVOOTPhysioLLMCoTMCTSWorker,  # Exp 7: inertial_hpvoot_physio_llm_cot_mcts
        ]
    return _ARM_CLASSES


# ── Benchmark DB helpers ───────────────────────────────────────────────────────
# All persistence calls are now routed through node_client so there is a single
# place that owns the HTTP transport and URL configuration.  These thin wrappers
# keep call-sites in the training loop unchanged while delegating to _nc.

def _db_create_run(run_dir: str, arm: str, total_episodes: int,
                   patient_mode: str) -> Optional[str]:
    """Create one benchmark run record per arm. Delegates to node_client.create_run."""
    return _nc.create_run(run_dir, arm, total_episodes, patient_mode)


def _db_create_episode(run_id: Optional[str], arm: str, scenario_id: str,
                       episode_id: str) -> Optional[str]:
    """Register an episode at its start. Delegates to node_client.create_episode."""
    if not run_id:
        return None
    return _nc.create_episode(run_id, arm, scenario_id, episode_id)


def _db_finalise_episode(db_episode_id: Optional[str], summary: dict) -> None:
    """Persist end-of-episode metrics. Delegates to node_client.finalise_episode."""
    _nc.finalise_episode(db_episode_id, summary)


def _db_finalise_run(run_id: Optional[str], total_eps: int,
                     successful_eps: int) -> None:
    """Mark a run completed. Delegates to node_client.finalise_run."""
    _nc.finalise_run(run_id, total_eps, successful_eps)


def _db_post_checkpoint(run_id: Optional[str], arm: str, episode: int,
                        stopped: bool = False) -> None:
    """Record a checkpoint event so the dashboard can draw a vertical marker."""
    _nc.post_checkpoint(run_id, arm, episode, stopped)


def _db_cleanup_ghosts(run_dir: Path) -> None:
    """
    Delete DB episode rows that were created but never finalised (ghost rows).

    Ghost rows appear when the training process crashes after _db_create_episode
    but before _db_finalise_episode.  They have turn_count=0, stress_auc=NULL,
    and no matching JSONL file on disk.  They corrupt WMA / goal-rate charts by
    dragging the rolling average toward zero.

    Called once at startup before the training loop begins.
    """
    try:
        import urllib.request as _req, json as _json
        resp = _req.urlopen(
            f"{_NODE_URL}/api/benchmarks/runs", timeout=5
        )
        runs = _json.loads(resp.read()).get("runs", [])
        for run in runs:
            run_id = run.get("run_id")
            if not run_id:
                continue
            ep_resp = _req.urlopen(
                f"{_NODE_URL}/api/benchmarks/episodes?run_id={run_id}", timeout=5
            )
            episodes = _json.loads(ep_resp.read()).get("episodes", [])
            for ep in episodes:
                ep_id = ep.get("episode_id", "")
                arm   = ep.get("arm", "")
                if ep.get("turn_count", 0) == 0 and ep.get("stress_auc") is None:
                    # Only delete if no JSONL file exists on disk
                    jsonl = run_dir / f"arm_{arm}" / "episodes" / f"episode_{ep_id}.jsonl"
                    if not jsonl.exists():
                        _db_post(f"/episode/{ep_id}/delete", {})
    except Exception as exc:
        log.debug("Ghost cleanup skipped: %s", exc)


# ── Checkpoint helpers ────────────────────────────────────────────────────────

def _latest_checkpoint(ckpt_dir: Path) -> Optional[int]:
    """
    Return the highest completed step number that has BOTH actor and critic
    files in `ckpt_dir`.  Returns None if no valid checkpoint exists.
    """
    if not ckpt_dir.exists():
        return None

    steps = set()
    for f in ckpt_dir.glob("actor_*.json"):
        try:
            step = int(f.stem.split("_")[1])
            if (ckpt_dir / f"critic_{step}.json").exists():
                steps.add(step)
        except (IndexError, ValueError):
            pass

    return max(steps) if steps else None


def _load_run_state(state_path: Path) -> dict:
    if state_path.exists():
        return json.loads(state_path.read_text(encoding="utf-8"))
    return {}


def _save_run_state(state_path: Path, state: dict) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _write_manifest(run_dir: Path, info: dict) -> None:
    path = run_dir / "run_manifest.json"
    existing = {}
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    existing.update(info)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(existing, indent=2), encoding="utf-8")


# ── Training loop ─────────────────────────────────────────────────────────────

def train(
    run_dir: str | Path,
    episodes_per_arm: int = 500,
    checkpoint_every: int = 50,
    prior_path: Optional[str] = None,
    scenario_url: Optional[str] = None,
    patient_mode: str = "llm",
    arms: Optional[list[int]] = None,
    workers_per_experiment: int = 1,
    total_episodes_cap: Optional[int] = None,
) -> None:
    """
    Run (or resume) the three-experiment A3C training loop.

    Each experiment has its own independent Actor + Critic.  With
    workers_per_experiment > 1, each experiment spawns N parallel worker
    threads that all share the same Actor and Critic — this is the
    "Asynchronous" part of A3C (Mnih et al. 2016).

    Parameters
    ----------
    run_dir                : Directory for checkpoints and episode logs.
    episodes_per_arm       : Episodes to run *per experiment* total (shared
                             across all its workers).  Default 500.
    checkpoint_every       : Save actor/critic every N episodes (per experiment).
    prior_path             : Path to bandit_actor_prior.json from I4.  Optional.
    scenario_url           : Override for /api/scenarios endpoint URL.
    patient_mode           : 'llm' or 'scripted'.
    arms                   : Which experiment indices to include, e.g. [1, 3].
    workers_per_experiment : Parallel worker threads per experiment.
                             1 = single-worker (default, backward compatible).
                             3 = recommended for real A3C; 9 total threads.
    """
    from tensornets.a3c.worker import Actor, Critic
    from tensornets.a3c.scenario_loader import load_scenarios
    from tensornets.a3c.prompt_optimizer import DEFAULT_PROMPTS, maybe_improve_prompt

    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)

    arm_classes = _get_arm_classes()
    selected_arm_classes = [arm_classes[i - 1] for i in (arms or [1, 2, 3])]

    # ── Per-experiment state ─────────────────────────────────────────────────
    # Each experiment gets ONE shared Actor + Critic.  If workers_per_experiment
    # > 1, multiple worker threads share these objects via an update_lock.
    # `arm_states` holds one dict per *experiment* (not per worker thread).
    arm_states: list[dict] = []
    for ArmCls in selected_arm_classes:
        arm_name   = ArmCls.ARM
        arm_dir    = run_dir / f"arm_{arm_name}"
        ckpt_dir   = arm_dir / "checkpoints"
        state_path = ckpt_dir / "run_state.json"

        latest_step = _latest_checkpoint(ckpt_dir)
        run_state   = _load_run_state(state_path)

        if latest_step is not None:
            actor  = Actor.load(ckpt_dir / f"actor_{latest_step}.json")
            critic = Critic.load(ckpt_dir / f"critic_{latest_step}.json")
            start_ep = run_state.get("last_completed_episode", latest_step) + 1
            log.info(
                "Arm %s: resuming from checkpoint step=%d (next episode=%d)",
                arm_name, latest_step, start_ep,
            )
        else:
            if prior_path and Path(prior_path).exists():
                actor = Actor.from_prior(prior_path)
                log.info("Arm %s: Actor initialised from prior: %s", arm_name, prior_path)
            else:
                actor = Actor.cold_start()
                log.info("Arm %s: Actor cold-started (uniform log-biases)", arm_name)
            critic   = Critic()
            start_ep = 0
            log.info("Arm %s: Critic initialised (zero weights)", arm_name)

        worker = ArmCls(actor=actor, critic=critic, run_dir=arm_dir)

        # ── Prompt improvement state ──────────────────────────────────────────
        saved_prompt = run_state.get("active_prompt")
        default_prompt = DEFAULT_PROMPTS.get(arm_name)
        active_prompt = saved_prompt or default_prompt

        # Shared lock — used by all workers of this experiment for atomic
        # Actor/Critic updates.  Single-worker mode still passes the lock;
        # it just never has contention.
        update_lock = threading.Lock()

        arm_states.append({
            "name":             arm_name,
            "ArmCls":           ArmCls,          # needed to spawn extra workers
            "worker":           worker,
            "actor":            actor,
            "critic":           critic,
            "update_lock":      update_lock,
            "arm_dir":          arm_dir,
            "ckpt_dir":         ckpt_dir,
            "state_path":       state_path,
            "start_ep":         start_ep,
            "db_run_id":        run_state.get("db_run_id"),
            "prior_sess":       run_state.get("last_session_memory"),
            "ep_count":         run_state.get("ep_count", 0),
            "successful":       run_state.get("successful_eps", 0),
            "active_prompt":    active_prompt,
            "last_improved_at": run_state.get("last_improved_at", 0),
            # ep_count_lock: protects shared ep_count across N workers of this experiment
            "ep_count_lock":    threading.Lock(),
            # throttle_event: SET = run freely, CLEAR = pause (rebalancer controls this)
            "throttle_event":   threading.Event(),
        })
        arm_states[-1]["throttle_event"].set()  # start unthrottled

    if scenario_url:
        os.environ.setdefault("TENSORNETS_URL", scenario_url)
    try:
        scenarios = load_scenarios()
        if not scenarios:
            raise ValueError("empty scenario list")
        log.info("Loaded %d scenarios from /api/scenarios", len(scenarios))
    except Exception as exc:
        log.error("Could not load scenarios: %s — aborting.", exc)
        sys.exit(1)

    # Total loop iterations = episodes_per_arm × number of active arms
    # (round-robin means each arm gets episodes_per_arm turns)
    n_arms         = len(arm_states)
    total_episodes = episodes_per_arm * n_arms
    log.info(
        "Training plan: %d episodes/arm × %d arms = %d total loop iterations%s",
        episodes_per_arm, n_arms, total_episodes,
        f" (hard cap: {total_episodes_cap} total)" if total_episodes_cap else "",
    )

    # ── Manifest + per-arm DB run records ────────────────────────────────────
    arm_names = [s["name"] for s in arm_states]
    _write_manifest(run_dir, {
        "run_dir":         str(run_dir),
        "total_episodes":  total_episodes,
        "patient_mode":    patient_mode,
        "arms":            arm_names,
        "timestamp_start": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })

    for s in arm_states:
        if not s["db_run_id"]:
            s["db_run_id"] = _db_create_run(
                str(s["arm_dir"]), s["name"], total_episodes, patient_mode,
            )
            if s["db_run_id"]:
                log.info("Arm %s: DB run record: %s", s["name"], s["db_run_id"])

    # ── Emergency checkpoint on interrupt ────────────────────────────────────
    # stop_event is set by signal handler so all arm threads drain cleanly.
    stop_event = threading.Event()

    # ── Global episode cap (--total-episodes) ─────────────────────────────────
    # Shared atomic counter across all experiments.  When it reaches the cap,
    # stop_event is set so all workers drain and exit cleanly.
    _global_ep_count     = 0
    _global_ep_lock      = threading.Lock()
    _global_ep_cap       = total_episodes_cap   # None → no cap

    def _claim_global_slot() -> bool:
        """Atomically increment the global counter.  Returns False if cap hit."""
        nonlocal _global_ep_count
        if _global_ep_cap is None:
            return True
        with _global_ep_lock:
            if _global_ep_count >= _global_ep_cap:
                return False
            _global_ep_count += 1
            if _global_ep_count >= _global_ep_cap:
                log.warning(
                    "Global episode cap reached (%d) — signalling all workers to stop.",
                    _global_ep_cap,
                )
                stop_event.set()
            return True

    def _emergency_save(signum, frame):
        log.warning("Signal %d — requesting clean stop of all arms", signum)
        stop_event.set()

    signal.signal(signal.SIGINT,  _emergency_save)
    signal.signal(signal.SIGTERM, _emergency_save)

    def _run_arm(s: dict, worker_idx: int = 0) -> None:
        """
        Worker thread: run one worker for experiment `s` until the shared
        episode target is reached.

        Each thread gets its own fresh ArmCls instance so _episode_log is
        never shared.  The Actor and Critic are shared across all workers of
        the same experiment via s["actor"]/s["critic"] + s["update_lock"].

        Throttling: when the rebalancer sets s["throttle_event"], this worker
        waits until cleared.  This is how the leader is slowed down without
        killing threads.
        """
        # Each thread needs its own worker instance (isolated _episode_log,
        # per-turn state).  Actor/Critic are shared by reference.
        thread_worker = s["ArmCls"](
            actor       = s["actor"],
            critic      = s["critic"],
            run_dir     = s["arm_dir"],
            worker_id   = f"{s['name']}_w{worker_idx}",
            update_lock = s["update_lock"],
        )
        # Restore the active prompt on this worker too
        if s["active_prompt"]:
            thread_worker.update_system_prompt(s["active_prompt"])

        consec_fail = 0
        target = s["start_ep"] + episodes_per_arm

        while not stop_event.is_set():
            # ── Throttle: rebalancer pauses leader arms by setting this event ─────
            # wait() with a timeout so we don't block the stop_event check.
            if not s["throttle_event"].is_set():
                log.info("Worker %s/%d throttled by rebalancer — waiting", s["name"], worker_idx)
                while not s["throttle_event"].wait(timeout=5.0):
                    if stop_event.is_set():
                        return

            # ── Claim the next episode slot atomically ────────────────────────
            # Check global cap first, then per-arm target.
            if not _claim_global_slot():
                log.info(
                    "Worker %s/%d: global cap hit — exiting", s["name"], worker_idx
                )
                break
            with s["ep_count_lock"]:
                if s["ep_count"] >= target:
                    break
                my_ep  = s["ep_count"]
                s["ep_count"] += 1
            arm_ep = my_ep + 1   # 1-indexed for logging

            # Weight scenarios by turn count — very short scenarios (≤4 turns)
            # can only be sampled at 1/3 the rate of normal-length ones, preventing
            # them from unfairly dragging down the WMA via low absolute reward.
            _weights   = [1.0 if (sc.get("turns") or sc.get("max_turns") or 8) > 4 else 0.33
                          for sc in scenarios]
            scenario   = random.choices(scenarios, weights=_weights, k=1)[0]
            use_prior = (s["prior_sess"] is not None) and (random.random() < _PRIOR_SESSION_PROB)
            ep_uuid   = str(uuid.uuid4())

            db_episode_id = _db_create_episode(
                s["db_run_id"], s["name"], scenario.get("scenario_id", ""), ep_uuid
            )

            # Reset the HysteresisGate between episodes for inertial workers.
            if hasattr(thread_worker, "reset_gate"):
                thread_worker.reset_gate()

            try:
                summary = thread_worker.run_episode(
                    scenario      = scenario,
                    prior_session = s["prior_sess"] if use_prior else None,
                    patient_mode  = patient_mode,
                    episode_id    = ep_uuid,
                    run_id        = s.get("db_run_id"),
                )
            except Exception as exc:
                log.error("Episode failed (%s w%d %s): %s — skipping",
                          s["name"], worker_idx, scenario.get("scenario_id", "?"), exc)
                consec_fail += 1
                if consec_fail >= 3:
                    wait = min(5 * (2 ** (consec_fail - 3)), 40)
                    log.warning("Back-off: arm=%s w%d waiting %.0fs (%d consecutive failures)",
                                s["name"], worker_idx, wait, consec_fail)
                    time.sleep(wait)
                continue

            consec_fail = 0
            with s["ep_count_lock"]:
                s["successful"] += 1
                s["prior_sess"]  = summary.get("session_memory")

            _db_finalise_episode(db_episode_id or summary.get("episode_id"), summary)

            log.info(
                "arm=%-32s  w%d  ep=%04d/%d  scenario=%-35s  reward=%.3f  turns=%d  "
                "| ep_counts=%s  total_new=%d/%d",
                s["name"], worker_idx, arm_ep, target,
                scenario.get("scenario_id", "?")[:35],
                summary.get("mean_reward", 0.0),
                summary.get("n_turns", 0),
                ",".join(str(a["ep_count"]) for a in arm_states),
                sum(max(0, a["ep_count"] - a["start_ep"]) for a in arm_states),
                episodes_per_arm * n_arms,
            )

            # Brief pause to avoid exhausting Bedrock per-minute token quota.
            time.sleep(1)

            # ── Periodic checkpoint (only one worker per checkpoint boundary) ─
            # We use ep_count_lock so exactly one worker triggers the save.
            with s["ep_count_lock"]:
                ep_now = s["ep_count"]
                should_ckpt = (ep_now % checkpoint_every == 0) or (ep_now >= target)

            if should_ckpt:
                # Only checkpoint if this specific ep_now hasn't been saved yet.
                # Use a simple set to track which checkpoint steps are done.
                with s["ep_count_lock"]:
                    if ep_now not in s.setdefault("_ckpt_done", set()):
                        s["_ckpt_done"].add(ep_now)
                        do_ckpt = True
                    else:
                        do_ckpt = False

                if do_ckpt:
                    thread_worker.save_checkpoint(ep_now)

                    stop_sentinel = Path(run_dir) / "STOP_AT_CHECKPOINT"
                    stopping = stop_sentinel.exists()
                    if stopping:
                        log.info("STOP_AT_CHECKPOINT — arm=%s stopping after ep=%d",
                                 s["name"], ep_now)
                        stop_event.set()

                    _db_post_checkpoint(s["db_run_id"], s["name"], ep_now, stopped=stopping)

                    new_prompt, s["last_improved_at"] = maybe_improve_prompt(
                        arm_name         = s["name"],
                        arm_dir          = s["arm_dir"],
                        ep_count         = ep_now,
                        last_improved_at = s["last_improved_at"],
                        current_prompt   = s["active_prompt"],
                    )
                    if new_prompt:
                        with s["ep_count_lock"]:
                            s["active_prompt"] = new_prompt
                        # Propagate to all workers by updating the shared dict;
                        # each worker will pick it up on the next checkpoint.
                        thread_worker.update_system_prompt(new_prompt)

                    _save_run_state(s["state_path"], {
                        "last_completed_episode": ep_now,
                        "ep_count":               ep_now,
                        "successful_eps":         s["successful"],
                        "db_run_id":              s["db_run_id"],
                        "last_session_memory":    s["prior_sess"],
                        "active_prompt":          s["active_prompt"],
                        "last_improved_at":       s["last_improved_at"],
                    })
                    log.info("Checkpoint written: arm=%s ep=%d", s["name"], ep_now)

        log.info("Worker arm=%s w%d finished.", s["name"], worker_idx)

    # Launch workers_per_experiment threads per experiment, all sharing the
    # same Actor + Critic.  With N=1 this is identical to the previous behaviour.
    #
    # Dynamic rebalancing: a monitor thread checks arm progress every
    # `checkpoint_every` episodes and adjusts worker counts so laggers get an
    # extra worker and leaders lose one.  Target: all arms within 30 episodes.
    threads = []
    # Track live worker threads per arm so the rebalancer can add/remove.
    arm_thread_map: dict[str, list[threading.Thread]] = {s["name"]: [] for s in arm_states}
    arm_worker_counters: dict[str, int] = {s["name"]: 0 for s in arm_states}

    def _spawn_worker(s: dict) -> threading.Thread:
        w_idx = arm_worker_counters[s["name"]]
        arm_worker_counters[s["name"]] += 1
        t = threading.Thread(
            target = _run_arm,
            args   = (s, w_idx),
            name   = f"{s['name']}_w{w_idx}",
            daemon = True,
        )
        arm_thread_map[s["name"]].append(t)
        threads.append(t)
        t.start()
        log.info("Started thread: %s", t.name)
        return t

    for s in arm_states:
        for _ in range(workers_per_experiment):
            _spawn_worker(s)

    n_threads = len(threads)
    log.info(
        "Launching %d threads: %d experiment(s) × %d worker(s) each",
        n_threads, len(arm_states), workers_per_experiment,
    )

    def _rebalance_workers() -> None:
        """
        Periodically rebalance worker throughput across experiments.

        Tiers (checked every ~60 s):
          gap > 150: throttle leader (CLEAR throttle_event) — all its workers
                     block until gap drops below 100.
          gap > 50:  spawn one extra worker for the lagger (add capacity).
          gap ≤ 50:  ensure leader is unthrottled (SET throttle_event).

        Throttling works by clearing s["throttle_event"].  Each worker checks
        this before claiming its next episode slot and blocks until set again.
        This is cooperative (not preemptive) — the current in-flight episode
        completes before the block takes effect.

        Logs every decision so the training log shows exactly what the
        rebalancer is doing and why.
        """
        sleep_secs = 60.0   # check every minute

        while not stop_event.wait(timeout=sleep_secs):
            counts = {s["name"]: s["ep_count"] for s in arm_states}
            live   = {s["name"]: sum(1 for t in arm_thread_map[s["name"]] if t.is_alive())
                      for s in arm_states}

            for arm_name, n_live in live.items():
                if n_live == 0:
                    log.error("Rebalancer: arm=%s has 0 live workers — all died!", arm_name)

            if len(counts) < 2:
                continue

            lagger_name = min(counts, key=counts.get)
            leader_name = max(counts, key=counts.get)
            gap = counts[leader_name] - counts[lagger_name]

            leader_s = next(s for s in arm_states if s["name"] == leader_name)
            lagger_s = next(s for s in arm_states if s["name"] == lagger_name)

            if gap > 150:
                # Hard throttle: leader must stop and let laggers catch up
                if leader_s["throttle_event"].is_set():
                    leader_s["throttle_event"].clear()
                    log.warning(
                        "Rebalancer: THROTTLING leader=%s (gap=%d > 150)  "
                        "leader=%d  lagger=%s=%d  — cleared throttle_event, "
                        "workers will block after current episode",
                        leader_name, gap, counts[leader_name],
                        lagger_name, counts[lagger_name],
                    )
            elif gap > 50:
                # Moderate gap: unthrottle leader if previously throttled, boost lagger
                if not leader_s["throttle_event"].is_set():
                    leader_s["throttle_event"].set()
                    log.info("Rebalancer: gap reduced to %d — unthrottling %s", gap, leader_name)
                log.info(
                    "Rebalancer: gap=%d — spawning extra worker for lagger=%s (%d eps)",
                    gap, lagger_name, counts[lagger_name],
                )
                _spawn_worker(lagger_s)
            else:
                # Balanced: ensure no arm is throttled
                for s in arm_states:
                    if not s["throttle_event"].is_set():
                        s["throttle_event"].set()
                        log.info(
                            "Rebalancer: gap=%d ≤ 50 — unthrottling %s",
                            gap, s["name"],
                        )
                log.debug(
                    "Rebalancer: balanced  leader=%s(%d)  lagger=%s(%d)  gap=%d",
                    leader_name, counts[leader_name], lagger_name, counts[lagger_name], gap,
                )

    rebalancer = threading.Thread(
        target=_rebalance_workers, name="rebalancer", daemon=True
    )
    rebalancer.start()
    log.info("Rebalancer thread started (checks every ~%.0f s, threshold=50 eps)", max(60, checkpoint_every * 3 * 45 / 10))

    # Wait for all arms to finish (or stop_event from STOP_AT_CHECKPOINT / signal)
    for t in threads:
        t.join()

    # ── Post a "cap stop" checkpoint event for each arm so the dashboard renders
    # a visible STOP marker at the final episode of this training session.
    # This fires when stop_event was set by the global cap (_claim_global_slot)
    # rather than by STOP_AT_CHECKPOINT (which already posts its own checkpoint).
    stop_sentinel = Path(run_dir) / "STOP_AT_CHECKPOINT"
    if not stop_sentinel.exists() and _global_ep_cap is not None:
        for s in arm_states:
            ep_now = s["ep_count"]
            if ep_now > 0:
                _db_post_checkpoint(s["db_run_id"], s["name"], ep_now, stopped=True)
                log.info("Global-cap stop checkpoint posted: arm=%s ep=%d", s["name"], ep_now)

    # Save final state for all arms
    for s in arm_states:
        _save_run_state(s["state_path"], {
            "last_completed_episode": s["ep_count"],
            "ep_count":               s["ep_count"],
            "successful_eps":         s["successful"],
            "db_run_id":              s["db_run_id"],
            "last_session_memory":    s["prior_sess"],
            "active_prompt":          s["active_prompt"],
            "last_improved_at":       s["last_improved_at"],
        })

    # Clean up sentinel if present
    if stop_sentinel.exists():
        stop_sentinel.unlink(missing_ok=True)
        log.info("All arm states saved. Exiting cleanly.")

    for s in arm_states:
        _db_finalise_run(s["db_run_id"], s["ep_count"], s["successful"])

    _write_manifest(run_dir, {
        "timestamp_end":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "completed":      True,
        "total_episodes": total_episodes,
    })
    log.info("Training complete: %d episodes, run_dir=%s", total_episodes, run_dir)


# ── CLI entry point ───────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Resumable A3C three-experiment training loop")
    p.add_argument("--run-dir",          required=True,         help="Directory for checkpoints + episode logs")
    p.add_argument("--episodes",         type=int, default=500, help="Episodes PER EXPERIMENT (shared across all its workers)")
    p.add_argument("--checkpoint-every", type=int, default=5,   help="Save checkpoint every N episodes")
    p.add_argument("--prior",            default=None,          help="Path to bandit_actor_prior.json (I4 output)")
    p.add_argument("--scenario-url",     default=None,          help="Override tensornets server URL for /api/scenarios")
    p.add_argument("--patient-mode",     default="llm", choices=["llm", "scripted"], help="Patient generation mode")
    p.add_argument("--arms",             type=int, nargs="+", default=[1, 2, 3], choices=[1, 2, 3, 4, 5, 6, 7, 8],
                   help="Which experiments to run by number (1=Exp0 … 8=Exp7)")
    p.add_argument("--workers",          type=int, default=1,
                   help="Parallel worker threads per experiment (default 1; use 3 for real A3C)")
    p.add_argument("--total-episodes",   type=int, default=None,
                   help="Hard cap: stop ALL workers once this many episodes have been completed globally (across all experiments). "
                        "Use for data-analysis checkpoints without modifying --episodes.")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    train(
        run_dir                 = args.run_dir,
        episodes_per_arm        = args.episodes,
        checkpoint_every        = args.checkpoint_every,
        prior_path              = args.prior,
        scenario_url            = args.scenario_url,
        patient_mode            = args.patient_mode,
        arms                    = args.arms,
        workers_per_experiment  = args.workers,
        total_episodes_cap      = args.total_episodes,
    )
