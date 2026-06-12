"""
tensornets/scripts/watchdog.py — Training watchdog with auto-restart and Windows notifications.

Monitors:
  1. Physio/MCTS server  (localhost:8765/health)
  2. Node.js app server  (localhost:8247/api/health  or  /api/benchmarks/runs)
  3. Training progress   (newest episode JSONL file mtime)

Actions on failure:
  • Physio server down  → restart it automatically (uvicorn on port 8765)
  • Node server down    → log warning only (node server managed separately)
  • Training stall      → Windows toast + log; optionally auto-restart training

Usage
-----
    # Run alongside a training session:
    cd tensornets
    python scripts/watchdog.py --run-dir runs/run_024 --arms 1 7 8

    # Dry-run (monitor only, never auto-restart):
    python scripts/watchdog.py --run-dir runs/run_024 --dry-run

    # Tune stall threshold (default 30 min):
    python scripts/watchdog.py --run-dir runs/run_024 --stall-minutes 20

Options
-------
    --run-dir       Path to the active run directory (relative to tensornets/)
    --arms          Space-separated arm indices passed to train.py on auto-restart
    --episodes      Episode budget (default 500) passed to train.py on auto-restart
    --stall-minutes Minutes of no new episodes before declaring a stall (default 30)
    --poll-seconds  Health-check interval in seconds (default 120)
    --dry-run       Monitor and notify, but never restart anything
    --no-notify     Disable Windows toast notifications
    --status-file   JSON file written every poll cycle (default: watchdog_status.json)
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  watchdog  %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("watchdog.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("watchdog")

# ── Constants ─────────────────────────────────────────────────────────────────
PHYSIO_HEALTH_URL = os.environ.get("TENSORNETS_URL", "http://localhost:8765") + "/health"
NODE_HEALTH_URL   = os.environ.get("COMPANION_URL",  "http://localhost:8247") + "/api/benchmarks/runs"

# The tensornets root (one level up from scripts/)
_TENSORNETS_ROOT = pathlib.Path(__file__).resolve().parents[1]

# How many consecutive physio-server failures before we attempt a restart
_PHYSIO_FAIL_THRESHOLD = 3

# Max age (seconds) of a physio server restart attempt — don't spam restarts
_PHYSIO_RESTART_COOLDOWN = 300   # 5 minutes


# ── Windows toast notification ────────────────────────────────────────────────
def _toast(title: str, body: str) -> None:
    """Send a Windows toast notification via PowerShell.  Non-fatal if it fails."""
    ps_script = f"""
$app = 'PowerShell'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] | Out-Null
$template = [Windows.UI.Notifications.ToastTemplateType]::ToastText02
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template)
$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('{title}')) | Out-Null
$xml.GetElementsByTagName('text')[1].AppendChild($xml.CreateTextNode('{body}')) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show($toast)
"""
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
            timeout=10,
            capture_output=True,
        )
    except Exception as exc:
        log.debug("Toast notification failed (non-fatal): %s", exc)


def _alert(title: str, body: str, notify: bool) -> None:
    log.warning("ALERT: %s — %s", title, body)
    if notify:
        _toast(title, body)


# ── Health checks ─────────────────────────────────────────────────────────────
def _check_url(url: str, timeout: float = 8.0) -> tuple[bool, str]:
    """Returns (ok, reason)."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return True, f"HTTP {resp.status}"
    except urllib.error.HTTPError as e:
        # 4xx from our own health endpoint means server is up but route missing
        return (e.code < 500), f"HTTP {e.code}"
    except Exception as e:
        return False, str(e)


def _newest_episode_mtime(run_dir: pathlib.Path) -> float | None:
    """Return mtime (epoch seconds) of the most recently modified episode JSONL file."""
    best: float | None = None
    for ep_file in run_dir.rglob("episode_*.jsonl"):
        mtime = ep_file.stat().st_mtime
        if best is None or mtime > best:
            best = mtime
    return best


def _episode_counts_from_disk(run_dir: pathlib.Path) -> dict[str, int]:
    counts = {}
    for rs in run_dir.glob("*/checkpoints/run_state.json"):
        arm = rs.parent.parent.name
        try:
            d = json.loads(rs.read_text())
            counts[arm] = d.get("ep_count", 0)
        except Exception:
            pass
    return counts


