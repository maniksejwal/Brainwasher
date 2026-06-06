# Future Work and Pending Tasks

> Last updated: May 2026  
> Status legend: 🔴 Not started · 🟡 In progress / partial · 🟢 Complete

---

## 1. Short-term (before PhD submission)

### 1.1 Training validation — run_014+

| Task | Status | Notes |
|---|---|---|
| Launch run_014 with new stack (V_int, ReactivityProfile, M_trunc) | 🔴 | Services must be running on correct ports (8247 Node, 8766 FastAPI) |
| Verify genuine_metrics appear in episode summaries | 🔴 | Check `runs/run_014/arm_htn_mcts/episodes/*.jsonl` |
| Compare change_stage_delta across arms | 🔴 | Primary PhD metric |
| Compare stress_auc across arms | 🔴 | Secondary metric |
| Confirm discrepancy_flag rate < 15% for htn_mcts | 🔴 | Validates removal of keyword circularity |
| Run 3–5 independent runs, report mean ± std for each metric | 🔴 | Minimum for statistical claims |

### 1.2 Reward signal improvements

| Task | Status | Notes |
|---|---|---|
| Replace heuristic change_stage_delta with LLM judge call | 🔴 | Current implementation is a coverage-threshold heuristic. A Maverick call scoring "did this patient advance their readiness to change?" would be more valid |
| Add `trust_delta_final` to genuine_metrics comparison table | 🟢 | Implemented in worker.py |
| Add scenario-specific baselines to discrepancy_flag (some scenarios inherently produce lower scorer reward) | 🔴 | |

### 1.3 Missing framework features

| Feature | ID | Status | Notes |
|---|---|---|---|
| MCTS on language (clause MCTS) | — | 🟡 | Infrastructure exists (`mcts/clause_mcts.py`). Not wired into A3C training. Deferred — requires logit access which Bedrock API does not expose |
| E7 MPS integration tests | e7 | 🟢 | 8/8 tests pass (May 2026) |
| C7.1 — unused feature | c71 | 🟢 | User confirmed not required |
| Multi-session continuity across runs | — | 🟡 | `session_manager.py` exists; `prior_session` parameter wired in `worker.py`. Cross-run continuity (session persisting beyond a single training run) not yet tested |
| Wearable sensor integration (real-time HRV) | — | 🔴 | Phase 6. BLE → HRV → `/session/tensor/update` endpoint. Currently all physio is simulated |

---

## 2. Medium-term (Phase 5–6)

### 2.1 Learned V_int coupling strengths

The current V_int is a static prior from the literature (clinician→patient: 0.60, caregiver→patient: 0.40, etc.). Phase 5 A3C should learn session-specific coupling values from trajectories.

`SharedTensorBuffer.update_v_int(sender_role, receiver_role, coupling)` is already implemented — the A3C worker needs to emit coupling gradient updates after observing how well its V_int-informed context predictions matched actual patient responses.

V_INT_PRIOR coupling values (from `agents/shared_tensor_state.py`):
- clinician → patient: 0.6 (strong — clinician statements directly affect patient physiology)
- caregiver → patient: 0.4
- patient → clinician: 0.2 (weak — patient distress less directly affects clinician)
- patient → caregiver: 0.35
- clinician → caregiver: 0.25
- caregiver → clinician: 0.15

Citation for coupling magnitude: Safran & Muran (2000) therapeutic alliance asymmetry — rupture has stronger impact (0.30 α) than repair (0.04 α).

### 2.2 MPS bond compression stability

`project_constraint(token_logits, M_trunc)` in `core/mps.py` is designed to directly modify the LLM's token probability distribution using the M_trunc constraint matrix. This requires:

1. Access to raw token logits — not available via Bedrock Converse API today
2. Numerical stability of the SVD bond compression — currently validated by E7 tests for 4-bond truncation

When Bedrock (or a self-hosted model) exposes logits, this is the path to true F4 language-level constraint. The current M_trunc injection (appending top-k action names to the system prompt) is a soft approximation.

### 2.3 Phase 5 V_int learning

Implement Actor gradient updates for V_int coupling parameters, treating coupling strengths as additional policy parameters. This would allow the system to discover patient-specific social influence patterns from data rather than relying on population-level priors.

### 2.4 Real multi-user episodes

Current "world scenarios" run through a single CareCircleOrchestrator with simulated participants. True multi-user episodes require:

