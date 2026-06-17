import sqlite3, datetime
DB = r"d:\Projects\MMT\Chatbot\Brainwasher 3\data\dbs\care_circle_dev.db"
con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=10)
con.row_factory = sqlite3.Row
today = int(datetime.datetime(2026, 6, 16, 0, 0, 0).timestamp() * 1000)
arms = [
    ("Exp 0  Oldschool",           "oldschool"),
    ("Exp 1  PhysioLLM",           "physio_llm"),
    ("Exp 2  CoT-MCTS",            "physio_llm_cot_mcts"),
    ("Exp 3  MPS-MCTS",            "physio_mps_mcts"),
    ("Exp 4  Inertial-MPS",        "inertial_physio_mps_mcts"),
    ("Exp 5  Inertial-CoT",        "inertial_physio_llm_cot_mcts"),
    ("Exp 6  Inertial-HPVOOT-MPS", "inertial_hpvoot_physio_mps_mcts"),
    ("Exp 7  Inertial-HPVOOT-CoT", "inertial_hpvoot_physio_llm_cot_mcts"),
]
print(f"{'Arm':<30} {'Total':>6}  {'Today':>5}")
print("-" * 45)
tot_total = 0
tot_today = 0
for label, arm_id in arms:
    total   = con.execute("SELECT COUNT(*) n FROM htn_benchmark_episodes WHERE arm=?", (arm_id,)).fetchone()["n"]
    today_n = con.execute("SELECT COUNT(*) n FROM htn_benchmark_episodes WHERE arm=? AND completed_at>=?", (arm_id, today)).fetchone()["n"]
    tot_total += total
    tot_today += today_n
    print(f"{label:<30} {total:>6}  {today_n:>5}")
print("-" * 45)
print(f"{'TOTAL':<30} {tot_total:>6}  {tot_today:>5}")
con.close()
