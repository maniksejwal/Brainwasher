import sqlite3, json, sys

db = sqlite3.connect('D:/Projects/MMT/Chatbot/Brainwasher 3/data/dbs/care_circle_dev.db')
db.row_factory = sqlite3.Row

# Runs with timestamps
rows = db.execute('''
    SELECT r.label, r.arm, r.started_at, r.episode_count, r.mean_reward
    FROM htn_benchmark_runs r
    ORDER BY r.arm, r.started_at
''').fetchall()
print("=== RUNS ===")
for row in rows:
    print(dict(row))

# Distinct scenarios
scenarios = db.execute('SELECT DISTINCT scenario_id FROM htn_benchmark_episodes ORDER BY scenario_id').fetchall()
print("\n=== SCENARIOS ===")
print([r[0] for r in scenarios])

# Sim-related tables
tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("\n=== ALL TABLES ===")
print(tables)

# Feedback rows
fb = db.execute('SELECT COUNT(*) FROM feedback').fetchone()[0]
print("\nFeedback rows:", fb)

# Latency
lats = db.execute('SELECT COUNT(*) FROM htn_benchmark_turns WHERE latency_ms IS NOT NULL AND latency_ms > 0').fetchone()[0]
total = db.execute('SELECT COUNT(*) FROM htn_benchmark_turns').fetchone()[0]
print(f"Turns with latency: {lats} / {total}")

# Episode timestamps - are they real?
ep_ts = db.execute('SELECT arm, MIN(started_at), MAX(started_at) FROM htn_benchmark_episodes GROUP BY arm').fetchall()
print("\n=== EPISODE TIMESTAMPS ===")
for r in ep_ts:
    print(r[0], r[1], r[2])

db.close()
