import sqlite3, datetime
db = r"d:\Projects\MMT\Chatbot\Brainwasher 3\data\dbs\care_circle_dev.db"
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=10)
con.row_factory = sqlite3.Row

today_start = int(datetime.datetime(2026, 6, 15, 0, 0, 0).timestamp() * 1000)

rows = con.execute("""
    SELECT arm,
           COUNT(*) as today_n,
           MAX(completed_at) as last_ep
    FROM htn_benchmark_episodes
    WHERE completed_at >= ?
    GROUP BY arm
    ORDER BY today_n DESC
""", (today_start,)).fetchall()

total = sum(r["today_n"] for r in rows)
print(f"Episodes completed today (Jun 15): {total}\n")
print(f"{'Arm':<50} {'Today':>6}  Last")
print("-" * 72)
for r in rows:
    ts = r["last_ep"]
    dt = datetime.datetime.fromtimestamp(ts / 1000).strftime("%H:%M:%S")
    print(f"{r['arm']:<50} {r['today_n']:>6}  {dt}")

con.close()
