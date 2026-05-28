import sqlite3, json, sys

db = sqlite3.connect('D:/Projects/MMT/Chatbot/Brainwasher 3/data/dbs/care_circle_dev.db')

# 1. Oldschool episode sequence — why did it start high then drop?
print("=== OLDSCHOOL REWARDS BY EPISODE (first 25) ===")
rows = db.execute("""
    SELECT r.label, e.episode_id, e.scenario_id, e.cumulative_reward,
           e.goal_achieved, e.stress_auc, e.trust_delta_final,
           e.started_at, e.turns_to_goal
    FROM htn_benchmark_episodes e
    JOIN htn_benchmark_runs r ON r.run_id = e.run_id
    WHERE e.arm = 'oldschool'
    ORDER BY e.started_at
    LIMIT 25
""").fetchall()
for r in rows:
    print(r)

# 2. Discrepancy flag logic - does any turn have it set?
print("\n=== DISCREPANCY FLAGS ===")
disc = db.execute("""
    SELECT arm, COUNT(*) as total_turns,
    SUM(CASE WHEN discrepancy_flag = 1 THEN 1 ELSE 0 END) as disc_turns,
    SUM(CASE WHEN discrepancy_flag IS NULL THEN 1 ELSE 0 END) as null_turns
    FROM htn_benchmark_turns GROUP BY arm
""").fetchall()
for r in disc:
    print(r)

# 3. Prompt versions table
print("\n=== PROMPT VERSIONS (recent 5) ===")
try:
    pv = db.execute("SELECT version_id, name, created_at, notes FROM prompt_versions ORDER BY created_at DESC LIMIT 5").fetchall()
    for r in pv:
        print(r)
except Exception as e:
    print("Error:", e)

# 4. What scenarios exist beyond the 10?
print("\n=== ALL SCENARIOS IN DB ===")
all_sc = [r[0] for r in db.execute("SELECT DISTINCT scenario_id FROM htn_benchmark_episodes").fetchall()]
print(f"Count: {len(all_sc)}", all_sc)

# 5. Check training scenario files count
import os, pathlib
sc_dir = pathlib.Path("D:/Projects/MMT/Chatbot/Brainwasher 3/training/simulation/scenarios")
sc_files = list(sc_dir.glob("*.js")) if sc_dir.exists() else []
print(f"\n=== SCENARIO FILES ({len(sc_files)}) ===")
for f in sorted(sc_files):
    print(f.name)

# 6. Check stress_auc range and trust_delta stats  
print("\n=== EPISODE METRIC RANGES ===")
stats = db.execute("""
    SELECT arm,
    COUNT(*) as n,
    AVG(cumulative_reward) as avg_cumul,
    AVG(stress_auc) as avg_stress_auc,
    AVG(trust_delta_final) as avg_trust_delta,
    AVG(turns_to_goal) as avg_turns_to_goal,
    AVG(token_count_scout) as avg_tokens_scout,
    AVG(latency_ms_mean) as avg_latency
    FROM htn_benchmark_episodes GROUP BY arm
""").fetchall()
for r in stats:
    print(r)

db.close()