# ── Physio server restart ──────────────────────────────────────────────────────
def _restart_physio_server(dry_run: bool) -> bool:
    """Attempt to (re)start uvicorn on port 8765.  Returns True if launched."""
    if dry_run:
        log.info("DRY-RUN: would restart physio server (uvicorn on :8765)")
        return False

    log.warning("Attempting to restart physio/MCTS server on :8765 …")

    # Kill any zombie listener on 8765 first (Windows netstat approach)
    try:
        result = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True, text=True, timeout=10
        )
        for line in result.stdout.splitlines():
            if "8765" in line and "LISTENING" in line:
                parts = line.split()
                pid = int(parts[-1])
                if pid > 4:   # skip System
                    subprocess.run(["taskkill", "/F", "/PID", str(pid)],
                                   capture_output=True)
                    log.info("Killed stale PID %d on :8765", pid)
    except Exception as exc:
        log.debug("Could not kill stale listener: %s", exc)

    time.sleep(2)

    # Start fresh uvicorn
    try:
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "server:app",
             "--host", "127.0.0.1", "--port", "8765"],
            cwd=str(_TENSORNETS_ROOT),
            env={**os.environ, "PYTHONPATH": str(_TENSORNETS_ROOT)},
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        log.info("Physio server launched (PID %d)", proc.pid)
        return True
    except Exception as exc:
        log.error("Failed to restart physio server: %s", exc)
        return False


# ── Training restart ──────────────────────────────────────────────────────────
def _restart_training(run_dir: str, arms: list[int], episodes: int, dry_run: bool) -> bool:
    if dry_run:
        log.info(
            "DRY-RUN: would restart training  run-dir=%s  arms=%s  episodes=%d",
            run_dir, arms, episodes,
        )
        return False

    log.warning("Restarting training: run-dir=%s  arms=%s  episodes=%d", run_dir, arms, episodes)
    cmd = [
        sys.executable, "-m", "tensornets.a3c.train",
        "--run-dir", run_dir,
        "--episodes", str(episodes),
    ]
    if arms:
        cmd += ["--arms"] + [str(a) for a in arms]

    try:
        subprocess.Popen(
            cmd,
            cwd=str(_TENSORNETS_ROOT),
            env={**os.environ, "PYTHONPATH": str(_TENSORNETS_ROOT)},
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        return True
    except Exception as exc:
        log.error("Failed to restart training: %s", exc)
        return False


# ── Main watchdog loop ────────────────────────────────────────────────────────
def _format_age(seconds: float) -> str:
    if seconds < 120:
        return f"{int(seconds)}s"
    if seconds < 3600:
        return f"{int(seconds/60)}m"
    return f"{seconds/3600:.1f}h"


def watchdog(
    run_dir: str,
    arms: list[int],
    episodes: int,
    stall_minutes: int,
    poll_seconds: int,
    dry_run: bool,
    notify: bool,
    status_file: str,
    auto_restart_training: bool,
) -> None:
    abs_run_dir = _TENSORNETS_ROOT / run_dir
    stall_threshold = stall_minutes * 60
    physio_fail_streak = 0
    last_physio_restart = 0.0
    training_restarts = 0

    log.info(
        "Watchdog started  run_dir=%s  poll=%ds  stall=%dm  dry_run=%s",
        run_dir, poll_seconds, stall_minutes, dry_run,
    )

    while True:
        now = time.time()
        status: dict = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "physio_ok": False,
            "node_ok": False,
            "stalled": False,
            "newest_episode_age_s": None,
            "episode_counts": {},
            "training_restarts": training_restarts,
        }

        # ── 1. Physio server health ───────────────────────────────────────────
        physio_ok, physio_reason = _check_url(PHYSIO_HEALTH_URL)
        status["physio_ok"] = physio_ok
        status["physio_reason"] = physio_reason

        if physio_ok:
            if physio_fail_streak > 0:
                log.info("Physio server recovered after %d failed checks", physio_fail_streak)
            physio_fail_streak = 0
        else:
            physio_fail_streak += 1
            log.warning(
                "Physio server DOWN (%s)  streak=%d/%d",
                physio_reason, physio_fail_streak, _PHYSIO_FAIL_THRESHOLD,
            )
            if physio_fail_streak >= _PHYSIO_FAIL_THRESHOLD:
                cooldown_left = _PHYSIO_RESTART_COOLDOWN - (now - last_physio_restart)
                if cooldown_left <= 0:
                    _alert(
                        "Physio server down",
                        f"streak={physio_fail_streak}  auto-restarting…",
                        notify,
                    )
                    ok = _restart_physio_server(dry_run)
                    if ok:
                        last_physio_restart = time.time()
                        physio_fail_streak = 0
                        # Give it a moment to come up before next check
                        time.sleep(8)
                else:
                    log.info(
                        "Physio restart cooldown: %.0fs remaining", cooldown_left
                    )

        # ── 2. Node server health ─────────────────────────────────────────────
        node_ok, node_reason = _check_url(NODE_HEALTH_URL, timeout=10.0)
        status["node_ok"] = node_ok
        if not node_ok:
            log.warning("Node server DOWN (%s)  — manual restart required", node_reason)
            _alert("Node server DOWN", "Manual restart needed on port 8247", notify)

        # ── 3. Training stall detection ───────────────────────────────────────
        newest_mtime = _newest_episode_mtime(abs_run_dir)
        ep_counts    = _episode_counts_from_disk(abs_run_dir)
        status["episode_counts"] = ep_counts

        all_done = all(v >= episodes for v in ep_counts.values()) if ep_counts else False
        status["all_done"] = all_done

        if newest_mtime is not None:
            age = now - newest_mtime
            status["newest_episode_age_s"] = round(age, 1)
            age_str = _format_age(age)

            if all_done:
                log.info("All arms complete.  Last episode: %s ago.  Watchdog will keep running.", age_str)
            elif age > stall_threshold:
                status["stalled"] = True
                counts_str = "  ".join(
                    f"{arm.replace('arm_','')}={cnt}" for arm, cnt in sorted(ep_counts.items())
                )
                log.error(
                    "STALL DETECTED  last_episode=%s ago  counts: %s",
                    age_str, counts_str,
                )
                _alert(
                    f"Training stalled ({age_str})",
                    f"No new episodes.  {counts_str}",
                    notify,
                )
                if auto_restart_training and arms:
                    incomplete_arms = [
                        arm for arm, cnt in ep_counts.items() if cnt < episodes
                    ]
                    if incomplete_arms:
                        # Only restart if physio is healthy (otherwise restarting won't help)
                        if physio_ok:
                            restarted = _restart_training(run_dir, arms, episodes, dry_run)
                            if restarted:
                                training_restarts += 1
                                log.info(
                                    "Training restarted (attempt #%d)", training_restarts
                                )
                        else:
                            log.warning(
                                "Skip training restart — physio server not yet healthy"
                            )
            else:
                log.info(
                    "Training OK  last_episode=%s ago  counts: %s",
                    age_str,
                    "  ".join(
                        f"{arm.replace('arm_','')}={cnt}/{episodes}"
                        for arm, cnt in sorted(ep_counts.items())
                    ),
                )
        else:
            log.warning("No episode files found in %s", abs_run_dir)

        # ── 4. Write status file ──────────────────────────────────────────────
        try:
            sf = _TENSORNETS_ROOT / status_file
            sf.write_text(json.dumps(status, indent=2))
        except Exception as exc:
            log.debug("Status file write failed: %s", exc)

        time.sleep(poll_seconds)


