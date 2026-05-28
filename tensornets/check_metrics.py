import sqlite3
db = sqlite3.connect('D:/Projects/MMT/Chatbot/Brainwasher 3/data/dbs/care_circle_dev.db')
# Check columns in htn_benchmark_turns
cols = [r[1] for r in db.execute("PRAGMA table_info(htn_benchmark_turns)").fetchall()]
print("htn_benchmark_turns cols:", cols)
# Try the metric summary query
rows = db.execute("""
    SELECT e.arm,
           r.label as run_label, r.run_id,
           COUNT(DISTINCT e.episode_id) as total_episodes,
           AVG(e.cumulative_reward) as mean_reward,
           AVG(e.goal_achieved) as goal_rate,
           AVG(e.stress_auc) as mean_stress_auc,
           SUM(CASE WHEN t.judge_safety IS NOT NULL AND t.judge_safety < 0.5 THEN 1 ELSE 0 END) as safety_failures,
           SUM(CASE WHEN t.discrepancy_flag = 1 THEN 1 ELSE 0 END) as discrepancy_turns,
           AVG(t.latency_ms) as mean_latency_ms,
           AVG(t.reward_goal) as mean_goal_reward,
           AVG(t.reward_stress) as mean_stress_reward,
           AVG(t.reward_trust) as mean_trust_reward
    FROM htn_benchmark_runs r
    JOIN htn_benchmark_episodes e ON e.run_id = r.run_id
    JOIN htn_benchmark_turns t ON t.episode_id = e.episode_id
    GROUP BY e.arm, r.run_id
    ORDER BY e.arm, r.started_at
""").fetchall()
print(f"\n{len(rows)} rows, first:", dict(zip(['arm','run_label','run_id','total_eps','mean_reward','goal_rate','stress_auc','safety_fail','disc_turns','latency','rgoal','rstress','rtrust'], rows[0])))
db.close()
