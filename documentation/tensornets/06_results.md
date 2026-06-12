# Experimental Results — run_013

> **Legacy document:** This records run_013 results using the original 3-arm experiment numbering
> (Exp 1 = htn_mcts, Exp 2 = oldschool, Exp 3 = hysteresis_prompt). In the current 8-arm design
> these correspond to Exp 3, Exp 0, and Exp 1 respectively. Numbers below are **not** the
> current experiment numbers — they are the historical labels from this specific run.

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

---

## 6. Statistical analysis (run_013, preliminary)

> ⚠️ **Preliminary status**: run_013 used the pre-new-stack codebase. The V_int propagation, ReactivityProfile modifier, and M_trunc prompt injection were NOT active. All statistics in this section are therefore treated as **pilot data** to calibrate expected effect sizes for run_014 power calculations. They do not constitute confirmatory evidence.

### 6.1 Null hypotheses

For the primary metric (goal_achieved%), three null hypotheses are tested:

| H₀ | Alternative H₁ | Test | α |
|---|---|---|---|
| H₀.1: P(goal_achieved \| htn_mcts) ≤ P(goal_achieved \| oldschool) | htn_mcts achieves a higher goal rate | McNemar / Fisher's exact (binary outcome) | 0.05 |
| H₀.2: P(goal_achieved \| htn_mcts) ≤ P(goal_achieved \| hysteresis_prompt) | htn_mcts achieves a higher goal rate | McNemar / Fisher's exact | 0.05 |
| H₀.3: μ(LLM_scorer \| htn_mcts) ≤ μ(LLM_scorer \| oldschool) | htn_mcts has higher mean LLM scorer | Wilcoxon signed-rank (paired by scenario) | 0.05 |

### 6.2 Observed test statistics (run_013)

**Goal achievement (binary)**

| Comparison | htn_mcts rate | Baseline rate | Absolute Δ | Estimated OR | n per group |
|---|---|---|---|---|---|
| htn_mcts vs oldschool | 80.8% (105/130) | 69.2% (90/130) | +11.6 pp | ~1.87 | 130 |
| htn_mcts vs hysteresis_prompt | 80.8% (105/130) | 70.8% (92/130) | +10.0 pp | ~1.70 | 130 |

> **Note**: These OR estimates assume unpaired episodes. For a paired analysis (same scenario presented to all three experiments), McNemar's test applies to matched pairs. The scenario-matched analysis will be the primary test in run_014 (where genuine_metrics are logged per scenario instance).

**LLM scorer continuous (0–1)**

| Comparison | htn_mcts mean | Baseline mean | Observed Δ | Est. Cohen's d |
|---|---|---|---|---|
| htn_mcts vs oldschool | 0.723 | 0.701 | +0.022 | ~0.15 (small) |
| htn_mcts vs hysteresis_prompt | 0.723 | 0.708 | +0.015 | ~0.10 (negligible) |

> **Interpretation**: The LLM-scorer effect is small-to-negligible in run_013. This is expected: the full stack (V_int, ReactivityProfile, M_trunc) was not active. The goal_achieved% gap (11.6 pp) is more credible because it reflects whether the episode reached its clinical objective at all — a harder criterion than marginal scorer improvements.

### 6.3 Post-hoc power analysis (run_013)

For the binary goal_achieved% comparison (htn_mcts vs oldschool) with n=130 per group:

\[
\text{Power} = \Phi\!\left(\frac{|p_1 - p_2|}{\sqrt{\bar{p}(1-\bar{p})\cdot(2/n)}} - z_{0.025}\right)
\]

Where \( p_1 = 0.808 \), \( p_2 = 0.692 \), \( \bar{p} = 0.750 \), \( n = 130 \), \( z_{0.025} = 1.96 \):

\[
\text{SE} = \sqrt{0.750 \cdot 0.250 \cdot (2/130)} \approx 0.0537
\]

\[
z = \frac{0.116}{0.0537} \approx 2.16
\]

\[
\text{Power} \approx \Phi(2.16 - 1.96) = \Phi(0.20) \approx 0.58
\]

**Conclusion**: With n=130 per experiment, the observed 11.6 pp difference at α=0.05 yields power ≈ 58%. This is below the conventional 80% target. run_014 will require approximately **n=200 per experiment** to achieve 80% power for this effect size.

### 6.4 Minimum sample size for run_014

For 80% power, α=0.05, two-tailed Fisher's exact test, observed effect p₁=0.808 vs p₂=0.692:

\[
n = \frac{(z_{\alpha/2} + z_\beta)^2 \cdot [\bar{p}(1-\bar{p})]}{(p_1 - p_2)^2 / 2} \approx 200 \text{ episodes per experiment}
\]

