import sqlite3, os
db = r"d:\Projects\MMT\Chatbot\Brainwasher 3\data\dbs\care_circle_dev.db"
conn = sqlite3.connect(db)
c = conn.cursor()

arms = [
    ("Exp 0  Oldschool",              "oldschool"),
    ("Exp 1  PhysioLLM",              "physio_llm"),
    ("Exp 2  PhysioLLM CoT-MCTS",     "physio_llm_cot_mcts"),
    ("Exp 3  PhysioMPS-MCTS",         "physio_mps_mcts"),
    ("Exp 4  Inertial PhysioMPS",     "inertial_physio_mps_mcts"),
    ("Exp 5  Inertial PhysioLLM CoT", "inertial_physio_llm_cot_mcts"),
    ("Exp 6  Inertial HPVOOT MPS",    "inertial_hpvoot_physio_mps_mcts"),
    ("Exp 7  Inertial HPVOOT CoT",    "inertial_hpvoot_physio_llm_cot_mcts"),
]

def row_str(label, n, ar, gp, cf, turns, sa):
    cf_s = f"{cf:.1f}%" if cf is not None else "  —  "
    return f"{label:<32} {n:>5}  {ar:>6.2f}  {gp:>6.1f}%  {cf_s:>6}  {turns:>6.1f}  {sa:>7.3f}"

HDR = f"{'Arm':<32} {'N':>5}  {'AvgR':>6}  {'Goal%':>7}  {'CF%':>6}  {'Turns':>6}  {'StrAUC':>7}"
SEP = "-" * 78

# critical_failure is in htn_benchmark_turns, aggregated per episode
CF_SUB = """
    SELECT t.episode_id,
           MAX(CASE WHEN t.critical_failure=1 THEN 1 ELSE 0 END) as had_cf
    FROM htn_benchmark_turns t
    WHERE t.critical_failure IS NOT NULL
    GROUP BY t.episode_id
"""

print("ALL-TIME")
print(HDR); print(SEP)
for label, arm in arms:
    c.execute(f"""
        SELECT COUNT(*) n, AVG(e.cumulative_reward),
               100.0*SUM(CASE WHEN e.goal_achieved=1 THEN 1 ELSE 0 END)/COUNT(*),
               100.0*SUM(COALESCE(cf.had_cf,0))/NULLIF(SUM(CASE WHEN cf.episode_id IS NOT NULL THEN 1 ELSE 0 END),0),
               AVG(e.turn_count), AVG(e.stress_auc)
        FROM htn_benchmark_episodes e
        LEFT JOIN ({CF_SUB}) cf ON cf.episode_id = e.episode_id
        WHERE e.arm=?""", (arm,))
    r = c.fetchone()
    print(row_str(label, r[0], r[1] or 0, r[2] or 0, r[3], r[4] or 0, r[5] or 0))

print()
print("LAST 100")
print(HDR); print(SEP)
for label, arm in arms:
    c.execute(f"""
        SELECT AVG(e.cumulative_reward),
               100.0*SUM(CASE WHEN e.goal_achieved=1 THEN 1 ELSE 0 END)/COUNT(*),
               100.0*SUM(COALESCE(cf.had_cf,0))/NULLIF(SUM(CASE WHEN cf.episode_id IS NOT NULL THEN 1 ELSE 0 END),0),
               AVG(e.turn_count), AVG(e.stress_auc)
        FROM (SELECT episode_id,cumulative_reward,goal_achieved,turn_count,stress_auc
              FROM htn_benchmark_episodes WHERE arm=?
              ORDER BY completed_at DESC LIMIT 100) e
        LEFT JOIN ({CF_SUB}) cf ON cf.episode_id = e.episode_id""", (arm,))
    r = c.fetchone()
    print(row_str(label, 100, r[0] or 0, r[1] or 0, r[2], r[3] or 0, r[4] or 0))

conn.close()

conn = sqlite3.connect(db)
c = conn.cursor()

arms = [
    ("Exp 0  Oldschool",              "oldschool"),
    ("Exp 1  PhysioLLM",              "physio_llm"),
    ("Exp 2  PhysioLLM CoT-MCTS",     "physio_llm_cot_mcts"),
    ("Exp 3  PhysioMPS-MCTS",         "physio_mps_mcts"),
    ("Exp 4  Inertial PhysioMPS",     "inertial_physio_mps_mcts"),
    ("Exp 5  Inertial PhysioLLM CoT", "inertial_physio_llm_cot_mcts"),
    ("Exp 6  Inertial HPVOOT MPS",    "inertial_hpvoot_physio_mps_mcts"),
    ("Exp 7  Inertial HPVOOT CoT",    "inertial_hpvoot_physio_llm_cot_mcts"),
]

def row_str(label, n, ar, gp, cf, turns, sa):
    cf_s = f"{cf:.1f}%" if cf is not None else "  —  "
    return f"{label:<32} {n:>5}  {ar:>6.2f}  {gp:>6.1f}%  {cf_s:>6}  {turns:>6.1f}  {sa:>7.3f}"

HDR = f"{'Arm':<32} {'N':>5}  {'AvgR':>6}  {'Goal%':>7}  {'CF%':>6}  {'Turns':>6}  {'StrAUC':>7}"
SEP = "-" * 78

print("ALL-TIME")
print(HDR); print(SEP)
for label, arm in arms:
    c.execute("""SELECT COUNT(*) n, AVG(cumulative_reward),
        100.0*SUM(CASE WHEN goal_achieved=1 THEN 1 ELSE 0 END)/COUNT(*),
        100.0*SUM(CASE WHEN critical_failure=1 THEN 1 ELSE 0 END)
             /NULLIF(SUM(CASE WHEN critical_failure IS NOT NULL THEN 1 ELSE 0 END),0),
        AVG(turn_count), AVG(stress_auc)
        FROM htn_benchmark_episodes WHERE arm=?""", (arm,))
    r = c.fetchone()
    print(row_str(label, r[0], r[1] or 0, r[2] or 0, r[3], r[4] or 0, r[5] or 0))

print()
print("LAST 100")
print(HDR); print(SEP)
for label, arm in arms:
    c.execute("""SELECT AVG(cumulative_reward),
        100.0*SUM(CASE WHEN goal_achieved=1 THEN 1 ELSE 0 END)/COUNT(*),
        100.0*SUM(CASE WHEN critical_failure=1 THEN 1 ELSE 0 END)
             /NULLIF(SUM(CASE WHEN critical_failure IS NOT NULL THEN 1 ELSE 0 END),0),
        AVG(turn_count), AVG(stress_auc)
        FROM (SELECT cumulative_reward,goal_achieved,critical_failure,turn_count,stress_auc
              FROM htn_benchmark_episodes WHERE arm=?
              ORDER BY created_at DESC LIMIT 100)""", (arm,))
    r = c.fetchone()
    print(row_str(label, 100, r[0] or 0, r[1] or 0, r[2], r[3] or 0, r[4] or 0))

conn.close()
