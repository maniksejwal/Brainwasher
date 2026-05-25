"""
tensornets.a3c.train — Resumable three-arm A3C training loop.

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
      checkpoints/
        actor_<step>.json       ← Actor log-biases
        critic_<step>.json      ← Critic weights
        run_state.json          ← {last_step, arm_counters, rng_state, ...}
      episodes/
        episode_<uuid>.jsonl    ← One file per completed episode
      run_manifest.json         ← Metadata written at run start / resume

Checkpoint frequency
--------------------
A checkpoint is written every --checkpoint-every episodes (default 50).
An *emergency checkpoint* is also written on SIGINT / SIGTERM so a
Ctrl-C or OS reboot does not lose the current session's updates.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import signal
import sys
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger("tensornets.a3c.train")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)

# ── Constants ─────────────────────────────────────────────────────────────────

_ARM_CLASSES = None   # lazy import to avoid circular deps at module load
_TENSORNETS_URL = os.environ.get("TENSORNETS_URL", "http://localhost:8765")


def _get_arm_classes():
    global _ARM_CLASSES
    if _ARM_CLASSES is None:
        from tensornets.a3c.arms import Arm1Worker, Arm2Worker, Arm3Worker
        _ARM_CLASSES = [Arm1Worker, Arm2Worker, Arm3Worker]
    return _ARM_CLASSES


# ── Benchmark DB helpers (non-fatal — training continues if DB is down) ───────

def _db_post(path: str, payload: dict) -> dict:
    """Forward a benchmark record to the FastAPI bridge (which writes to JS DB)."""
    import urllib.request as _ureq
    url = f"{_TENSORNETS_URL}{path}"
    data = json.dumps(payload).encode()
    req = _ureq.Request(url, data=data,
                        headers={"Content-Type": "application/json"},
                        method="POST")
    try:
        with _ureq.urlopen(req, timeout=3) as resp:
            return json.loads(resp.read())
    except Exception as exc:
        log.debug("DB write skipped (%s %s): %s", path, payload.get("arm", ""), exc)
        return {}


def _db_create_run(run_dir: str, arms: list[str], total_episodes: int,
                   patient_mode: str) -> Optional[str]:
    r = _db_post("/benchmark/run/create", {
        "name":            Path(run_dir).name,
        "description":     f"A3C training run: arms={arms}, episodes={total_episodes}",
        "arms":            arms,
        "scenarios":       [],
        "total_episodes":  total_episodes,
        "patient_mode":    patient_mode,
    })
    return r.get("run_id")


def _db_create_episode(run_id: Optional[str], arm: str, scenario_id: str,
                       episode_id: str) -> Optional[str]:
    if not run_id:
        return None
    r = _db_post("/benchmark/episode/create", {
        "run_id":      run_id,
        "arm":         arm,
        "scenario_id": scenario_id,
        "episode_id":  episode_id,
    })
    return r.get("episode_id") or episode_id


def _db_finalise_episode(db_episode_id: Optional[str], summary: dict) -> None:
    if not db_episode_id:
        return
    _db_post("/benchmark/episode/finalise", {
        "episode_id": db_episode_id,
        "metrics": {
            "n_turns":           summary.get("n_turns", 0),
            "cumulative_reward": summary.get("cumulative_reward", 0.0),
            "mean_reward":       summary.get("mean_reward", 0.0),
        },
    })


def _db_finalise_run(run_id: Optional[str], total_eps: int,
                     successful_eps: int) -> None:
    if not run_id:
        return
    _db_post("/benchmark/run/finalise", {
        "run_id": run_id,
        "metrics": {
            "total_episodes":      total_eps,
            "successful_episodes": successful_eps,
        },
    })


# ── Checkpoint helpers ────────────────────────────────────────────────────────

def _latest_checkpoint(run_dir: Path) -> Optional[int]:
    """
    Return the highest completed step number that has BOTH actor and critic
    files.  Returns None if no valid checkpoint exists.
    """
    ckpt_dir = run_dir / "checkpoints"
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


def _load_run_state(run_dir: Path) -> dict:
    path = run_dir / "checkpoints" / "run_state.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def _save_run_state(run_dir: Path, state: dict) -> None:
    path = run_dir / "checkpoints" / "run_state.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2), encoding="utf-8")


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
    total_episodes: int = 1000,
    checkpoint_every: int = 50,
    prior_path: Optional[str] = None,
    scenario_url: Optional[str] = None,
    patient_mode: str = "llm",
    arms: Optional[list[int]] = None,
) -> None:
    """
    Run (or resume) the three-arm A3C training loop.

    Parameters
    ----------
    run_dir          : Directory for checkpoints and episode logs.
    total_episodes   : Total episodes to run across all arms combined.
    checkpoint_every : Save actor/critic every N episodes.
    prior_path       : Path to bandit_actor_prior.json from I4.  Optional.
    scenario_url     : Override for /api/scenarios endpoint URL.
    patient_mode     : 'llm' or 'scripted' (scripted for fast offline tests).
    arms             : Which arm indices to include, e.g. [1, 3].  Default: all.
    """
    from tensornets.a3c.worker import Actor, Critic
    from tensornets.a3c.scenario_loader import load_scenarios

    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)

    arm_classes = _get_arm_classes()
    selected_arms = [arm_classes[i - 1] for i in (arms or [1, 2, 3])]

    # ── Resume detection ─────────────────────────────────────────────────────
    latest_step = _latest_checkpoint(run_dir)
    run_state   = _load_run_state(run_dir)
    start_episode = 0

    if latest_step is not None:
        ckpt_dir = run_dir / "checkpoints"
        actor  = Actor.load(ckpt_dir / f"actor_{latest_step}.json")
        critic = Critic.load(ckpt_dir / f"critic_{latest_step}.json")
        start_episode = run_state.get("last_completed_episode", latest_step) + 1
        log.info(
            "Resuming from checkpoint step=%d, starting at episode %d",
            latest_step, start_episode,
        )
    else:
        # Fresh start
        if prior_path and Path(prior_path).exists():
            actor = Actor.from_prior(prior_path)
            log.info("Actor initialised from prior: %s", prior_path)
        else:
            actor = Actor.cold_start()
            log.info("Actor cold-started (uniform log-biases)")
        critic = Critic()
        log.info("Critic initialised (zero weights)")

    if start_episode >= total_episodes:
        log.info("Run already complete (%d/%d episodes done).", start_episode, total_episodes)
        return

    # ── Build workers (shared actor + critic across all arms) ────────────────
    workers = [
        ArmCls(actor=actor, critic=critic, run_dir=run_dir)
        for ArmCls in selected_arms
    ]

    # ── Scenarios ────────────────────────────────────────────────────────────
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

    # ── Manifest + DB run record ─────────────────────────────────────────────
    arm_names = [w.ARM for w in workers]
    _write_manifest(run_dir, {
        "run_dir":         str(run_dir),
        "total_episodes":  total_episodes,
        "patient_mode":    patient_mode,
        "arms":            arm_names,
        "resumed_from":    latest_step,
        "start_episode":   start_episode,
        "timestamp_start": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    db_run_id = run_state.get("db_run_id") or _db_create_run(
        str(run_dir), arm_names, total_episodes, patient_mode,
    )
    if db_run_id:
        log.info("DB run record: %s", db_run_id)

    # ── Emergency checkpoint on interrupt ────────────────────────────────────
    _emergency_step = [start_episode - 1]  # mutable container for closure

    def _emergency_save(signum, frame):
        step = _emergency_step[0]
        if step >= 0:
            log.warning("Signal %d received — writing emergency checkpoint at step %d", signum, step)
            for w in workers:
                w.save_checkpoint(step)
            _save_run_state(run_dir, {
                "last_completed_episode": step,
                "emergency": True,
                "signal": signum,
            })
        sys.exit(0)

    signal.signal(signal.SIGINT,  _emergency_save)
    signal.signal(signal.SIGTERM, _emergency_save)

    # ── Main loop ─────────────────────────────────────────────────────────────
    prior_session: Optional[dict] = run_state.get("last_session_memory")
    arm_cycle = list(range(len(workers)))
    successful_eps = 0

    for ep in range(start_episode, total_episodes):
        worker = workers[ep % len(workers)]
        scenario = random.choice(scenarios)

        # Multi-session continuity: ~20% chance of continuing a prior session
        use_prior = (prior_session is not None) and (random.random() < 0.20)
        prior_arg = prior_session if use_prior else None

        db_episode_id = _db_create_episode(
            db_run_id, worker.ARM, scenario.get("scenario_id", ""), ""
        )

        try:
            summary = worker.run_episode(
                scenario     = scenario,
                prior_session = prior_arg,
                patient_mode  = patient_mode,
            )
        except Exception as exc:
            log.error("Episode %d failed (%s %s): %s — skipping", ep, worker.ARM, scenario.get("scenario_id", "?"), exc)
            continue

        successful_eps += 1
        prior_session = summary.get("session_memory")
        _emergency_step[0] = ep

        _db_finalise_episode(db_episode_id or summary.get("episode_id"), summary)

        log.info(
            "ep=%04d  arm=%-18s  scenario=%-35s  reward=%.3f  turns=%d",
            ep,
            worker.ARM,
            scenario.get("scenario_id", "?")[:35],
            summary.get("mean_reward", 0.0),
            summary.get("n_turns", 0),
        )

        # ── Periodic checkpoint ───────────────────────────────────────────────
        if (ep + 1) % checkpoint_every == 0 or ep == total_episodes - 1:
            worker.save_checkpoint(ep)
            _save_run_state(run_dir, {
                "last_completed_episode": ep,
                "last_session_memory":   prior_session,
                "arm_at_checkpoint":     worker.ARM,
                "db_run_id":             db_run_id,
            })
            log.info("Checkpoint written at episode %d", ep)

    _db_finalise_run(db_run_id, total_episodes, successful_eps)

    _write_manifest(run_dir, {
        "timestamp_end":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "completed":      True,
        "total_episodes": total_episodes,
    })
    log.info("Training complete: %d episodes, run_dir=%s", total_episodes, run_dir)


# ── CLI entry point ───────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Resumable A3C three-arm training loop")
    p.add_argument("--run-dir",          required=True,         help="Directory for checkpoints + episode logs")
    p.add_argument("--episodes",         type=int, default=1000, help="Total episodes (not remaining — total)")
    p.add_argument("--checkpoint-every", type=int, default=50,   help="Save checkpoint every N episodes")
    p.add_argument("--prior",            default=None,           help="Path to bandit_actor_prior.json (I4 output)")
    p.add_argument("--scenario-url",     default=None,           help="Override tensornets server URL for /api/scenarios")
    p.add_argument("--patient-mode",     default="llm", choices=["llm", "scripted"], help="Patient generation mode")
    p.add_argument("--arms",             type=int, nargs="+", default=[1, 2, 3], choices=[1, 2, 3],
                   help="Which arms to include (e.g. --arms 1 3)")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    train(
        run_dir          = args.run_dir,
        total_episodes   = args.episodes,
        checkpoint_every = args.checkpoint_every,
        prior_path       = args.prior,
        scenario_url     = args.scenario_url,
        patient_mode     = args.patient_mode,
        arms             = args.arms,
    )