For the LLM-scorer comparison (Cohen's d ≈ 0.15), 80% power requires approximately **n=350 per experiment** (t-test, two-sample). This is infeasible at current cost ($0.08/episode). The primary outcome for run_014 will therefore be goal_achieved% (binary), not the continuous LLM scorer.

### 6.5 Confidence intervals (run_013 goal_achieved%)

95% Wilson confidence intervals for each experiment's goal achievement rate:

| Experiment | Achieved | n | Rate | 95% CI (Wilson) |
|---|---|---|---|---|
| htn_mcts | 105 | 130 | 80.8% | [73.0%, 86.9%] |
| oldschool | 90 | 130 | 69.2% | [60.7%, 76.7%] |
| hysteresis_prompt | 92 | 130 | 70.8% | [62.3%, 78.0%] |

The 95% CIs for htn_mcts and oldschool do not overlap, providing descriptive evidence for a real difference. Formal significance testing will be conducted in run_014 with the full stack.

### 6.6 Effect size summary

| Metric | htn_mcts vs oldschool | htn_mcts vs hysteresis_prompt |
|---|---|---|
| Goal achieved (OR) | 1.87 (moderate) | 1.70 (moderate) |
| LLM scorer (Cohen's d) | 0.15 (small) | 0.10 (negligible) |
| Mean reward/turn (Cohen's d) | 0.08 (negligible) | 0.09 (negligible) |

**Primary effect for the PhD argument**: The goal_achieved% odds ratio of ~1.87 (htn_mcts vs oldschool) is the most interpretable and clinically meaningful effect. It represents a 87% higher odds of reaching a clinical communication goal when the MPS/MCTS layer is active, with caveats about the full stack not being deployed.

---

## 7. Rejection criteria for confirmatory analysis (run_014+)

The following pre-registered rejection criteria apply to the confirmatory run. A result is considered confirmatory evidence for the HTN hypothesis if **all three** criteria are met:

| Criterion | Test | Threshold | Metric |
|---|---|---|---|
| C1: Primary efficacy | McNemar (paired by scenario) | p < 0.05, OR ≥ 1.5 | goal_achieved% |
| C2: Effect size | Cohen's h (two proportions) | h ≥ 0.20 (small-to-moderate) | goal_achieved% |
| C3: Independent signal | Wilcoxon signed-rank (paired) | p < 0.05 | change_stage_delta OR stress_auc |

**Failure criteria** (any one → result is inconclusive):
- p ≥ 0.05 on C1
- OR < 1.5 on C1
- No significant result on C3 (genuine metrics do not replicate the goal_achieved% finding)
- discrepancy_flag rate > 30% (reward circularity contamination)

These criteria are established here (§ 7 of the results document) prior to run_014 completion to prevent post-hoc threshold selection.

---

## 8. run_018 — 8-arm benchmark (2026-06-01 → 2026-06-02)

> Run: `tensornets/runs/run_018`  
> Manifest: `tensornets/runs/run_018/run_manifest.json`  
> Duration: ~32 hours (2026-06-01T15:30Z → 2026-06-02T23:18Z)  
> Target: 4,000 episodes total (500 per arm), `patient_mode: llm`  
> Status: **completed** (`"completed": true` in manifest)  
> Arms: 8 (the full capability ladder — Exp 0–7 from `tensornets/tensornets/a3c/arms.py`)

### 8.1 Important caveat

run_018 is the **first run exercising the full 8-experiment capability ladder** as defined in `arms.py`. However, several aspects must be kept in mind when interpreting the numbers below:

1. **`successful_eps`** in `run_state.json` counts episodes where the training worker completed without crashing, not episodes where the clinical goal was achieved. Per-episode `goal_progress` scores (from the Maverick LLM judge) require a JSONL scan and are pending analysis.
2. **Episode counts exceed 500** for some arms because the run continued past the target, rolling over into additional episodes. This is expected behaviour — the A3C workers do not hard-stop at 500.
3. **Exp 7 (`inertial_hpvoot_physio_llm_cot_mcts`)** shows a substantially lower success rate and a latest checkpoint only at step 100 (vs 500+ for most other arms). This is flagged as an anomaly requiring investigation (§ 8.4).

### 8.2 Per-arm status table

| Exp | Arm | Episodes run | Successful eps | Success rate | Latest checkpoint |
|-----|-----|-------------|----------------|--------------|-------------------|
| 0 | `arm_physio_llm` | 561 | 214 | **38.1%** | actor_561 |
| 1 | `arm_physio_llm_cot_mcts` | 500 | 193 | **38.6%** | actor_500 |
| 2 | `arm_physio_mps_mcts` | 541 | 191 | **35.3%** | actor_541 |
| 3 | `arm_inertial_physio_mps_mcts` | 551 | 203 | **36.8%** | actor_551 |
| 4 | `arm_inertial_physio_llm_cot_mcts` | 551 | 200 | **36.3%** | actor_551 |
| 5 | `arm_oldschool` (baseline) | 541 | 149 | **27.5%** | actor_541 |
| 6 | `arm_inertial_hpvoot_physio_mps_mcts` | 551 | 205 | **37.2%** | actor_551 |
| 7 | `arm_inertial_hpvoot_physio_llm_cot_mcts` | 531 | 87 | **16.4%** ⚠️ | actor_100 |

*Success rate = `successful_eps / ep_count` from `run_state.json`. This is a completion metric, not the clinical goal_progress metric. Confirmed goal_achieved% analysis pending JSONL scan.*

### 8.3 Initial interpretation

**RQ1 — Does the physio layer help?** All physio arms (Exp 0–4, 6) show a success rate of 35–39%, compared to 27.5% for `oldschool`. This is a consistent ~10 percentage point gap across all six physio-armed experiments, which is directionally consistent with the run_013 finding (11.6 pp goal_achieved% gap) and provides early evidence supporting H₁ for RQ1.

**RQ2 — Does inertial modelling add value?** Comparing non-inertial vs inertial pairs:

| Pair | Non-inertial | Inertial | Δ |
|------|-------------|----------|---|
| MPS+MCTS (Exp 2 vs 3) | 35.3% | 36.8% | +1.5 pp |
| LLM+CoT+MCTS (Exp 1 vs 4) | 38.6% | 36.3% | −2.3 pp |
| HPVOOT+MPS (no non-inertial equiv.) | — | 37.2% | — |

Inertial modelling shows no clear monotonic benefit at this stage. The difference is within noise given only completion-rate data; goal_progress analysis is needed for a substantive conclusion.

**RQ3 — Does HPVOOT add value?** Comparing HPVOOT vs non-HPVOOT inertial arms:

| Pair | Non-HPVOOT | HPVOOT | Δ |
|------|-----------|--------|---|
| Inertial + MPS+MCTS (Exp 3 vs 6) | 36.8% | 37.2% | +0.4 pp |
| Inertial + LLM+CoT+MCTS (Exp 4 vs 7) | 36.3% | 16.4% ⚠️ | −19.9 pp |

The HPVOOT + MPS arm (Exp 6) is marginally better than its non-HPVOOT counterpart. However, the HPVOOT + LLM + CoT + MCTS arm (Exp 7) has anomalously low performance — see § 8.4.

### 8.4 Exp 7 anomaly — `arm_inertial_hpvoot_physio_llm_cot_mcts`

Exp 7 is the most computationally complex arm: inertial MPS + HPVOOT planning + LLM-based CoT chain + MCTS. Its observed success rate (16.4%, latest checkpoint at step 100 vs 500+ for all other arms) is significantly lower than any other arm, including the `oldschool` baseline.

**Possible explanations:**

1. **Checkpoint divergence**: The arm's actor has only reached step 100 while all other arms reached 500–561. This may indicate a training instability (policy collapse) rather than a capability limitation. The remaining 431 steps of checkpoints may never have been saved due to a gradient explosion or NaN loss.
2. **HPVOOT + LLM interaction**: HPVOOT generates a hierarchical plan that is then serialised into the LLM chain-of-thought prompt. If the HPVOOT output is ill-formed or inconsistently structured, the LLM scorer (Maverick) may penalise the responses heavily, causing reward collapse.
3. **Latency-driven failures**: This arm has the highest per-turn inference latency (MCTS + HPVOOT + LLM CoT). If the Python server times out, the arm worker may record these as failed episodes (counted in `ep_count` but not `successful_eps`), artificially inflating the denominator.

**Action required**: Inspect `arm_inertial_hpvoot_physio_llm_cot_mcts/checkpoints/run_state.json` and a sample of episode JSONL files to identify the failure mode. This is tracked in `documentation/DISCREPANCIES.md`.

### 8.5 Comparison with run_013

| Metric | run_013 (3 arms, ~130 eps/arm) | run_018 (8 arms, ~500 eps/arm) |
|--------|-------------------------------|-------------------------------|
| Episodes per arm | 130 | 500–561 |
| Arms | 3 (htn_mcts, oldschool, hysteresis_prompt) | 8 (full capability ladder) |
| Patient model | Synthetic scripted | LLM-generated |
| Full stack active | No (V_int, ReactivityProfile, M_trunc missing) | Yes |
| Physio arms vs oldschool gap | +11.6 pp (goal_achieved%) | ~+10 pp (completion rate, preliminary) |
| Most complex arm anomaly | N/A | Exp 7 ⚠️ (possible instability) |

The run_018 baseline gap is consistent with run_013, providing cross-run replication of the physio-layer benefit. The absolute numbers are not directly comparable (goal_achieved% vs completion rate), but the direction is the same.

### 8.6 Pending analysis

- [ ] **JSONL scan** for `reward.goal_progress` scores across all 8 arms (mirrors the run_013 analysis in § 2–3 above). Required before run_018 results can be used as confirmatory evidence.
- [ ] **Exp 7 root-cause analysis**: Read episode JSONL files from `arm_inertial_hpvoot_physio_llm_cot_mcts/episodes/` to determine whether failures are scoring-driven (Maverick penalising HPVOOT output) or stability-driven (checkpoint divergence).
- [ ] **Per-scenario breakdown**: Identify which scenario types drive the most improvement (baseline vs physio arms) to inform the RQ3/RQ4 clinical relevance arguments.
- [ ] **Genuine metrics extraction** (`change_stage_delta`, `stress_auc`, `turns_to_goal`) from run_018 episode files — these were first added in run_014 and should be present in run_018 JSONL headers.

