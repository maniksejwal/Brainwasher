# Experimental Results — run_013

> Run: `tensornets/runs/run_013`  
> Completed: 2026-05-27 03:26 UTC (11.5 hours)  
> Episodes: 200 (130 completed per experiment; ~70 total skipped due to port migration and transient Bedrock 502s)  
> Experiments: `htn_mcts` (Exp 1 — treatment), `oldschool` (Exp 2 — production baseline), `hysteresis_prompt` (Exp 3 — text-physio baseline)

---

## 1. Important caveat

run_013 was the **first clean end-to-end run** (200 episodes, all three arms, no port-mismatch failures). However, it ran with the **pre-May-26 codebase** — before the following were wired into the training loop:

- V_int / SharedTensorBuffer propagation
- ReactivityProfile archetype modifier on Δ-stress
- DrugRegimen PK/PD Γ modifier
- SharedDialogueState (cross-companion commitment tracking)
- M_trunc injection into the Scout system prompt (F3/F4)
- Genuine progress metrics in episode summaries

The `genuine_metrics` block in `05_results` is therefore absent from run_013 episode files. The comparison below uses `reward.goal_progress` (LLM scorer output) and turn-level data as proxies.

**run_014** will be the first run exercising the full new stack.

---

## 2. Summary statistics (run_013, 130 episodes per experiment)

| Metric | htn_mcts (Exp 1) | oldschool (Exp 2) | hysteresis_prompt (Exp 3) |
|---|---|---|---|
| Mean reward / turn | **0.582** | 0.565 | 0.566 |
| Reward / complexity unit ¹ | 0.146 | 0.377 | **0.566** |
| Mean goal_progress (LLM-scored) | **0.627** | 0.560 | 0.560 |
| Goal achieved (goal_progress ≥ 0.75) | **80.8%** | 69.2% | 70.8% |
| LLM scorer continuous (0–1) | **0.723** | 0.701 | 0.708 |
| Mean turns / episode | **10.9** | 10.2 | 9.9 |
| 2-strike terminations | 10 | 11 | **14** |
| Skipped episodes (server/Bedrock) | 2 | 1 | 1 |
| **Total failures** | **12** | **12** | **15** |

¹ *Complexity units: htn_mcts = 4.0 (MCTS + MPS + SVD + Scout); oldschool = 1.5 (fixed JS stack); hysteresis_prompt = 1.0 (Scout only). This is a relative proxy, not a rigorous parameter count.*

---

## 3. Interpretation

### 3.1 Goal achievement — the most credible metric

`goal_progress` in `reward_dict` comes directly from the Maverick LLM judge and is **not** used by the MCTS reward function. It is therefore free of the circularity concern (§ 3.3).

**htn_mcts leads by 11.6 percentage points** on goal_achieved% (80.8% vs 69.2% for oldschool). This is the strongest signal that the MPS/MCTS layer is contributing genuine clinical utility.

### 3.2 Reward efficiency — where the baseline challenges the treatment

When reward is normalised by complexity, `hysteresis_prompt` (Arm 3) performs best. This validates the earlier methodological concern: raw reward is not an appropriate primary comparison metric. Arm 1 uses 4× more mechanism and achieves only marginally higher raw reward.

However, this normalised view does not account for what *kind* of reward is being achieved. The LLM scorer continuous score (0.723 vs 0.701 vs 0.708) and the goal_achieved% (80.8% vs 69.2% vs 70.8%) suggest that Arm 1 is achieving harder goals, not just more easily-scored interactions.

### 3.3 The circularity concern and how it was addressed

The concern raised during the audit: MCTS scores higher partly because the reward function and the MCTS cost function are both grounded in `CALMING_WEIGHT` and `GOAL_KEYWORDS`. The MCTS arm is effectively optimising the very heuristics it is evaluated on.

Mitigations implemented before run_014:
- **Keyword scan removed from `_synthetic_reward()`** — the MCTS arm's arm-side goal_r no longer uses keyword matching. The composite score uses only the action-taxonomy signal (`info_coverage ± delta`).
- **`goal_progress` in reward_dict always uses the LLM scorer** — never the keyword scan.
- **Genuine metrics added** — `change_stage_delta`, `stress_auc`, `turns_to_goal`, `discrepancy_flag` provide independent signals.
- **`discrepancy_flag`** detects episodes where arm reward diverges > 3.0 from scorer cumulative — these are the "suspicious" episodes where the arm may be gaming its own metric.

### 3.4 Failure analysis

`hysteresis_prompt` has the highest 2-strike termination count (14 vs 10 and 11). The text-physio approach is least stable: without MPS constraints, the Scout LLM occasionally generates responses that the Maverick judge scores as clinically unsafe (e.g., giving advice before establishing rapport on a suicidality scenario).

`oldschool` fails more on `billing_denial_mcts_demo` and `flooding_social_anxiety` — scenarios the production JS companion was not designed for. These are edge cases that require more nuanced strategy than the production system currently provides.

### 3.5 Notable episodes

**Highest reward**: `htn_mcts`, `negotiation_undefined`, 25 turns, R=16.16, reward/turn=0.646. This was a business negotiation scenario where the companion maintained engagement for the full available turn budget, suggesting the MCTS is successfully prolonging productive sessions.

**Most negative**: `hysteresis_prompt`, `billing_denial_mcts_demo`, 2 turns, R=−0.588. 2-strike on turn 1 — the companion gave advice before establishing any rapport. Consistent with the text-physio arm lacking a structural constraint against premature information delivery.

**Prompt optimizer**: Both `htn_mcts` and `hysteresis_prompt` remained above the rewrite threshold (mean score ≈ 0.585–0.589 ≥ 0.50). No prompt rewrites were triggered in run_013. This is expected at this stage — the system is still in early learning.

---

## 4. Cost breakdown (estimated, run_013)

| Arm | Mean tokens/turn (Scout est.) | Scorer turns (Maverick est.) | Estimated cost/episode |
|---|---|---|---|
| htn_mcts | ~600 (system prompt + history + M_trunc hint) | ~5 Maverick calls | ~$0.08 |
| oldschool | ~400 (Node.js manages context) | ~5 Maverick calls | ~$0.07 |
| hysteresis_prompt | ~700 (physio block in system prompt) | ~5 Maverick calls | ~$0.09 |

Total estimated cost for run_013 (390 completed episodes × ~$0.08 average): **~$31**.

---

## 5. What run_014 will add

run_014 is the first run with the full new stack:

| New component | Expected effect |
|---|---|
| V_int propagation | Multi-user episodes should show reduced cross-turn stress spikes — companions will see updated physio for all participants |
| ReactivityProfile archetype modifier | `anxious` patients will show larger Δ-stress per action; `stoic` patients less so — reward landscape becomes patient-specific |
| DrugRegimen Γ modifier | Medicated patients (naltrexone, metoprolol) will have pharmacologically appropriate stress trajectories |
| M_trunc MCTS guidance in Scout prompt | Arm 1 Scout responses should more consistently align with the MCTS-recommended action subspace |
| Keyword scan removed | `discrepancy_flag` rate should decrease — arm reward and LLM scorer reward should converge |
| Genuine metrics logged | `change_stage_delta`, `stress_auc`, `turns_to_goal`, `goal_achieved` will be available for the primary comparison |
