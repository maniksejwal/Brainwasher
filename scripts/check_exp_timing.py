import sqlite3
import datetime

DB = r"d:\Projects\MMT\Chatbot\Brainwasher 3\data\dbs\care_circle_dev.db"
con = sqlite3.connect(DB)
cur = con.cursor()

# Get first episode timestamp and total count for Exp 0, 0a, 0p
result = cur.execute("""
    SELECT arm, 
           MIN(completed_at) as first_ep, 
           MAX(completed_at) as last_ep,
           COUNT(*) as total 
    FROM htn_benchmark_episodes 
    WHERE arm IN ('oldschool', 'oldschool_no_privacy', 'oldschool_dpo') 
    GROUP BY arm 
    ORDER BY MIN(completed_at)
""").fetchall()

print("=" * 80)
print("EXPERIMENT START TIMES AND EPISODE COUNTS")
print("=" * 80)
print(f"{'Arm':<25} | {'First Episode':<16} | {'Last Episode':<16} | {'Total':>6}")
print("-" * 80)

exp0_last = None
for arm, first_ts, last_ts, total in result:
    first_dt = datetime.datetime.fromtimestamp(first_ts/1000)
    last_dt = datetime.datetime.fromtimestamp(last_ts/1000)
    
    exp_name = {
        'oldschool': 'Exp 0 (Baseline)',
        'oldschool_no_privacy': 'Exp 0a (No Privacy)',
        'oldschool_dpo': 'Exp 0p (DPO)'
    }.get(arm, arm)
    
    print(f"{exp_name:<25} | {first_dt.strftime('%Y-%m-%d %H:%M'):<16} | {last_dt.strftime('%Y-%m-%d %H:%M'):<16} | {total:>6}")
    
    if arm == 'oldschool':
        exp0_last = last_dt

# Calculate when 0a and 0p started relative to Exp 0
print("\n" + "=" * 80)
print("TIMING ANALYSIS")
print("=" * 80)

for arm, first_ts, last_ts, total in result:
    if arm != 'oldschool':
        first_dt = datetime.datetime.fromtimestamp(first_ts/1000)
        
        exp_name = {
            'oldschool_no_privacy': 'Exp 0a',
            'oldschool_dpo': 'Exp 0p'
        }.get(arm, arm)
        
        # Get how many Exp 0 episodes existed at this timestamp
        exp0_count_at_start = cur.execute("""
            SELECT COUNT(*) 
            FROM htn_benchmark_episodes 
            WHERE arm = 'oldschool' AND completed_at < ?
        """, (first_ts,)).fetchone()[0]
        
        print(f"\n{exp_name} started on {first_dt.strftime('%Y-%m-%d')}")
        print(f"  - After {exp0_count_at_start} Exp 0 episodes had completed")
        print(f"  - {(first_dt - datetime.datetime.fromtimestamp(result[0][1]/1000)).days} days after Exp 0 started")

con.close()
