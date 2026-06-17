import sqlite3, datetime

DB = r"d:\Projects\MMT\Chatbot\Brainwasher 3\data\dbs\care_circle_dev.db"
con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)
con.row_factory = sqlite3.Row

BASE = [
    ("Exp 0  Oldschool",           "oldschool"),
    ("Exp 1  PhysioLLM",           "physio_llm"),
    ("Exp 2  CoT-MCTS",            "physio_llm_cot_mcts"),
    ("Exp 3  MPS-MCTS",            "physio_mps_mcts"),
    ("Exp 4  Inertial-MPS",        "inertial_physio_mps_mcts"),
    ("Exp 5  Inertial-CoT",        "inertial_physio_llm_cot_mcts"),
    ("Exp 6  Inertial-HPVOOT-MPS", "inertial_hpvoot_physio_mps_mcts"),
    ("Exp 7  Inertial-HPVOOT-CoT", "inertial_hpvoot_physio_llm_cot_mcts"),
]
DPO = [
    ("Exp 0p Oldschool-DPO",          "oldschool_dpo"),
    ("Exp 1p PhysioLLM-DPO",          "physio_llm_dpo"),
    ("Exp 2p CoT-MCTS-DPO",           "physio_llm_cot_mcts_dpo"),
    ("Exp 3p MPS-MCTS-DPO",           "physio_mps_mcts_dpo"),
    ("Exp 4p Inertial-MPS-DPO",       "inertial_physio_mps_mcts_dpo"),
    ("Exp 5p Inertial-CoT-DPO",       "inertial_physio_llm_cot_mcts_dpo"),
    ("Exp 6p Inert-HPVOOT-MPS-DPO",  "inertial_hpvoot_physio_mps_mcts_dpo"),
    ("Exp 7p Inert-HPVOOT-CoT-DPO",  "inertial_hpvoot_physio_llm_cot_mcts_dpo"),
]

today_start = int(datetime.datetime(2026, 6, 16, 0, 0, 0).timestamp() * 1000)

# Episodes today
today_rows = con.execute(
    "SELECT arm, COUNT(*) n FROM htn_benchmark_episodes WHERE completed_at>=? GROUP BY arm",
    (today_start,)
).fetchall()
today_map = {r["arm"]: r["n"] for r in today_rows}
today_total = sum(today_map.values())

print(f"=== EPISODES TODAY (Jun 16): {today_total} total ===\n")

def stats_last_n(arm_id, n=100):
    r = con.execute(f"""
        SELECT COUNT(*) as cnt,
               ROUND(AVG(cumulative_reward),3) as avg_r,
               ROUND(100.0*SUM(CASE WHEN goal_achieved=1 THEN 1 ELSE 0 END)/COUNT(*),1) as goal_pct,
               ROUND(AVG(turn_count),1) as avg_turns,
               ROUND(AVG(stress_auc),3) as sauc,
               MAX(completed_at) as last_ep
        FROM (SELECT * FROM htn_benchmark_episodes WHERE arm=?
              ORDER BY completed_at DESC LIMIT {n})
    """, (arm_id,)).fetchone()
    return r

def total_n(arm_id):
    r = con.execute("SELECT COUNT(*) n FROM htn_benchmark_episodes WHERE arm=?", (arm_id,)).fetchone()
    return r["n"]

HDR  = f"{'Arm':<30} {'TotN':>5}  {'TodN':>4}  {'AvgR':>6}  {'Goal%':>6}  {'Turns':>5}  {'StAUC':>6}"
SEP  = "-" * 72

for group_name, arms in [("BASE ARMS", BASE), ("DPO ARMS", DPO)]:
    print(f"=== LAST 100 EPISODES — {group_name} ===")
    print(HDR); print(SEP)
    results = []
    for label, arm_id in arms:
        r = stats_last_n(arm_id, 100)
        tot = total_n(arm_id)
        tod = today_map.get(arm_id, 0)
        results.append((label, arm_id, tot, tod, r))

    # Sort by goal% descending for ranking
    results.sort(key=lambda x: x[4]["goal_pct"] or 0, reverse=True)
    for i, (label, arm_id, tot, tod, r) in enumerate(results):
        rank = f"#{i+1}"
        print(f"{label:<30} {tot:>5}  {tod:>4}  {r['avg_r']:>6.3f}  {r['goal_pct']:>5.1f}%  {r['avg_turns']:>5.1f}  {r['sauc']:>6.3f}  {rank}")
    print()

# Today breakdown
print("=== TODAY BY ARM (base + DPO only) ===")
all_arms = BASE + DPO
for label, arm_id in all_arms:
    n = today_map.get(arm_id, 0)
    if n:
        print(f"  {label:<30} +{n}")

con.close()
