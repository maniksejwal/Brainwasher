import sqlite3, json
db = sqlite3.connect('D:/Projects/MMT/Chatbot/Brainwasher 3/data/dbs/care_circle_dev.db')

# 1. Check persona_id distribution in episodes
personas = db.execute('''
    SELECT persona_id, COUNT(*) as eps, AVG(cumulative_reward) as avg_r, AVG(goal_achieved) as goal_rate
    FROM htn_benchmark_episodes
    GROUP BY persona_id ORDER BY eps DESC LIMIT 20
''').fetchall()
print("=== PERSONA DISTRIBUTION ===")
for p in personas:
    print(p)

# 2. Scenario goal rates
sc = db.execute('''
    SELECT e.arm, e.scenario_id, COUNT(*) as eps, AVG(e.goal_achieved) as goal_rate, AVG(e.cumulative_reward) as avg_r
    FROM htn_benchmark_episodes e
    GROUP BY e.arm, e.scenario_id ORDER BY e.scenario_id, e.arm
''').fetchall()
print("\n=== SCENARIO GOAL RATES (sample) ===")
for r in sc[:12]:
    print(r)

# 3. Physio data in turns - are hrv_ms / stress values populated?
physio = db.execute('''
    SELECT COUNT(*) as total,
    SUM(CASE WHEN hrv_ms IS NOT NULL AND hrv_ms > 0 THEN 1 ELSE 0 END) as has_hrv,
    SUM(CASE WHEN stress_index IS NOT NULL THEN 1 ELSE 0 END) as has_stress,
    AVG(hrv_ms) as avg_hrv, AVG(stress_index) as avg_stress_idx
    FROM htn_benchmark_turns
''').fetchone()
print("\n=== PHYSIO IN TURNS ===")
print(physio)

# 4. What does max mean_reward across runs look like?
runs = db.execute('SELECT arm, label, mean_reward FROM htn_benchmark_runs ORDER BY mean_reward DESC LIMIT 6').fetchall()
print("\n=== TOP RUNS BY MEAN REWARD ===")
for r in runs:
    print(r)

db.close()
