"""Quick sitrep — reads DB in immutable WAL snapshot mode to avoid locks."""
import sqlite3, sys

DB = r"d:\Projects\MMT\Chatbot\Brainwasher 3\data\dbs\care_circle_dev.db"

ARMS = [
    ("Exp 0  Oldschool",              "oldschool"),
    ("Exp 1  PhysioLLM",              "physio_llm"),
    ("Exp 2  CoT-MCTS",               "physio_llm_cot_mcts"),
    ("Exp 3  MPS-MCTS",               "physio_mps_mcts"),
    ("Exp 4  Inertial-MPS",           "inertial_physio_mps_mcts"),
    ("Exp 5  Inertial-CoT",           "inertial_physio_llm_cot_mcts"),
    ("Exp 6  Inertial-HPVOOT-MPS",    "inertial_hpvoot_physio_mps_mcts"),
    ("Exp 7  Inertial-HPVOOT-CoT",    "inertial_hpvoot_physio_llm_cot_mcts"),
    ("Exp 0a No-Privacy",             "oldschool_no_privacy"),
    ("Exp 1a No-Gate",                "physio_llm_no_gate"),
    ("Exp 2a No-Gate CoT",            "physio_llm_cot_mcts_no_gate"),
    ("Exp 3a No-Gate MPS",            "physio_mps_mcts_no_gate"),
    ("Exp 4a No-Gate Inert-MPS",      "inertial_physio_mps_mcts_no_gate"),
    ("Exp 5a No-Gate Inert-CoT",      "inertial_physio_llm_cot_mcts_no_gate"),
    ("Exp 6a No-Gate HPVOOT-MPS",     "inertial_hpvoot_physio_mps_mcts_no_gate"),
    ("Exp 7a No-Gate HPVOOT-CoT",     "inertial_hpvoot_physio_llm_cot_mcts_no_gate"),
    ("Exp 0p Oldschool-DPO",          "oldschool_dpo"),
    ("Exp 1p PhysioLLM-DPO",          "physio_llm_dpo"),
    ("Exp 2p CoT-MCTS-DPO",           "physio_llm_cot_mcts_dpo"),
    ("Exp 3p MPS-MCTS-DPO",           "physio_mps_mcts_dpo"),
    ("Exp 4p Inertial-MPS-DPO",       "inertial_physio_mps_mcts_dpo"),
    ("Exp 5p Inertial-CoT-DPO",       "inertial_physio_llm_cot_mcts_dpo"),
    ("Exp 6p Inert-HPVOOT-MPS-DPO",  "inertial_hpvoot_physio_mps_mcts_dpo"),
    ("Exp 7p Inert-HPVOOT-CoT-DPO",  "inertial_hpvoot_physio_llm_cot_mcts_dpo"),
]

uri = f"file:{DB}?mode=ro"
con = sqlite3.connect(uri, uri=True, timeout=10)
con.execute("PRAGMA journal_mode=WAL")  # ensure WAL is readable
con.row_factory = sqlite3.Row

def query_arm(arm_id, last_n=None):
    limit_clause = f"ORDER BY completed_at DESC LIMIT {last_n}" if last_n else ""
    sql = f"""
        SELECT
            COUNT(*) as n,
            ROUND(AVG(e.cumulative_reward),3) as avg_r,
            ROUND(100.0*SUM(CASE WHEN e.goal_achieved=1 THEN 1 ELSE 0 END)/MAX(1,COUNT(*)),1) as goal_pct,
            ROUND(AVG(e.turn_count),1) as avg_turns,
            ROUND(AVG(e.stress_auc),3) as avg_sauc,
            MAX(e.completed_at) as last_ep
        FROM (SELECT * FROM htn_benchmark_episodes WHERE arm=? {limit_clause}) e
    """
    return con.execute(sql, (arm_id,)).fetchone()

def query_cf(arm_id, last_n=None):
    """CF% from turns table — skipped if DB malformed."""
    return None

def fmt_row(label, r, cf_pct):
    n     = r['n'] or 0
    avg_r = r['avg_r'] or 0.0
    goal  = r['goal_pct'] or 0.0
    turns = r['avg_turns'] or 0.0
    sauc  = r['avg_sauc'] or 0.0
    last  = str(r['last_ep'] or '')[:16]
    cf_s  = f"{cf_pct:.1f}%" if cf_pct is not None else "  —  "
    return f"{label:<30} {n:>5}  {avg_r:>6.3f}  {goal:>6.1f}%  {cf_s:>6}  {turns:>5.1f}  {sauc:>7.3f}  {last}"

HDR = f"{'Arm':<30} {'N':>5}  {'AvgR':>6}  {'Goal%':>7}  {'CF%':>6}  {'Trn':>5}  {'StAUC':>7}  LastEp"
SEP = "-" * 95

# ── Active experiments from arm_names in DB ────────────────────────────────
active_arms = {r[0] for r in con.execute("SELECT DISTINCT arm FROM htn_benchmark_episodes").fetchall()}

print("\n=== SITREP — ALL TIME ===")
print(HDR); print(SEP)
for label, arm_id in ARMS:
    if arm_id not in active_arms:
        continue
    r   = query_arm(arm_id)
    cf  = query_cf(arm_id)
    print(fmt_row(label, r, cf))

print(f"\n=== LAST 100 EPISODES ===")
print(HDR); print(SEP)
for label, arm_id in ARMS:
    if arm_id not in active_arms:
        continue
    r   = query_arm(arm_id, last_n=100)
    cf  = query_cf(arm_id, last_n=100)
    print(fmt_row(label, r, cf))

# ── Staleness check ───────────────────────────────────────────────────────
print("\n=== LAST EPISODE WRITTEN (per arm) ===")
rows = con.execute("""
    SELECT arm, MAX(completed_at) as last_ep, COUNT(*) as n
    FROM htn_benchmark_episodes
    GROUP BY arm ORDER BY last_ep DESC
""").fetchall()
for r in rows:
    print(f"  {r['arm']:<45} n={r['n']:>5}  last={r['last_ep']}")

con.close()
