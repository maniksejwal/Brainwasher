"""Query DB for per-arm compute stats and print comparison table."""
import sqlite3, os

db = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'dbs', 'care_circle_dev.db'))
con = sqlite3.connect('file:' + db + '?mode=ro', uri=True, timeout=5)
con.row_factory = sqlite3.Row

ARMS = [
    ('oldschool',                           'Exp 0  Oldschool'),
    ('physio_llm',                          'Exp 1  PhysioLLM'),
    ('physio_llm_cot_mcts',                 'Exp 2  CoT-MCTS'),
    ('physio_mps_mcts',                     'Exp 3  MPS-MCTS'),
    ('inertial_physio_mps_mcts',            'Exp 4  Inertial-MPS'),
    ('inertial_physio_llm_cot_mcts',        'Exp 5  Inertial-CoT'),
    ('inertial_hpvoot_physio_mps_mcts',     'Exp 6  HPVOOT-MPS'),
    ('inertial_hpvoot_physio_llm_cot_mcts', 'Exp 7  HPVOOT-CoT'),
]

turn_rows = con.execute('''
    SELECT arm,
           AVG(llm_calls_turn) as llm_pt,
           AVG(latency_ms)     as lat_pt,
           COUNT(*)            as n_turns
    FROM htn_benchmark_turns GROUP BY arm
''').fetchall()
turn_data = {r['arm']: r for r in turn_rows}

ep_rows = con.execute('''
    SELECT arm, COUNT(*) as n_eps, AVG(NULLIF(turn_count,0)) as avg_turns
    FROM htn_benchmark_episodes GROUP BY arm
''').fetchall()
ep_data = {r['arm']: r for r in ep_rows}
con.close()

# ── Token estimates per call type ────────────────────────────────────────────
# Based on actual prompt templates in arms.py / action_selector.js:
#
# Generation call (all arms):
#   System: ~180 (physio ctx) + 70 (template) + 6-turn history ~150 = ~400 in
#   Response: ~150 out  => ~550 tokens total per generation call
#
# CoT action-selection call (Exp 2, 5, 7):
#   51 actions listed (~200 tok) + physio ctx (~180) + scenario goal + message = ~480 in
#   CoT output (3-5 sentences + CHOSEN_ACTION + CONFIDENCE + REASONING) = ~180 out
#   => ~660 tokens total per CoT call
#
# HPVOOT prior scoring (Exp 6 only):
#   Cluster-level Scout prior: ~350 tokens total
#
# Oldschool (Exp 0): full JS production pipeline
#   action_selector prompt (12+ vars) + unifiedAgent response = ~700 tokens/turn

GEN   = 550   # generation Scout call
COT   = 660   # CoT action-selection Scout call
HPVP  = 350   # HPVOOT prior Scout call (Exp 6)
JS    = 700   # Oldschool JS (production prompt, measured at 12+ vars)

SCOUT_RATE = 0.17 / 1e6

def tok_for_arm(arm):
    if arm == 'oldschool':
        return JS, 1
    elif arm in ('physio_llm_cot_mcts',
                 'inertial_physio_llm_cot_mcts',
                 'inertial_hpvoot_physio_llm_cot_mcts'):
        return GEN + COT, 2   # CoT selection + generation
    elif arm == 'inertial_hpvoot_physio_mps_mcts':
        return GEN + HPVP, 2  # HPVOOT prior + generation
    else:
        return GEN, 1         # generation only

print()
print('  Token estimates: generation ~550, CoT selection ~660, HPVOOT prior ~350, JS production ~700')
print('  Scout pricing: $0.17/M tokens.  MCTS planning = 0 LLM tokens (local Python ~14 ms).')
print()

sep = '-' * 88
print('  Arm                              Eps  Trns  LLM   Tok    Tok    Cost    Latency')
print('                                        /ep  /turn /turn  /ep    $/ep    ms/turn')
print(' ' + sep)

for arm, label in ARMS:
    tr = turn_data.get(arm)
    ep = ep_data.get(arm)
    if not tr:
        print('  ' + label + '  no data')
        continue
    n_eps     = ep['n_eps']     if ep else 0
    avg_turns = ep['avg_turns'] if ep else 0
    llm_pt    = tr['llm_pt']   or 0
    lat_pt    = tr['lat_pt']   or 0

    tok_pt, exp_llm = tok_for_arm(arm)
    tok_ep  = tok_pt * avg_turns if avg_turns else 0
    cost_ep = tok_ep * SCOUT_RATE

    marker = '  '
    if exp_llm == 2 and arm != 'inertial_hpvoot_physio_mps_mcts':
        marker = '* '  # CoT arms

    print(marker + '{:<32} {:>5} {:>5.1f} {:>5.2f} {:>5} {:>6.0f} {:>8.5f} {:>8.1f}s'.format(
        label, n_eps, avg_turns, llm_pt, tok_pt, tok_ep, cost_ep, lat_pt / 1000))

print(' ' + sep)
print()
print('  * = CoT arms (2 Scout calls/turn: action selection + generation)')
print('  Measured LLM/turn from DB: htn_benchmark_turns.llm_calls_turn')
print('  Tokens are architectural estimates (token column not yet persisted to DB).')
print('  Efficiency = Goal% / Cost_per_ep for frontier comparison.')
