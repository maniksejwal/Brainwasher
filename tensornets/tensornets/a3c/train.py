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

# Default path for the historical episode count query used by the rebalancer.
# Override with env var BENCHMARK_DB_PATH if the DB is not in the standard location.
# Walk up: tensornets/a3c/ → tensornets(pkg)/ → tensornets(dir)/ → project root
_DEFAULT_DB_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__),   # .../tensornets/a3c
                 "..",                          # .../tensornets (package)
                 "..",                          # .../tensornets (src dir)
                 "..",                          # project root
                 "data", "dbs", "care_circle_dev.db")
)


def _register_arm_priorities(priority_map: dict[str, int]) -> None:
    """
    POST arm priority rankings to the tensornets server's priority-semaphore endpoint.

    priority_map: {arm_name: rank}  where rank 0 = highest priority (worst lagger).
    The server uses this to let lagger arms acquire the Bedrock semaphore ahead of
    leader arms when multiple requests are queued.  Non-fatal if the server is not
    yet upgraded to support this endpoint.
    """
    import urllib.request as _req, json as _json
    try:
        data = _json.dumps({"priorities": priority_map}).encode()
        r = _req.urlopen(
            _req.Request(
                f"{_TENSORNETS_URL}/llm/arm-priorities",
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            ),
            timeout=2.0,
        )
        r.read()
    except Exception:
        pass   # non-fatal; priority is best-effort


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
            # Safety-ablation arms (Exp 0a, 1a, 2a, 3a, 4a, 5a, 6a, 7a)
            OldschoolNoPrivacyWorker,
            PhysioLLMNoGateWorker,
            PhysioLLMCoTMCTSNoGateWorker,
            PhysioMPSMCTSNoGateWorker,
            InertialPhysioMPSMCTSNoGateWorker,
            InertialPhysioLLMCoTMCTSNoGateWorker,
            InertialHPVOOTPhysioMPSMCTSNoGateWorker,
            InertialHPVOOTPhysioLLMCoTMCTSNoGateWorker,
            # DPO/RLAIF prompt-improved variants (Exp 0p–7p)
            OldschoolDPOWorker,
            PhysioLLMDPOWorker,
            PhysioLLMCoTMCTSDPOWorker,
            PhysioMPSMCTSDPOWorker,
            InertialPhysioMPSMCTSDPOWorker,
            InertialPhysioLLMCoTMCTSDPOWorker,
            InertialHPVOOTPhysioMPSMCTSDPOWorker,
            InertialHPVOOTPhysioLLMCoTMCTSDPOWorker,
        )
        # Indices:
        #   1–8:   main experiments (Exp 0–7)
        #   9–16:  safety-ablation arms (Exp 0a–7a; 0a=no privacy guard, 1a–7a=no crit gate)
        #   17–24: DPO/RLAIF prompt-improved variants (Exp 0p–7p)
        _ARM_CLASSES = [
            OldschoolWorker,                             # Exp 0  (idx 1):  oldschool
            PhysioLLMWorker,                             # Exp 1  (idx 2):  physio_llm
            PhysioLLMCoTMCTSWorker,                      # Exp 2  (idx 3):  physio_llm_cot_mcts
            PhysioMPSMCTSWorker,                         # Exp 3  (idx 4):  physio_mps_mcts
            InertialPhysioMPSMCTSWorker,                 # Exp 4  (idx 5):  inertial_physio_mps_mcts
            InertialPhysioLLMCoTMCTSWorker,              # Exp 5  (idx 6):  inertial_physio_llm_cot_mcts
            InertialHPVOOTPhysioMPSMCTSWorker,           # Exp 6  (idx 7):  inertial_hpvoot_physio_mps_mcts
            InertialHPVOOTPhysioLLMCoTMCTSWorker,        # Exp 7  (idx 8):  inertial_hpvoot_physio_llm_cot_mcts
            # Safety-ablation arms — share run dir with parent arm
            OldschoolNoPrivacyWorker,                    # Exp 0a (idx 9):  no privacy guard
            PhysioLLMNoGateWorker,                       # Exp 1a (idx 10): no critical-failure gate
            PhysioLLMCoTMCTSNoGateWorker,                # Exp 2a (idx 11): no critical-failure gate
            PhysioMPSMCTSNoGateWorker,                   # Exp 3a (idx 12): no critical-failure gate
            InertialPhysioMPSMCTSNoGateWorker,           # Exp 4a (idx 13): no critical-failure gate
            InertialPhysioLLMCoTMCTSNoGateWorker,        # Exp 5a (idx 14): no critical-failure gate
            InertialHPVOOTPhysioMPSMCTSNoGateWorker,     # Exp 6a (idx 15): no critical-failure gate
            InertialHPVOOTPhysioLLMCoTMCTSNoGateWorker,  # Exp 7a (idx 16): no critical-failure gate
            # DPO/RLAIF prompt-improved variants — cold-start weights (fair comparison)
            OldschoolDPOWorker,                          # Exp 0p (idx 17): oldschool + DPO context injection
            PhysioLLMDPOWorker,                          # Exp 1p (idx 18): physio_llm_dpo
            PhysioLLMCoTMCTSDPOWorker,                   # Exp 2p (idx 19): physio_llm_cot_mcts_dpo
            PhysioMPSMCTSDPOWorker,                      # Exp 3p (idx 20): physio_mps_mcts_dpo
            InertialPhysioMPSMCTSDPOWorker,              # Exp 4p (idx 21): inertial_physio_mps_mcts_dpo
            InertialPhysioLLMCoTMCTSDPOWorker,           # Exp 5p (idx 22): inertial_physio_llm_cot_mcts_dpo
            InertialHPVOOTPhysioMPSMCTSDPOWorker,        # Exp 6p (idx 23): inertial_hpvoot_physio_mps_mcts_dpo
            InertialHPVOOTPhysioLLMCoTMCTSDPOWorker,     # Exp 7p (idx 24): inertial_hpvoot_physio_llm_cot_mcts_dpo
        ]
    return _ARM_CLASSES


