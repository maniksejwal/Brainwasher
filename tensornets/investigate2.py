import sqlite3
db = sqlite3.connect('D:/Projects/MMT/Chatbot/Brainwasher 3/data/dbs/care_circle_dev.db')

# Correct column names
ep_cols = [r[1] for r in db.execute("PRAGMA table_info(htn_benchmark_episodes)").fetchall()]
print("Episode cols:", ep_cols)

turn_cols = [r[1] for r in db.execute("PRAGMA table_info(htn_benchmark_turns)").fetchall()]
print("Turn cols:", turn_cols)

# Episode metric ranges by arm
stats = db.execute("""
    SELECT arm,
    COUNT(*) as n,
    AVG(cumulative_reward) as avg_cumul,
    MIN(cumulative_reward) as min_cumul,
    MAX(cumulative_reward) as max_cumul,
    AVG(stress_auc) as avg_stress_auc,
    AVG(trust_delta_final) as avg_trust_delta,
    AVG(turns_to_goal) as avg_turns_to_goal
    FROM htn_benchmark_episodes GROUP BY arm
""").fetchall()
print("\n=== EPISODE METRIC RANGES BY ARM ===")
for r in stats:
    print(r)

# Oldschool run_008 vs run_009: scenario mix difference
print("\n=== OLDSCHOOL SCENARIO MIX RUN_008 vs RUN_009 ===")
mix = db.execute("""
    SELECT r.label, e.scenario_id, COUNT(*) as n, AVG(e.cumulative_reward) as avg_r
    FROM htn_benchmark_episodes e JOIN htn_benchmark_runs r ON r.run_id = e.run_id
    WHERE e.arm = 'oldschool' AND r.label IN ('run_008 / oldschool', 'run_009 / oldschool')
    GROUP BY r.label, e.scenario_id
    ORDER BY r.label, avg_r DESC
""").fetchall()
for r in mix:
    print(r)

# Prompt versions columns
try:
    pv_cols = [r[1] for r in db.execute("PRAGMA table_info(prompt_versions)").fetchall()]
    print("\nPrompt_versions cols:", pv_cols)
    pv = db.execute("SELECT * FROM prompt_versions ORDER BY rowid DESC LIMIT 5").fetchall()
    for r in pv: print(r)
except Exception as e:
    print("prompt_versions error:", e)

db.close()
