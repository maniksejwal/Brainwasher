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
    total_episodes: int = 1000,
    checkpoint_every: int = 50,
    prior_path: Optional[str] = None,
    scenario_url: Optional[str] = None,
    patient_mode: str = "llm",
    arms: Optional[list[int]] = None,
) -> None:
    """
    Run (or resume) the three-arm A3C training loop.

    Each arm has its own independent Actor + Critic.  Arms run in round-robin
    order.  Comparing their learning curves tells us which *environment*
    (MCTS, JS companion, hysteresis-prompt) enables better policy learning.

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
    from tensornets.a3c.prompt_optimizer import DEFAULT_PROMPTS, maybe_improve_prompt

    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)

    arm_classes = _get_arm_classes()
    selected_arm_classes = [arm_classes[i - 1] for i in (arms or [1, 2, 3])]

    # ── Per-arm state: each arm gets its own Actor, Critic, and checkpoint dir ─
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

        arm_states.append({
            "name":             arm_name,
            "worker":           worker,
            "actor":            actor,
            "critic":           critic,
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
        })

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
                str(s["arm_dir"]), [s["name"]], total_episodes, patient_mode,
            )
            if s["db_run_id"]:
                log.info("Arm %s: DB run record: %s", s["name"], s["db_run_id"])

    # ── Emergency checkpoint on interrupt ────────────────────────────────────
    _last_ep = [0]

    def _emergency_save(signum, frame):
        log.warning("Signal %d — writing emergency checkpoints", signum)
        for s in arm_states:
            s["worker"].save_checkpoint(s["ep_count"])
            _save_run_state(s["state_path"], {
                "last_completed_episode": s["ep_count"],
                "ep_count":              s["ep_count"],
                "successful_eps":        s["successful"],
                "db_run_id":             s["db_run_id"],
                "last_session_memory":   s["prior_sess"],
                "emergency":             True,
                "signal":                signum,
            })
        sys.exit(0)

    signal.signal(signal.SIGINT,  _emergency_save)
    signal.signal(signal.SIGTERM, _emergency_save)

    # ── Main loop — round-robin across arms, each updating only its own policy ─
    for ep in range(total_episodes):
        s      = arm_states[ep % len(arm_states)]
        worker = s["worker"]

        # Skip episodes this arm already completed before a resume
        if s["ep_count"] < s["start_ep"]:
            s["ep_count"] += 1
            continue

        scenario  = random.choice(scenarios)
        use_prior = (s["prior_sess"] is not None) and (random.random() < 0.20)

        db_episode_id = _db_create_episode(
            s["db_run_id"], s["name"], scenario.get("scenario_id", ""), ""
        )

        try:
            summary = worker.run_episode(
                scenario      = scenario,
                prior_session = s["prior_sess"] if use_prior else None,
                patient_mode  = patient_mode,
            )
        except Exception as exc:
            log.error(
                "Episode %d failed (%s %s): %s — skipping",
                ep, s["name"], scenario.get("scenario_id", "?"), exc,
            )
            s["ep_count"] += 1
            continue

        s["successful"]  += 1
        s["ep_count"]    += 1
        s["prior_sess"]   = summary.get("session_memory")
        _last_ep[0]       = ep

        _db_finalise_episode(db_episode_id or summary.get("episode_id"), summary)

        log.info(
            "ep=%04d  arm=%-18s  scenario=%-35s  reward=%.3f  turns=%d",
            ep,
            s["name"],
            scenario.get("scenario_id", "?")[:35],
            summary.get("mean_reward", 0.0),
            summary.get("n_turns", 0),
        )

        # ── Periodic checkpoint (per arm) ─────────────────────────────────────
        if (ep + 1) % checkpoint_every == 0 or ep == total_episodes - 1:
            worker.save_checkpoint(s["ep_count"])

            # ── Conservative prompt improvement ───────────────────────────────
            # Runs at most once per IMPROVEMENT_INTERVAL episodes.  Only fires
            # when the arm's mean score is below threshold.  Arm 2 (oldschool,
            # JS companion) is excluded — its prompt lives in Node.js.
            new_prompt, s["last_improved_at"] = maybe_improve_prompt(
                arm_name         = s["name"],
                arm_dir          = s["arm_dir"],
                ep_count         = s["ep_count"],
                last_improved_at = s["last_improved_at"],
                current_prompt   = s["active_prompt"],
            )
            if new_prompt:
                s["active_prompt"] = new_prompt
                worker.update_system_prompt(new_prompt)

            _save_run_state(s["state_path"], {
                "last_completed_episode": s["ep_count"],
                "ep_count":              s["ep_count"],
                "successful_eps":        s["successful"],
                "db_run_id":             s["db_run_id"],
                "last_session_memory":   s["prior_sess"],
                "active_prompt":         s["active_prompt"],
                "last_improved_at":      s["last_improved_at"],
            })
            log.info("Checkpoint written for arm=%s at episode %d", s["name"], ep)

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
