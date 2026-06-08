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
from tensornets.a3c.hitl_applier import HITLApplier

log = logging.getLogger("tensornets.a3c.train")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)

# ── Constants ─────────────────────────────────────────────────────────────────

_ARM_CLASSES = None   # lazy import to avoid circular deps at module load

# URL constants are owned by node_client; read them from there for consistency.
_TENSORNETS_URL = _nc.TENSORNETS_URL
_NODE_URL       = _nc.NODE_URL


# ── CurriculumScheduler ────────────────────────────────────────────────────────

class CurriculumScheduler:
    """
    Manages episode configuration for all A3C training arms.

    Responsibilities
    ----------------
    1. **Scenario selection** — weighted random draw from the shared scenario pool,
       de-prioritising very short scenarios.
    2. **Prior-session pool management** — maintains per-arm pools of past episode
       summaries in three tiers:
         - ``success_pool``   : episodes where goal_achieved=True (70% draw weight)
         - ``recovery_pool``  : episodes where goal_achieved=False but
                                info_coverage >= MIN_RECOVERY_COV (29% draw weight)
         - ``dormant_pool``   : dropout / crit_fail episodes ( 1% draw weight).
                                Real patients do re-engage after crisis or dropout —
                                this pool models that rare but important event.
       Episodes with cov < EXCLUDE_COV, no goal, no dropout, no crit_fail are
       discarded entirely — they carry no useful prior-session signal.
    3. **Chaining rate schedule** — the probability of attaching a prior_session
       starts low and rises as the arm accumulates episodes.  This prevents the
       policy from over-fitting to prior-session formats before it can handle
       cold-start sessions reliably.

       Rate schedule (per arm):
         ep 0–10    : 0%  (no chaining — build cold-start robustness first)
         ep 11–50   : 15% (gentle introduction)
         ep 51–100  : 30%
         ep 101+    : 50% (long-run target)

    4. **70/29/1 pool split** — 70% success, 29% recovery, 1% dormant.
    5. **Long-chain bias** — within each pool, draws are weighted by
       LONG_CHAIN_BIAS^(session_number−1) so deeper longitudinal chains are
       preferred.  This encourages the policy to practise multi-session skills.

    Usage
    -----
    ::

        sched = CurriculumScheduler(scenarios)
        scenario, prior = sched.pick_episode("arm_name", ep_count=42)
        sched.record_outcome("arm_name", episode_summary)

    Notes
    -----
    - The scheduler is shared across all worker threads of an experiment.  It uses
      a threading.Lock so pool mutations are safe.
    - ``prior_sess`` in arm_states is replaced by calls to ``pick_episode`` and
      ``record_outcome``.
    """

    # Episode thresholds for the chaining rate schedule
    # Starts low so the policy builds cold-start robustness before seeing
    # longitudinal context.  Ramps faster in the early phase because a few
    # multi-session examples are highly informative; slows as the policy
    # saturates on chain diversity.
    _RAMP: list[tuple[int, float]] = [
        (  0,  0.00),   #   0–10 episodes: no chaining at all
        ( 11,  0.15),   #  11–50: gentle introduction
        ( 51,  0.30),   #  51–100: growing
        (101,  0.50),   # 101+: long-run target (50% — half of episodes are chained)
    ]

    MIN_RECOVERY_COV   = 0.30   # minimum info_coverage to enter recovery pool
    EXCLUDE_COV        = 0.15   # below this + goal_achieved=False → dormant pool
    SUCCESS_POOL_FRAC  = 0.70   # 70%: draw from success pool
    RECOVERY_POOL_FRAC = 0.29   # 29%: draw from recovery pool
    # DORMANT_POOL_FRAC = 0.01  # 1%: dropout / crit_fail — rare but real returns
    MAX_POOL_SIZE      = 200    # cap each pool to avoid unbounded memory
    LONG_CHAIN_BIAS    = 2.0    # exponential weight multiplier per additional session

    def __init__(self, scenarios: list[dict]) -> None:
        self._scenarios = scenarios
        # Scenario weights: down-weight very short scenarios
        self._sc_weights = [
            1.0 if (sc.get("turns") or sc.get("max_turns") or 8) > 4 else 0.33
            for sc in scenarios
        ]
        # Per-arm pools — three tiers
        self._success:  dict[str, list[dict]] = {}   # goal_achieved=True
        self._recovery: dict[str, list[dict]] = {}   # partial progress (info_coverage ≥ MIN)
        self._dormant:  dict[str, list[dict]] = {}   # dropout / crit_fail — rare re-engagement
        self._lock = threading.Lock()

    # ── Public API ──────────────────────────────────────────────────────────

    def pick_episode(
        self,
        arm_name: str,
        ep_count: int,
        rng: random.Random | None = None,
    ) -> tuple[dict, dict | None]:
        """
        Return (scenario, prior_session) for the next episode.

        prior_session is None when the chaining rate gate has not yet opened
        or when no eligible sessions are in either pool.

        When a prior_session is returned, a ``simulated_timeline`` dict is
        attached to it so that _build_state_with_continuity can inject temporal
        context into the longitudinal_hint and physio baseline:

            {
                "episode_day":     int,     # simulated calendar day since subject's first session
                "time_of_day_h":   float,   # hour-of-day in 24h format (affects physio)
                "session_number":  int,     # ordinal session count (1-indexed)
                "days_since_last": float,   # calendar days since the prior episode
            }
        """
        rng = rng or random
        scenario = rng.choices(self._scenarios, weights=self._sc_weights, k=1)[0]

        chain_prob = self._chain_probability(ep_count)
        if chain_prob <= 0.0 or rng.random() >= chain_prob:
            return scenario, None

        prior = self._draw_prior(arm_name, rng)
        if prior is not None:
            prior = self._attach_simulated_timeline(prior, rng)
        return scenario, prior

    def record_outcome(self, arm_name: str, summary: dict) -> None:
        """
        File an episode summary into the appropriate per-arm pool.

        Three-tier routing:
          success  (70% draw weight)  — goal_achieved=True
          recovery (29% draw weight)  — partial progress, info_coverage ≥ MIN_RECOVERY_COV
          dormant  ( 1% draw weight)  — dropout or crit_fail; represents patients who
                                        may re-engage later.  Kept for realism but drawn
                                        very rarely so they don't distort training.

        Summaries that are total failures (not goal, cov < EXCLUDE_COV, not dropout/crit)
        are silently discarded — they carry no useful prior-session signal.
        """
        cov           = float(summary.get("info_coverage", 0.0))
        goal_achieved = bool(summary.get("goal_achieved", False))
        crit_fail     = bool(summary.get("critical_failure", False))
        dropout       = bool(summary.get("synthetic_dropout", False))

        # Capture current session_number so chain depth is trackable
        sim_tl = (summary.get("session_memory") or {}).get("simulated_timeline") or {}
        summary = dict(summary)  # shallow copy — do not mutate caller's dict
        summary["session_number"] = int(sim_tl.get("session_number") or 1)

        with self._lock:
            if goal_achieved:
                pool = self._success.setdefault(arm_name, [])
                pool.append(summary)
                if len(pool) > self.MAX_POOL_SIZE:
                    del pool[0]
            elif crit_fail or dropout:
                # Dormant pool: patient dropped out or had a crisis.
                # Real returning patients exist — represent this at 1% draw rate.
                pool = self._dormant.setdefault(arm_name, [])
                pool.append(summary)
                if len(pool) > self.MAX_POOL_SIZE:
                    del pool[0]
            elif cov >= self.MIN_RECOVERY_COV:
                pool = self._recovery.setdefault(arm_name, [])
                pool.append(summary)
                if len(pool) > self.MAX_POOL_SIZE:
                    del pool[0]
            # else: total failure (cov < EXCLUDE_COV, no goal, no dropout) → discard

    def pool_stats(self, arm_name: str) -> dict:
        """Return pool sizes for logging."""
        with self._lock:
            return {
                "success":  len(self._success.get(arm_name, [])),
                "recovery": len(self._recovery.get(arm_name, [])),
                "dormant":  len(self._dormant.get(arm_name, [])),
            }

    # ── Internal ────────────────────────────────────────────────────────────

    def _chain_probability(self, ep_count: int) -> float:
        """Return the chaining probability for the given episode count."""
        prob = 0.0
        for threshold, rate in self._RAMP:
            if ep_count >= threshold:
                prob = rate
        return prob

    def _attach_simulated_timeline(
        self,
        prior: dict,
        rng: random.Random,
    ) -> dict:
        """
        Attach a simulated_timeline dict to a prior_session drawn from the pool.

        The prior session already carries session_memory with episode_day and
        time_of_day_h if it was itself a chained episode.  If not, we assume
        it was session 1 on day 0.

        Time advancement rules (generalizable, not clinical):
          - days_since_last: drawn from a log-normal distribution centred on
            3 days (median) with std 1.5 days.  This reflects the wide range
            of real-world return intervals without hardcoding a clinical pattern.
          - time_of_day_h: uniform 8–21h (waking hours only).
          - episode_day:  prior_day + days_since_last (rounded to int).
          - session_number: prior session_number + 1.

        The result is stored on the prior dict under 'simulated_timeline' so
        _build_state_with_continuity can inject it into the longitudinal_hint.
        """
        import math as _math
        prior_tl = prior.get("simulated_timeline") or {}
        prior_day    = int(prior_tl.get("episode_day", 0))
        prior_num    = int(prior_tl.get("session_number", 1))

        # Log-normal gap: median ≈ 3 days, 90th pct ≈ 9 days
        gap_days = round(rng.lognormvariate(
            _math.log(3.0), 1.1
        ))
        gap_days = max(1, min(gap_days, 30))   # clamp: at least 1 day, at most 30

        new_day   = prior_day + gap_days
        new_hour  = round(rng.uniform(8.0, 21.0), 1)

        prior = dict(prior)   # shallow copy so we don't mutate the pool
        prior["simulated_timeline"] = {
            "episode_day":     new_day,
            "time_of_day_h":   new_hour,
            "session_number":  prior_num + 1,
            "days_since_last": gap_days,
        }
        return prior

    def _draw_prior(self, arm_name: str, rng: random.Random) -> dict | None:
        """
        Draw one prior session from the arm's pools using the 70/29/1 split.

        Pool draw probabilities:
          70% success   — completed goal sessions
          29% recovery  — partial-progress sessions (teaches error recovery)
           1% dormant   — dropout / crit_fail (teaches re-engagement handling)

        Within each pool, a long-chain bias is applied: sessions with a higher
        session_number (deeper in a longitudinal chain) are drawn with exponentially
        higher probability (LONG_CHAIN_BIAS ^ session_number).  This encourages
        the policy to practice multi-session longitudinal skills, not just
        session-1 re-starts.

        Falls back gracefully if a pool is empty.
        Returns None if all pools are empty.
        """
        with self._lock:
            s_pool = list(self._success.get(arm_name, []))
            r_pool = list(self._recovery.get(arm_name, []))
            d_pool = list(self._dormant.get(arm_name, []))

        if not s_pool and not r_pool and not d_pool:
            return None

        # Determine which pool to sample from
        available = [(s_pool, 0.70), (r_pool, 0.29), (d_pool, 0.01)]
        # Filter out empty pools and re-normalise weights
        available = [(p, w) for p, w in available if p]
        total_w = sum(w for _, w in available)
        # Weighted random pool selection
        roll = rng.random() * total_w
        cumulative = 0.0
        chosen_pool = available[-1][0]  # fallback
        for pool, w in available:
            cumulative += w
            if roll < cumulative:
                chosen_pool = pool
                break

        # Long-chain bias: weight each candidate by LONG_CHAIN_BIAS^session_number
        # so deeper chains are preferred.  session_number=1 → weight 1, =2 → 2, =3 → 4, etc.
        weights = [
            self.LONG_CHAIN_BIAS ** max(0, int(ep.get("session_number", 1)) - 1)
            for ep in chosen_pool
        ]
        return rng.choices(chosen_pool, weights=weights, k=1)[0]


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

    # Initialise the offline write queue so failed DB writes are queued to disk
    # and replayed when Node.js comes back up.  Must be called before any _nc calls.
    _nc.init_offline_queue(run_dir)

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

        # Register actor/critic in the shadow mode registry so the FastAPI
        # /session/a3c/action endpoint can evaluate them without loading files.
        from tensornets.a3c.arms import _ARM_REGISTRY
        _ARM_REGISTRY[arm_name] = {"actor": actor, "critic": critic}

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

    # ── CurriculumScheduler: shared scenario picker + prior-session pool ──
    curriculum = CurriculumScheduler(scenarios)

    # ── HITL applier: polls human feedback, exposes reward corrections ─────
    hitl = HITLApplier()
    hitl.start()

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

            # ── CurriculumScheduler: scenario + prior-session selection ──────
            # Replaces the old flat random draw + flat 20% prior probability.
            # The scheduler maintains per-arm success/recovery pools and a
            # progressive chaining rate that rises from 0% to 50% as episodes
            # accumulate.
            with s["ep_count_lock"]:
                current_ep_count = s["ep_count"]  # read under lock for accuracy
            scenario, use_prior_session = curriculum.pick_episode(
                arm_name  = s["name"],
                ep_count  = current_ep_count,
            )
            use_prior = use_prior_session is not None
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
                    prior_session = use_prior_session if use_prior else None,
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

            # ── HITL reward correction ────────────────────────────────────────
            # If a human annotated this episode before the gradient batch was
            # applied, blend the human signal into the cumulative reward.
            # The correction is bounded by HITL_WEIGHT (±0.5) so it adjusts
            # without overriding the LLM scorer signal entirely.
            hitl_delta = hitl.get_correction(ep_uuid)
            if hitl_delta != 0.0:
                summary["cumulative_reward"] = round(
                    summary.get("cumulative_reward", 0.0) + hitl_delta, 5
                )
                summary.setdefault("genuine_metrics", {})["hitl_delta"] = round(hitl_delta, 3)

            # Register this episode's outcome with the curriculum so future
            # episodes on this arm can chain from it appropriately.
            curriculum.record_outcome(s["name"], summary)
            pool_s = curriculum.pool_stats(s["name"])

            _db_finalise_episode(db_episode_id or summary.get("episode_id"), summary)

            log.info(
                "arm=%-32s  w%d  ep=%04d/%d  scenario=%-35s  reward=%.3f  turns=%d  "
                "| ep_counts=%s  total_new=%d/%d  chain=%s  pool=S%d/R%d/D%d",
                s["name"], worker_idx, arm_ep, target,
                scenario.get("scenario_id", "?")[:35],
                summary.get("mean_reward", 0.0),
                summary.get("n_turns", 0),
                ",".join(str(a["ep_count"]) for a in arm_states),
                sum(max(0, a["ep_count"] - a["start_ep"]) for a in arm_states),
                episodes_per_arm * n_arms,
                "Y" if use_prior else "N",
                pool_s["success"],
                pool_s["recovery"],
                pool_s["dormant"],
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
                        "last_session_memory":    None,
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
            "last_session_memory":    None,
            "active_prompt":          s["active_prompt"],
            "last_improved_at":       s["last_improved_at"],
        })

    # Clean up sentinel if present
    if stop_sentinel.exists():
        stop_sentinel.unlink(missing_ok=True)
        log.info("All arm states saved. Exiting cleanly.")

    for s in arm_states:
        _db_finalise_run(s["db_run_id"], s["ep_count"], s["successful"])

    hitl.stop()

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