# ── Benchmark DB helpers ───────────────────────────────────────────────────────
# All persistence calls are now routed through node_client so there is a single
# place that owns the HTTP transport and URL configuration.  These thin wrappers
# keep call-sites in the training loop unchanged while delegating to _nc.

def _db_create_run(run_dir: str, arm: str, total_episodes: int,
                   patient_mode: str, prompt_variant: str = "baseline") -> Optional[str]:
    """Create one benchmark run record per arm. Delegates to node_client.create_run."""
    return _nc.create_run(run_dir, arm, total_episodes, patient_mode, prompt_variant)


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
    Run (or resume) the 24-arm A3C training loop.

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
    for idx, ArmCls in enumerate(selected_arm_classes):
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
            "prompt_variant":   getattr(ArmCls, "PROMPT_VARIANT", "baseline"),
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
            # ep_count tracks cumulative episodes for target comparisons.
            # Must start at start_ep (not run_state["ep_count"]) so that
            # target = start_ep + episodes_per_arm is always coherent.
            "ep_count":         start_ep,
            "successful":       run_state.get("successful_eps", 0),
            "active_prompt":    active_prompt,
            "last_improved_at": run_state.get("last_improved_at", 0),
            # ep_count_lock: protects shared ep_count across N pool slots for this arm
            "ep_count_lock":    threading.Lock(),
            # group: informational only — 0=base(Exp 0–7)  1=ablation(0a–7a)  2=DPO(0p–7p)
            "group": 0 if idx < 8 else (1 if idx < 16 else 2),
        })

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
                prompt_variant=s.get("prompt_variant", "baseline"),
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


    def _run_single_episode(
        w, s, scenario, prior_session, arm_ep, target, my_ep,
        consec_fails, curriculum, chain_info, slot_id,
    ) -> "dict | None":
        """
        Run one episode for arm *s* using worker *w*.
        Returns the episode summary dict on success, None on failure.
        Raises on unrecoverable errors so the caller can back off.
        """
        use_prior = prior_session is not None
        ep_uuid   = str(uuid.uuid4())

        db_episode_id = _db_create_episode(
            s["db_run_id"], s["name"], scenario.get("scenario_id", ""), ep_uuid
        )

        if hasattr(w, "reset_gate"):
            w.reset_gate()

        scenario = {**scenario, "_arm_ep_count": my_ep}

        summary = w.run_episode(
            scenario      = scenario,
            prior_session = prior_session,
            patient_mode  = patient_mode,
            episode_id    = ep_uuid,
            run_id        = s.get("db_run_id"),
        )

        with s["ep_count_lock"]:
            s["successful"] += 1

        hitl_delta = hitl.get_correction(ep_uuid)
        if hitl_delta != 0.0:
            summary["cumulative_reward"] = round(
                summary.get("cumulative_reward", 0.0) + hitl_delta, 5
            )
            summary.setdefault("genuine_metrics", {})["hitl_delta"] = round(hitl_delta, 3)

        curriculum.record_outcome(s["name"], summary)
        pool_s = curriculum.pool_stats(s["name"])

        _goal = bool(summary.get("goal_achieved", False))
        _crit = bool(summary.get("critical_failure", False))
        _drop = bool(summary.get("synthetic_dropout", False))
        _cov  = float(summary.get("info_coverage", 0.0))
        MIN_REC = 0.35
        if _goal:
            summary["curriculum_pool"] = "success"
        elif _crit or _drop:
            summary["curriculum_pool"] = "dormant"
        elif _cov >= MIN_REC:
            summary["curriculum_pool"] = "recovery"
        else:
            summary["curriculum_pool"] = "initial"

        _db_finalise_episode(db_episode_id or summary.get("episode_id"), summary)

        log.info(
            "arm=%-36s  s%d  ep=%04d/%d  scenario=%-35s  reward=%.3f  turns=%d  "
            "| ep_counts=%s  total_new=%d/%d  chain=%s  pool=S%d/R%d/D%d",
            s["name"], slot_id, arm_ep, target,
            scenario.get("scenario_id", "?")[:35],
            summary.get("mean_reward", 0.0),
            summary.get("n_turns", 0),
            ",".join(str(a["ep_count"]) for a in arm_states),
            sum(max(0, a["ep_count"] - a["start_ep"]) for a in arm_states),
            episodes_per_arm * n_arms,
            "Y" if use_prior else "N",
            pool_s["success"], pool_s["recovery"], pool_s["dormant"],
        )

        # ── Checkpoint ───────────────────────────────────────────────────────
        with s["ep_count_lock"]:
            ep_now     = s["ep_count"]
            should_ckpt = (ep_now % checkpoint_every == 0) or (ep_now >= target)

        if should_ckpt:
            with s["ep_count_lock"]:
                if ep_now not in s.setdefault("_ckpt_done", set()):
                    s["_ckpt_done"].add(ep_now)
                    do_ckpt = True
                else:
                    do_ckpt = False

            if do_ckpt:
                w.save_checkpoint(ep_now)

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
                    w.update_system_prompt(new_prompt)

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

        return summary

        log.info("Worker arm=%s w%d finished.", s["name"], worker_idx)

    # Launch workers_per_experiment threads per experiment, all sharing the
    # same Actor + Critic.  With N=1 this is identical to the previous behaviour.
    #
    # Dynamic rebalancing: a monitor thread checks arm progress every
    # `checkpoint_every` episodes and adjusts worker counts so laggers get an
    # extra worker and leaders lose one.  Target: all arms within 30 episodes.
    # ── Round-Robin Pool Rebalancer ───────────────────────────────────────────
    # Replace per-arm dedicated threads + complex STOP/PACE rebalancer with a
    # simple shared worker pool.
    #
    # Design:
    #   - POOL_SIZE slot threads share all Bedrock quota.  Tune this to stay
    #     below the Bedrock rate limit (8 is safe for Scout on us-east-1).
    #   - Each slot, when free, atomically picks the arm with the fewest raw
    #     episodes that still has episodes remaining.  Leaders are skipped
    #     naturally — they are never the minimum.
    #   - No RELATIVE_SPEED normalisation, no STOP_GAP, no THROTTLE_GAP.
    #   - A slot that finds all arms at target sleeps briefly then exits.
    #
    # Per-arm worker instances are created once per slot (not per episode) so
    # initialisation cost is O(POOL_SIZE), not O(n_episodes).
    POOL_SIZE = max(1, workers_per_experiment)

    # Pre-create one worker instance per (slot × arm) pair so each slot always
    # has a ready worker for whichever arm it picks.
    # Shape: slot_workers[slot_id][arm_name] → ArmCls instance
    slot_workers: list[dict] = []
    for slot_id in range(POOL_SIZE):
        slot_map: dict = {}
        for s in arm_states:
            w = s["ArmCls"](
                actor       = s["actor"],
                critic      = s["critic"],
                run_dir     = s["arm_dir"],
                worker_id   = f"{s['name']}_s{slot_id}",
                update_lock = s["update_lock"],
            )
            if s["active_prompt"]:
                w.update_system_prompt(s["active_prompt"])
            slot_map[s["name"]] = w
        slot_workers.append(slot_map)

    # Lock that serialises arm selection so two slots never pick the same arm
    # for the same episode slot.
    _pick_lock = threading.Lock()

    # ── Historical-deficit-aware arm picker ───────────────────────────────────
    # Selection weight: 90 % historical deficit (total DB episodes across ALL
    # runs) + 10 % run-local deficit (current run ep_count).
    # Rationale: the experiment with the least cumulative experience should be
    # explored more, not the one that merely started this run later.
    #
    # _hist_totals is refreshed by a background thread every HIST_REFRESH_SECS.
    # It maps arm_name → total DB episode count.  Protected by _hist_lock.
    HIST_REFRESH_SECS = 120   # re-query DB every 2 minutes
    HIST_W            = 0.9   # weight for historical deficit
    RUN_W             = 0.1   # weight for run-local deficit

    _hist_totals: dict = {s["name"]: 0 for s in arm_states}
    _hist_lock   = threading.Lock()

    def _refresh_hist_totals() -> None:
        """Read total episode counts per arm from the SQLite DB (read-only)."""
        db_path = os.environ.get("BENCHMARK_DB_PATH", _DEFAULT_DB_PATH)
        db_path = os.path.abspath(db_path)
        try:
            uri = f"file:{db_path}?mode=ro"
            con = __import__("sqlite3").connect(uri, uri=True, timeout=5)
            rows = con.execute(
                "SELECT arm, COUNT(*) FROM htn_benchmark_episodes GROUP BY arm"
            ).fetchall()
            con.close()
            new_totals = {arm: cnt for arm, cnt in rows}
            with _hist_lock:
                _hist_totals.update(new_totals)
            log.debug("Historical totals refreshed: %s",
                      {k: v for k, v in sorted(new_totals.items())})
        except Exception as exc:
            log.warning("Could not refresh historical episode totals: %s", exc)

    def _hist_refresh_loop() -> None:
        """Background thread: refresh DB totals every HIST_REFRESH_SECS."""
        while not stop_event.wait(timeout=HIST_REFRESH_SECS):
            _refresh_hist_totals()

    # Initial load before any episodes start
    _refresh_hist_totals()
    threading.Thread(target=_hist_refresh_loop, name="hist_refresh",
                     daemon=True).start()
    log.info("Historical-deficit rebalancer active (%.0f%% hist / %.0f%% run).",
             HIST_W * 100, RUN_W * 100)

    def _pick_arm() -> "dict | None":
        """
        Return the arm with the highest *experience deficit* score.

        Score = HIST_W * norm_hist_deficit + RUN_W * norm_run_deficit

        norm_hist_deficit  = (max_hist - arm_hist) / max(hist_range, 1)
            — arms with fewer cumulative DB episodes across all runs score higher.

        norm_run_deficit   = (max_run_ep - arm_run_ep) / max(run_range, 1)
            — arms behind the leader within the current run score higher.

        Returns None when all arms have hit their per-run target.
        Caller must hold _pick_lock.
        """
        eligible = [
            s for s in arm_states
            if s["ep_count"] < s["start_ep"] + episodes_per_arm
        ]
        if not eligible:
            return None

        with _hist_lock:
            hist_snap = dict(_hist_totals)

        hist_vals = [hist_snap.get(s["name"], 0) for s in eligible]
        run_vals  = [s["ep_count"]               for s in eligible]

        max_hist, min_hist = max(hist_vals), min(hist_vals)
        max_run,  min_run  = max(run_vals),  min(run_vals)

        hist_range = max(max_hist - min_hist, 1)
        run_range  = max(max_run  - min_run,  1)

        def _score(s: dict) -> float:
            h = hist_snap.get(s["name"], 0)
            r = s["ep_count"]
            hist_deficit = (max_hist - h) / hist_range
            run_deficit  = (max_run  - r) / run_range
            return HIST_W * hist_deficit + RUN_W * run_deficit

        return max(eligible, key=_score)


    def _pool_slot(slot_id: int) -> None:
        """
        Pool slot thread: loop picking the lagger arm and running one episode.
        Exits when all arms are done or stop_event is set.
        """
        consec_fails: dict[str, int] = {s["name"]: 0 for s in arm_states}

        while not stop_event.is_set():
            with _pick_lock:
                s = _pick_arm()
                if s is None:
                    break
                if not _claim_global_slot():
                    break
                my_ep      = s["ep_count"]
                s["ep_count"] += 1

            arm_ep = my_ep + 1
            arm_name = s["name"]
            target = s["start_ep"] + episodes_per_arm
            w = slot_workers[slot_id][arm_name]

            with s["ep_count_lock"]:
                current_ep_count = s["ep_count"]
            scenario, prior_session = curriculum.pick_episode(
                arm_name=arm_name, ep_count=current_ep_count,
            )

            try:
                summary = _run_single_episode(
                    w=w, s=s, scenario=scenario, prior_session=prior_session,
                    arm_ep=arm_ep, target=target, my_ep=my_ep,
                    consec_fails=consec_fails, curriculum=curriculum,
                    chain_info=None, slot_id=slot_id,
                )
            except Exception as exc:
                log.error("Episode failed (%s s%d %s): %s — skipping",
                          arm_name, slot_id, scenario.get("scenario_id", "?"), exc)
                consec_fails[arm_name] = consec_fails.get(arm_name, 0) + 1
                wait = min(5 * (2 ** min(consec_fails[arm_name] - 1, 6)), 40)
                if consec_fails[arm_name] >= 3:
                    log.warning("Back-off: arm=%s s%d waiting %.0fs (%d consecutive failures)",
                                arm_name, slot_id, wait, consec_fails[arm_name])
                if stop_event.wait(timeout=wait if consec_fails[arm_name] >= 3 else 0):
                    break
            else:
                if summary:
                    consec_fails[arm_name] = 0

        log.info("Pool slot %d finished.", slot_id)

    # ── Launch pool threads ───────────────────────────────────────────────────
    threads = []
    for slot_id in range(POOL_SIZE):
        t = threading.Thread(
            target=_pool_slot, args=(slot_id,),
            name=f"pool_slot_{slot_id}", daemon=True,
        )
        threads.append(t)
        t.start()
        log.info("Started pool slot %d", slot_id)

    log.info(
        "Round-robin pool started: %d slots across %d arms (no STOP/PACE/RELATIVE_SPEED)",
        POOL_SIZE, len(arm_states),
    )

    # ── Internal stall detector + physio auto-restart ─────────────────────────


    # ── Internal stall detector + physio auto-restart ─────────────────────────
    # Runs every 5 minutes.  If no arm has completed a new episode in
    # STALL_MINUTES, assume the physio/MCTS server is stuck and restart it.
    # The training workers themselves recover once the server comes back online
    # (their HTTP timeouts and back-off logic kick in).
    _STALL_MINUTES       = 15
    _STALL_SECONDS       = _STALL_MINUTES * 60
    _PHYSIO_CHECK_SECS   = 300    # check every 5 minutes
    _PHYSIO_RESTART_COOL = 300    # at most one restart per 5 minutes

    def _stall_detector() -> None:
        import urllib.request as _ureq
        import urllib.error   as _uerr

        last_restart_t:  float = 0.0
        last_ep_counts: dict   = {}

        def _physio_healthy() -> bool:
            try:
                with _ureq.urlopen(f"{_TENSORNETS_URL}/health", timeout=8) as r:
                    return r.status < 500
            except _uerr.HTTPError as e:
                return e.code < 500
            except Exception:
                return False

        def _restart_physio() -> None:
            nonlocal last_restart_t
            if time.monotonic() - last_restart_t < _PHYSIO_RESTART_COOL:
                log.warning("Stall-detector: physio restart suppressed (cooldown active)")
                return
            log.error("Stall-detector: physio server not healthy — attempting restart")
            # Kill any process listening on 8765
            try:
                import subprocess as _sp
                r = _sp.run(["netstat", "-ano"], capture_output=True, text=True, timeout=10)
                for line in r.stdout.splitlines():
                    if "8765" in line and "LISTENING" in line:
                        pid = int(line.split()[-1])
                        if pid > 4:
                            _sp.run(["taskkill", "/F", "/PID", str(pid)],
                                    capture_output=True)
                            log.info("Stall-detector: killed stale PID %d on :8765", pid)
            except Exception as exc:
                log.debug("Stall-detector: kill-stale failed: %s", exc)
            import time as _time; _time.sleep(2)
            # Spawn fresh uvicorn
            try:
                import subprocess as _sp
                _sp.Popen(
                    [sys.executable, "-m", "uvicorn", "server:app",
                     "--host", "127.0.0.1", "--port", "8765"],
                    cwd=str(Path(__file__).resolve().parents[3] / "tensornets"),
                    env={**os.environ, "PYTHONPATH": str(
                        Path(__file__).resolve().parents[3] / "tensornets"
                    )},
                    stdout=_sp.DEVNULL,
                    stderr=_sp.DEVNULL,
                )
                last_restart_t = time.monotonic()
                log.info("Stall-detector: physio server restarted")
            except Exception as exc:
                log.error("Stall-detector: could not restart physio server: %s", exc)

        while not stop_event.wait(timeout=_PHYSIO_CHECK_SECS):
            current_counts = {s["name"]: s["ep_count"] for s in arm_states}

            # Check whether any arm made progress since last check
            any_progress = any(
                current_counts.get(name, 0) > last_ep_counts.get(name, 0)
                for name in current_counts
            )
            last_ep_counts = current_counts

            # Also look at newest episode file on disk (catches the edge case where
            # ep_count is incremented but the JSONL hasn't been flushed yet)
            newest_mtime = 0.0
            try:
                run_path = Path(run_dir)
                for ep_file in run_path.rglob("episode_*.jsonl"):
                    newest_mtime = max(newest_mtime, ep_file.stat().st_mtime)
            except Exception:
                pass

            file_age = time.time() - newest_mtime if newest_mtime else _STALL_SECONDS + 1
            all_done = all(v >= episodes_per_arm for v in current_counts.values())

            if all_done:
                continue   # training finished normally — no stall concern

            if not any_progress and file_age > _STALL_SECONDS:
                log.error(
                    "Stall-detector: no new episodes in %d min  counts=%s",
                    _STALL_MINUTES,
                    {k.replace("arm_", ""): v for k, v in current_counts.items()},
                )
                if not _physio_healthy():
                    _restart_physio()
                else:
                    log.warning(
                        "Stall-detector: physio appears healthy but training stalled — "
                        "likely Bedrock worker threads are hung.  Triggering self-restart."
                    )
                    # Set stop_event so all pool slots drain cleanly, then
                    # re-exec this process with the same argv to resume from
                    # the latest checkpoint.
                    stop_event.set()
                    time.sleep(5)
                    log.warning("Stall-detector: re-execing training process now")
                    os.execv(sys.executable, [sys.executable] + sys.argv)
            elif not any_progress:
                log.info(
                    "Stall-detector: no progress this cycle (file_age=%.0fm) — watching",
                    file_age / 60,
                )

    stall_detector = threading.Thread(
        target=_stall_detector, name="stall_detector", daemon=True
    )
    stall_detector.start()
    log.info(
        "Stall-detector thread started (checks every %dm, restarts physio if stalled >%dm)",
        _PHYSIO_CHECK_SECS // 60, _STALL_MINUTES,
    )

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
    p.add_argument("--arms",             type=int, nargs="+", default=[1, 2, 3], choices=list(range(1, 25)),
                   help="Which experiments to run by number (1=Exp0/Oldschool … 8=Exp7/HPVOOT-CoT)")
    p.add_argument("--workers",          type=int, default=8,
                   help="Pool size: number of shared worker slots across all experiments (default 8). "
                        "All slots share Bedrock quota; round-robin picks the lagger arm each time. "
                        "8 is safe for Scout on us-east-1; raise carefully to avoid quota triggers.")
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
