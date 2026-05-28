"""
backfill_runs.py — Import ALL A3C run episode data from disk into the SQLite benchmark DB.

Usage (from tensornets/ directory):
    python backfill_run013.py              # imports only runs with no DB data
    python backfill_run013.py --force      # re-imports all runs (clears existing)
    python backfill_run013.py run_013      # import a specific run only

What it does:
  1. Scans tensornets/runs/ for all run_* directories
  2. For each run and each experiment (htn_mcts, oldschool, hysteresis_prompt):
       - Creates one htn_benchmark_runs row
       - Creates one htn_benchmark_episodes row per episode_*.jsonl file
       - Creates one htn_benchmark_turns row per turn line
       - Finalises each run row with aggregate metrics

Note: In this project, what the original train.py called "arms" are independent
training environments / experiments. Each is trained separately and compared as
experiments, not as parallel arms of a single run.

The benchmark tables are created by addHTNBenchmarkTables() which runs on Node startup.
This script writes directly to the SQLite file to avoid needing the JS server running.
"""

import json
import pathlib
import sqlite3
import sys
import uuid
from datetime import datetime, timezone

# ── Paths ─────────────────────────────────────────────────────────────────────

HERE       = pathlib.Path(__file__).parent
RUNS_DIR   = HERE / "runs"
DB_PATH    = HERE.parent / "data" / "dbs" / "care_circle_dev.db"

EXPERIMENTS = ["htn_mcts", "oldschool", "hysteresis_prompt"]  # formerly "arms"

