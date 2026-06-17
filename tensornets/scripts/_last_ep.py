import sqlite3, datetime
db = r"d:\Projects\MMT\Chatbot\Brainwasher 3\data\dbs\care_circle_dev.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=10)
con.row_factory = sqlite3.Row
rows = con.execute(
    "SELECT arm, MAX(completed_at) as last_ep, COUNT(*) as n "
    "FROM htn_benchmark_episodes GROUP BY arm ORDER BY last_ep DESC"
).fetchall()
now = datetime.datetime.now()
for r in rows[:12]:
    ts = r["last_ep"]
    if ts and ts > 1e12:
        dt = datetime.datetime.fromtimestamp(ts / 1000)
        age_min = int((now - dt).total_seconds() / 60)
        print(f"{r['arm']:<50} n={r['n']:>5}  last={dt.strftime('%H:%M:%S')}  ({age_min}m ago)")
con.close()
