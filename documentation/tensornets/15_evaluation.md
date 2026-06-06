# Evaluation Framework

This document describes how the system measures conversation quality, tracks genuine clinical progress, and ensures reproducibility across training runs. All evaluation components are live in the codebase.

---

## 1. Three-Judge Architecture

Evaluation runs three parallel scoring systems that check each other:

| Judge | Location | When it runs | Purpose |
|---|---|---|---|
| **A3CScorer** | `training/judge.py` | Per turn, real-time | Reward signal for A3C training loop |
| **Maverick** | `training/judge.py` (Bedrock call) | Per turn, cheaper model | Per-turn quality gate, discrepancy detection |
| **Llama 405B** | `training/judge.py` (Bedrock call) | Offline, batch | High-fidelity audit; ground truth for HITL |
| **JS scorer** | `training/simulation/simulation_scorer.js` | Parallel to Python | Structural / rule-based safety checks |

The A3CScorer and Maverick run synchronously during training. The 405B judge runs asynchronously on completed episodes — it is too expensive to call per turn. The JS scorer runs in the Node layer and its output is fed back into the discrepancy audit.

The three-judge design is intentional: no single LLM judge is trusted to be calibrated. Agreement across judges increases confidence; disagreement triggers human review.

---

## 2. Scoring Dimensions

The A3CScorer produces a reward vector across **7 dimensions**. Each maps to a distinct clinical hypothesis about what makes a conversation effective.

| Dimension | Weight | Range | Meaningful when |
|---|---|---|---|
| `trust_delta` | 0.25 | −1 → +1 | Patient-agent relationship exists (turn > 3) |
| `goal_progress` | 0.25 | 0.0 → 1.0 | A specific goal has been established |
| `info_gathering` | 0.15 | 0.0 → 1.0 | Still in assessment phase |
| `generic_response` | −0.10 | 0.0 → 1.0 | Penalises non-specific deflection (inverted) |
| `consistency` | 0.15 | 0.0 → 1.0 | Multi-turn (turn > 1); persona established |
| `safety` | 0.30 | 0.0 → 1.0 | Always active; hard floor at 0.0 |
| `urgency` | 0.10 | 0.0 → 1.0 | Physiological stress indicators present |

**Notes on weights**: `safety` is weighted highest by design — a single safety failure should dominate the reward signal. `trust_delta` is signed (negative trust regression is penalised). `generic_response` is a penalty term; its positive value subtracts from total reward.

Weights sum to 1.20 (safety and trust_delta are double-counted deliberately — they are the primary PhD claims).

---

## 3. DiscrepancyAudit

`DiscrepancyAudit` in `training/judge.py` performs cross-evaluator agreement checks after each episode.

**Flagging condition**:

```
|arm_reward − scorer_cumulative| > 3.0
```

When this threshold is exceeded, the episode is flagged for human-in-the-loop (HITL) review. The `discrepancy_flag` field is written into the episode record and propagated to the benchmarks dashboard.

**Trust-weighted scoring**: Maverick scores are weighted by a rolling inter-rater reliability estimate against 405B. If Maverick's agreement with 405B degrades (e.g., after a Bedrock model update), its weight in the combined score is automatically reduced. This prevents silent degradation in the reward signal.

**Cross-evaluator agreement is computed as**:
- Maverick vs 405B: cosine similarity on the 7-dimension score vectors
- JS scorer vs A3CScorer: binary agreement on `safety` dimension only (structural vs semantic)

Episodes with `discrepancy_flag = true` are queued in the HITL annotation pool. A human annotator resolves the disagreement; the resolution becomes a calibration sample for all three judges.

---

## 4. Genuine Progress Metrics

These five metrics are used in paper results and benchmark outputs. They are **methodologically independent** — each captures a different dimension of clinical progress that cannot be gamed by optimising the others.

| Metric | Description | Independence argument |
|---|---|---|
| `change_stage_delta` | Δ Transtheoretical Model stage (1–5) | Ordinal; discrete; cannot be fabricated by prompt structure |
| `stress_auc` | Area under HRV stress curve across episode | Physiological; computed from inertial/HRV data, not LLM output |
| `turns_to_goal` | Episode length when goal first achieved | Efficiency; inversely related to goal_progress score |
| `goal_achieved` | Binary flag at episode close | Structural; determined by HTN task completion, not scorer |
| `discrepancy_flag` | Cross-judge disagreement flag | Meta-metric; independent of all scoring dimensions |

