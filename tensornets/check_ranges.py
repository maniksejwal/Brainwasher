import sqlite3
db = sqlite3.connect('D:/Projects/MMT/Chatbot/Brainwasher 3/data/dbs/care_circle_dev.db')
r = db.execute('SELECT MIN(cumulative_reward), MAX(cumulative_reward), AVG(cumulative_reward) FROM htn_benchmark_episodes').fetchone()
print('Episode rewards - min:', r[0], 'max:', r[1], 'avg:', r[2])
t = db.execute('SELECT MIN(latency_ms), MAX(latency_ms), AVG(latency_ms) FROM htn_benchmark_turns WHERE latency_ms IS NOT NULL').fetchone()
print('Latency - min:', t[0], 'max:', t[1], 'avg:', t[2])
t2 = db.execute('SELECT MIN(reward_goal), MAX(reward_goal), MIN(reward_stress), MAX(reward_stress), MIN(reward_trust), MAX(reward_trust) FROM htn_benchmark_turns').fetchone()
print('Turn rewards - goal:', t2[0], '-', t2[1], ' stress:', t2[2], '-', t2[3], ' trust:', t2[4], '-', t2[5])
db.close()