# Known run timestamps (UTC) — used for rows without file-level timestamps.
# Format: { run_name: (start_utc, end_utc) }
_KNOWN_RUN_TIMES: dict[str, tuple[datetime, datetime]] = {
    "run_013": (
        datetime(2026, 5, 26, 9, 58, 37, tzinfo=timezone.utc),
        datetime(2026, 5, 26, 22, 13, 35, tzinfo=timezone.utc),
    ),
    "run_009": (
        datetime(2026, 5, 26, 0, 30, 0, tzinfo=timezone.utc),
        datetime(2026, 5, 26, 9, 58, 0, tzinfo=timezone.utc),
    ),
    "run_008": (
        datetime(2026, 5, 25, 22, 0, 0, tzinfo=timezone.utc),
        datetime(2026, 5, 26, 0, 30, 0, tzinfo=timezone.utc),
    ),
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def ts(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)

def safe_mean(vals):
    vals = [v for v in vals if v is not None]
    return round(sum(vals) / len(vals), 4) if vals else None

def extract_scenario_id(lines: list) -> str:
    """Pull scenario id from the session_goal or therapeutic_mode field."""
    if not lines:
        return "unknown"
    state = lines[0].get("state", {})
    goal  = state.get("session_goal", "")
    # Map well-known goals to canonical scenario ids
    goal_lower = goal.lower()
    for keyword, sid in [
        ("deaddiction", "deaddiction_alcohol"),
        ("alcohol",     "deaddiction_alcohol"),
        ("flooding",    "flooding_social_anxiety"),
        ("billing",     "billing_denial_mcts_demo"),
        ("negotiation", "negotiation_undefined"),
        ("relapse",     "multi_agent_relapse_prevention"),
        ("hypertension","angina_lifestyle_resistance"),
        ("angina",      "angina_lifestyle_resistance"),
        ("depression",  "depression_passive_suicidality"),
        ("suicid",      "depression_passive_suicidality"),
        ("family",      "family_care_circle_coordination"),
    ]:
        if keyword in goal_lower:
            return sid
    mode = state.get("therapeutic_mode", "standard")
    return f"{mode}_scenario"


def process_experiment(db: sqlite3.Connection, run_name: str, experiment: str) -> dict:
    run_dir  = RUNS_DIR / run_name
    ep_dir   = run_dir / f"arm_{experiment}" / "episodes"

    # Determine timestamps
    known = _KNOWN_RUN_TIMES.get(run_name)
    if known:
        run_start_utc, run_end_utc = known
    else:
        # Use dir mtime as a rough approximation
        mtime = run_dir.stat().st_mtime
        run_start_utc = datetime.fromtimestamp(mtime - 3600, tz=timezone.utc)
        run_end_utc   = datetime.fromtimestamp(mtime, tz=timezone.utc)

    if not ep_dir.exists():
        print(f"  [WARN] No episodes directory for experiment={experiment} in {run_name}")
        return {}

    # ── Create run row ────────────────────────────────────────────────────────
    run_id = str(uuid.uuid4())
    db.execute(
        """INSERT OR IGNORE INTO htn_benchmark_runs
           (run_id, arm, label, scenario_set, config, started_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        [
            run_id,
            experiment,
            f"{run_name} / {experiment}",
            "a3c_training",
            json.dumps({
                "run_dir":        run_name,
                "experiment":     experiment,
                "backfilled":     True,
            }),
            ts(run_start_utc),
        ]
    )
    print(f"  Created run_id={run_id[:8]}... for {run_name}/{experiment}")

    ep_files  = sorted(ep_dir.glob("episode_*.jsonl"))
    ep_count  = 0
    all_rewards     = []
    all_stress_aucs = []
    goals_achieved  = []

    for ep_file in ep_files:
        try:
            lines = [
                json.loads(l)
                for l in ep_file.read_text(encoding="utf-8").splitlines()
                if l.strip()
            ]
        except Exception as exc:
            print(f"    [SKIP] {ep_file.name}: {exc}")
            continue

        if not lines:
            continue

        episode_id   = ep_file.stem.replace("episode_", "")
        scenario_id  = extract_scenario_id(lines)

        # Episode-level aggregates
        scalars      = [l.get("scalar_reward") for l in lines if "scalar_reward" in l]
        cumulative   = round(sum(scalars), 4) if scalars else None
        mean_reward  = safe_mean(scalars)
        n_turns      = len(lines)

        # Stress AUC: trapezoidal over turn stress_index values
        stresses = [l.get("state", {}).get("stress_index") for l in lines]
        stresses = [s for s in stresses if s is not None]
        if len(stresses) >= 2:
            stress_auc = round(sum(
                (stresses[i] + stresses[i+1]) / 2
                for i in range(len(stresses) - 1)
            ) / len(stresses), 4)
        else:
            stress_auc = stresses[0] if stresses else None

        # Goal achieved: final goal_progress >= 0.5
        final_gp = lines[-1].get("reward", {}).get("goal_progress") if lines else None
        goal_achieved = 1 if (final_gp is not None and final_gp >= 0.5) else 0

        # Approximate episode timestamps using file mtime and turn count
        ep_started_at  = int(ep_file.stat().st_mtime * 1000) - (n_turns * 90_000)
        ep_completed   = int(ep_file.stat().st_mtime * 1000)

        db.execute(
            """INSERT OR IGNORE INTO htn_benchmark_episodes
               (episode_id, run_id, scenario_id, persona_id, arm,
                turn_count, cumulative_reward, stress_auc, goal_achieved,
                started_at, completed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                episode_id, run_id, scenario_id, "", experiment,
                n_turns, cumulative, stress_auc, goal_achieved,
                ep_started_at, ep_completed,
            ]
        )

        # ── Turn rows ─────────────────────────────────────────────────────────
        for turn_line in lines:
            turn_no = turn_line.get("turn", 0)
            state   = turn_line.get("state", {})
            reward  = turn_line.get("reward", {})
            judge   = turn_line.get("judge", {})
            tokens  = turn_line.get("tokens", {})

            db.execute(
                """INSERT OR IGNORE INTO htn_benchmark_turns
                   (episode_id, run_id, arm, turn_number,
                    action, response, hrv_ms, stress_label, stress_index,
                    reward_stress, reward_trust, reward_goal, reward_info, reward_consistency,
                    judge_clinical, judge_empathy, judge_safety, judge_goal, judge_strategy,
                    discrepancy_flag, tokens_scout, tokens_maverick, latency_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    episode_id, run_id, experiment, turn_no,
                    turn_line.get("action", ""),
                    turn_line.get("response", ""),
                    state.get("physio", {}).get("hrv_ms"),
                    state.get("stress_bucket", ""),
                    state.get("stress_index"),
                    reward.get("stress"),
                    reward.get("trust_delta"),
                    reward.get("goal_progress"),
                    reward.get("info_coverage"),
                    reward.get("consistency"),
                    judge.get("scorer_continuous"),
                    None,
                    1.0 if not judge.get("critical_failure") else 0.0,
                    reward.get("goal_progress"),
                    None,
                    1 if turn_line.get("discrepancy") else 0,
                    tokens.get("scout", 0),
                    tokens.get("maverick", 0),
                    turn_line.get("latency_ms"),
                ]
            )

        ep_count += 1
        if mean_reward is not None:   all_rewards.append(mean_reward)
        if stress_auc  is not None:   all_stress_aucs.append(stress_auc)
        goals_achieved.append(goal_achieved)

    # ── Finalise run ──────────────────────────────────────────────────────────
    goal_pct = round(100 * sum(goals_achieved) / len(goals_achieved), 1) if goals_achieved else None
    db.execute(
        """UPDATE htn_benchmark_runs
           SET completed_at=?, episode_count=?, mean_reward=?,
               mean_stress_auc=?, goal_achieved_pct=?
           WHERE run_id=?""",
        [
            ts(run_end_utc),
            ep_count,
            safe_mean(all_rewards),
            safe_mean(all_stress_aucs),
            goal_pct,
            run_id,
        ]
    )

    print(f"  Finalised: {ep_count} episodes, mean_reward={safe_mean(all_rewards)}, "
          f"goal_achieved={goal_pct}%")
    return {"run_id": run_id, "ep_count": ep_count}


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if not DB_PATH.exists():
        print(f"ERROR: DB not found at {DB_PATH}")
        return

    print(f"Opening DB: {DB_PATH}")
    db = sqlite3.connect(str(DB_PATH))
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=OFF")

    # Verify tables exist
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    required = {"htn_benchmark_runs", "htn_benchmark_episodes", "htn_benchmark_turns"}
    missing  = required - tables
    if missing:
        print(f"ERROR: Missing tables: {missing}. Start node server first to create schema.")
        db.close()
        return

    # Check for existing run_013 data
    force = "--force" in sys.argv
    # Determine which runs to import
    specific_run = next((a for a in sys.argv[1:] if a.startswith("run_")), None)
    if specific_run:
        run_names = [specific_run]
    else:
        run_names = sorted(d.name for d in RUNS_DIR.iterdir() if d.is_dir() and d.name.startswith("run_"))

    print(f"Runs to process: {run_names}")

    total_eps = 0
    for run_name in run_names:
        # Skip if already imported (unless --force)
        already = db.execute(
            "SELECT COUNT(*) FROM htn_benchmark_runs WHERE label LIKE ?",
            [f"{run_name}%"]
        ).fetchone()[0]
        if already > 0 and not force:
            print(f"\n[SKIP] {run_name} already has {already} rows. Use --force to re-import.")
            continue
        if already > 0 and force:
            db.execute("DELETE FROM htn_benchmark_turns WHERE run_id IN "
                       "(SELECT run_id FROM htn_benchmark_runs WHERE label LIKE ?)",
                       [f"{run_name}%"])
            db.execute("DELETE FROM htn_benchmark_episodes WHERE run_id IN "
                       "(SELECT run_id FROM htn_benchmark_runs WHERE label LIKE ?)",
                       [f"{run_name}%"])
            db.execute("DELETE FROM htn_benchmark_runs WHERE label LIKE ?",
                       [f"{run_name}%"])
            print(f"  Cleared existing data for {run_name}.")

        print(f"\n=== {run_name} ===")
        for experiment in EXPERIMENTS:
            result = process_experiment(db, run_name, experiment)
            total_eps += result.get("ep_count", 0)

    db.commit()

    # ── Verify ────────────────────────────────────────────────────────────────
    runs  = db.execute("SELECT label, arm, episode_count, mean_reward, goal_achieved_pct FROM htn_benchmark_runs ORDER BY label, arm").fetchall()
    turns = db.execute("SELECT COUNT(*) FROM htn_benchmark_turns").fetchone()[0]

    print(f"\n{'='*70}")
    print("VERIFICATION")
    print(f"{'='*70}")
    print(f"{'Run/Experiment':<35} {'Episodes':<10} {'Mean R':<10} {'Goal%'}")
    print("-"*70)
    for r in runs:
        label = r[0][:34]
        print(f"{label:<35} {r[2] or 0:<10} {r[3] or 'N/A':<10} {r[4] or 'N/A'}")
    print(f"\nTotal turns in DB: {turns}")
    print(f"\nDone. {total_eps} new episodes imported.")

    db.close()


if __name__ == "__main__":
    main()