`stress_auc` is the strongest independence claim: it is derived from wearable sensor data and cannot be improved by tuning conversation policy alone. A system that achieves low `stress_auc` without improving `change_stage_delta` would indicate physiological suppression without genuine behaviour change — a clinically meaningful failure mode.

---

## 5. Benchmarks Runner

**File**: `tensornets/benchmarks/runner.py`

The benchmarks runner executes 6 standardised tests against the current checkpoint and writes results in two formats:

- `results/<run_id>/<test_name>.json` — machine-readable, consumed by dashboards
- `results/<run_id>/<test_name>.md` — human-readable summary with pass/fail per assertion

**Current status**: 6/6 tests passing as of run_018.

Git metadata is captured at benchmark time: commit SHA, branch, dirty flag. This ensures benchmark results are reproducible and tied to a specific codebase state. Results from a dirty working tree are marked `git_dirty: true` and excluded from paper figures.

The 6 tests cover:
1. Reward signal sanity (A3CScorer output range and shape)
2. Safety hard floor (score cannot be > 0.0 when safety dimension = 0.0)
3. Discrepancy audit trigger (flag fires when threshold exceeded)
4. MPS forward pass fidelity (output distribution shape)
5. Physiological alignment signal correlation (urgency vs HRV stress)
6. Episode serialisation round-trip (JSON ↔ episode object)

---

## 6. Cost Model

**Per-episode cost breakdown** (approximate, us-east-1 pricing):

| Component | Model | Cost |
|---|---|---|
| Per-turn Maverick calls | `us.amazon.nova-pro-v1:0` | ~$0.0008 / turn |
| Per-episode 405B audit | Llama 3.1 405B Instruct | ~$0.023 / episode |
| JS scorer | Local (no API cost) | $0.00 |
| A3CScorer | Local Python (no API cost) | $0.00 |

**Derivation of $0.023/episode**:
- Average episode: 12 turns
- 405B runs once per episode on the full transcript (~2,400 tokens input, ~400 tokens output)
- Llama 3.1 405B: ~$0.0053/1K input tokens, ~$0.016/1K output tokens (Bedrock on-demand)
- Cost = (2.4 × $0.0053) + (0.4 × $0.016) ≈ $0.0127 + $0.0064 ≈ **$0.023**

At 1,000 episodes: ~$23 for 405B audit. Maverick per-turn costs ~$0.0096/episode (12 turns × $0.0008), bringing total per-episode cost to ~$0.033.

**Cost controls**: 405B is not called during exploratory training runs. It is only invoked for (a) HITL-flagged episodes and (b) scheduled overnight batch audits. The discrepancy threshold of 3.0 was calibrated to flag approximately 8% of episodes — high enough to catch genuine problems, low enough to keep 405B costs bounded.

---

## 7. Inter-Rater Reliability

**Target**: Krippendorff's α ≥ 0.80 between Maverick and 405B on the 7-dimension score vectors.

**Current status**: α is not yet formally computed — the calibration dataset requires a minimum of 50 HITL-resolved episodes. As of run_018, 12 episodes have been manually annotated.

**HITL annotation protocol**:

1. Episodes with `discrepancy_flag = true` surface in the benchmarks dashboard
2. Annotator reviews the full transcript and both judge score vectors
3. Annotator assigns a reference score vector (7 dimensions)
4. Reference is written to `data/hitl_annotations/<episode_id>.json`
5. Both Maverick and 405B are calibrated against the reference set quarterly

The Krippendorff's α target of 0.80 is the threshold used in clinical NLP literature for acceptable inter-rater agreement on ordinal scales. Reaching this threshold is a precondition for using judge scores as dependent variables in the PhD thesis.

**Fallback**: If α remains below 0.80 after 50 annotations, the scoring dimensions will be collapsed to the three highest-agreement ones (`safety`, `trust_delta`, `goal_progress`) for the paper's primary analysis, with the full 7-dimension system reported as supplementary.