- Multiple concurrent WebSocket connections (patients and caregivers on separate devices)
- Asynchronous turn management (not all participants speak every turn)
- Privacy-gated V_int propagation (caregiver cannot see patient's raw HRV without InfoClass.III consent)

### 2.5 Track D — Distillation backends

**Implementation status (as of 2026-06-04):**

| File | Status |
|---|---|
| `distillation/als.py` | **NOT YET IMPLEMENTED** |
| `distillation/backends/hf_local.py` | **NOT YET IMPLEMENTED** |
| `distillation/backends/ec2_remote.py` | **NOT YET IMPLEMENTED** |
| `distillation/backends/ollama_local.py` | Exists — only implemented backend |

Track D (policy distillation from A3C actor → smaller local model) is deferred until after run_014 produces a trained actor worth distilling. The ollama_local backend provides a reference implementation pattern for the others.

### 2.6 Continuous physio integration

Replace the discrete per-turn physio update with a continuous OU process driven by real wearable data:

```
dHRV/dt = θ(μ_HRV − HRV) dt + σ dW_t
```

This would make the hysteretic baseline model fully consistent with the original PDS specification.

---

## 3. Long-term / research directions

### 3.1 MCTS on language

Full F4 realisation: use M_trunc to constrain the LLM's generation at the token level. Requires either:

- A self-hosted Llama model with logit access
- A Bedrock custom model endpoint (if AWS adds logit output to Converse API)
- The "prompt steering" approach: run M_trunc × token-embedding projection and inject top steering tokens into the prompt prefix (approximate, no logit access needed but less principled)

### 3.2 Phase 6 — Clinical validation

Move from synthetic patients to real patients in a controlled pilot. Key requirements:

- IRB approval
- Wearable sensor integration (Garmin/Apple Watch HRV streaming)
- Privacy layer upgraded to InfoClass.III with explicit patient consent UI
- Clinician dashboard for session review and intervention

### 3.3 Multi-lingual and cross-cultural adaptation

The current therapeutic framework is implicitly Western/English. Motivational Interviewing, for example, has different cultural valence in collectivist societies where family involvement in health decisions is expected, not optional. The V_int social coupling matrix may need culturally-stratified priors.

### 3.4 Deaddiction beyond alcohol

The current model has detailed clinical scaffolding for alcohol use disorder. The framework is designed to generalise (triggers, hysteretic baseline, reactivity profiles all apply to any substance), but:

- Training scenarios need expansion for nicotine, opioids, gambling
- The synthetic patient's backstory needs domain-specific prompts for each

---

## 4. Known methodological limitations

| Limitation | Severity | Mitigation |
|---|---|---|
| Synthetic patients are LLM-driven — their responses may pattern-match to what the companion "wants to hear" | High | Evaluated qualitatively; nudge logic deliberately introduces resistance |
| 200 episodes per run is statistically thin for multi-dimensional comparison | Medium | Plan 3–5 independent runs; report mean ± std |
| Genuine metrics (change_stage_delta) are still heuristic | Medium | LLM judge call planned for Phase 5 |
| All runs use the same 11 scenarios — risk of overfitting to scenario-specific patterns | Low | Business scenarios (negotiation) add domain diversity; expanding scenario count is a priority |
| Bedrock rate limits require exponential backoff — run duration is highly variable | Low | Mitigated by backoff implementation; consider dedicated throughput quota |
| run_013 did not exercise new V_int/ReactivityProfile stack | — | run_014 will be the first clean test |

---

## 5. Open questions for committee / collaborators

1. **Is the heuristic change_stage_delta sufficiently valid for the PhD claim?** An LLM judge scoring "readiness to change" would be more defensible but adds cost and complexity.

2. **How should the complexity normalisation be handled in the thesis?** The "reward per complexity unit" table makes the baselines look competitive. The thesis should argue that clinical outcomes (goal_achieved%, stress_auc) are the right primary metric, not reward efficiency.

3. **What is the minimum number of runs needed for the comparison to be statistically defensible?** With 130 episodes per arm and high variance (R ranging from −0.588 to 0.771), a paired t-test on 3 runs may not reach p < 0.05 on all metrics.

**Power analysis for n=130 per experiment (run_013 calibration):**

Based on the observed effect in run_013 (goal_achieved%: 80.8% vs 69.2%, Δ=11.6pp), power at n=130 per experiment ≈ 58% (below the 80% target). run_014 therefore targets n=200 per experiment.

See `06_results.md §6.3` for the full calculation. The minimum detectable effect at 80% power with n=200 is Δ ≥ 8pp (OR ≥ 1.5).

4. **Should Arm 2 (production JS companion) be treated as a teacher or as a baseline?** Currently it updates the shared Actor/Critic. If treated as a frozen external reference, the comparison would be cleaner but the policy would learn slower.