# ── CLI ───────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Training watchdog — monitors physio server and episode progress."
    )
    parser.add_argument("--run-dir",           default="runs/run_024",
                        help="Active run directory (relative to tensornets/)")
    parser.add_argument("--arms",              nargs="*", type=int, default=[],
                        help="Arm indices for auto-restart of training")
    parser.add_argument("--episodes",          type=int, default=500,
                        help="Episode budget per arm (default: 500)")
    parser.add_argument("--stall-minutes",     type=int, default=30,
                        help="Minutes with no new episodes = stall (default: 30)")
    parser.add_argument("--poll-seconds",      type=int, default=120,
                        help="Health-check interval in seconds (default: 120)")
    parser.add_argument("--dry-run",           action="store_true",
                        help="Monitor and alert only; never restart anything")
    parser.add_argument("--no-notify",         action="store_true",
                        help="Disable Windows toast notifications")
    parser.add_argument("--auto-restart-training", action="store_true",
                        help="Automatically restart training on stall (only if physio is up)")
    parser.add_argument("--status-file",       default="watchdog_status.json",
                        help="JSON status output file (default: watchdog_status.json)")
    args = parser.parse_args()

    watchdog(
        run_dir=args.run_dir,
        arms=args.arms,
        episodes=args.episodes,
        stall_minutes=args.stall_minutes,
        poll_seconds=args.poll_seconds,
        dry_run=args.dry_run,
        notify=not args.no_notify,
        status_file=args.status_file,
        auto_restart_training=args.auto_restart_training,
    )


if __name__ == "__main__":
    main()
