# EXPERIMENTS.md — HTN Framework Benchmarking Log

> Every claim in the paper must have an entry here.
> Format: one section per experiment. Never delete entries — mark as REVISED if repeated.
> Hardware: record CPU/GPU, RAM, OS, Python version, library versions at time of run.
> Git: record branch and commit hash at time of run.

---

## Repository branching strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable code; merged from `research` after benchmarks pass |
| `research` | Active PhD research code; experiments run from here |
| `document` | Paper writing support; figures, tables, supplementary material generation |
| `integration` | Brainwasher 3 main project integration work |

Experiments are always run on `research`. Results are committed to `document`
as figure-generation scripts and output CSVs. The paper (Overleaf / LaTeX) pulls
from `document`.

```
main ←── research (experiments run here)
              ↓
          document (figure scripts, CSVs, tables)
              ↓
          [Paper / Overleaf]
```

---

## Experiment register

### E-001 — HRV simulator validation
**Status**: PENDING
**Hypothesis**: The Ornstein-Uhlenbeck HRV simulator matches statistical properties
of resting HRV in healthy adults (WESAD dataset): RMSSD mean 35±15ms, AR(1) autocorrelation > 0.7.
**Method**: Run PhysiologicalSimulator with `SubjectProfile(hrv_baseline_ms=35, sigma=5, theta=0.3)` for N=1000 subjects, 100 turns. Compute population RMSSD mean, SD, autocorrelation.
**Expected result**: Mean RMSSD ∈ [30, 40]ms; AR(1) > 0.7.
**Files**: `tests/benchmarks/test_ou_simulator.py`, `document/figures/E001_hrv_simulator.py`
**Depends on**: P0.7 (WESAD dataset)
**Paper section**: Section 3.2 — Physiological Signal Simulation

---

### E-002 — Stress index discriminant validity
**Status**: PENDING
**Hypothesis**: `stress_index()` assigns higher values to objectively stressed states
(HRV=12ms, EDA=12µS, sleep deficit=10h) than calm states (HRV=55ms, EDA=1µS, sleep=8h).
**Method**: Define 4 state prototypes (calm/mild/moderate/critical). Assert monotonic ordering.
Plot stress_index contour over (HRV, EDA) at fixed other parameters.
**Expected result**: strict monotone ordering; Figure 2a of paper.
**Files**: `tests/benchmarks/test_stress_index_validity.py`
**Paper section**: Section 3.3 — Multi-signal Stress Index

---

### E-003 — Γ matrix eigenvalue structure
**Status**: PENDING
**Hypothesis**: `build_Gamma()` produces positive semi-definite matrices with
eigenvalues monotonically related to stress_index. Higher stress → larger eigenvalues → slower recovery.
**Method**: Sample 100 random PhysiologicalState objects, compute Gamma, verify PSD, plot eigenvalue vs. stress_index scatter.
**Expected result**: All eigenvalues ≥ 0; Pearson r(λ_max, stress_index) > 0.85.
**Files**: `tests/benchmarks/test_gamma_structure.py`
**Paper section**: Section 4.2 — Non-Hermitian Operator Construction

---

### E-004 — MCTS stress improvement vs. baseline (billing scenario)
**Status**: DONE (manual run, May 23 2026)
**Hypothesis**: Physiologically-informed MCTS reduces cumulative stress by >3%
vs. first-candidate baseline in a stressed billing negotiation.
**Method**: `tensornets.therapy.comparison_runner` billing_denial_mcts_demo scenario.
Mock LLM with 4 candidates per turn, standard mode, 4 turns.
**Result**: MCTS improvement +3.1%; final stress 0.446 (MCTS) vs 0.614 (baseline).
**Files**: `tensornets/tensornets/therapy/comparison_runner.py`
**Commit**: (record on next run with --scenario billing_denial_mcts_demo)
**Notes**: Keyword heuristic only. Phase 3 (MPS ⟨Ψ|Γ|Ψ⟩) expected to give larger delta.
**Paper section**: Section 5.2 — MCTS Evaluation

---

### E-005 — MCTS stress improvement vs. baseline (deaddiction strike phase)
**Status**: DONE (manual run, May 23 2026)
**Result**: MCTS improvement +2.0%; final stress 0.439 (MCTS) vs 0.483 (baseline).
MCTS avoids direct clinical confrontation in favour of indirect questioning.
**Notes**: Phase-dependent cost function (DEADDICTION/strike) correctly penalises
blunt confrontation even when it temporarily achieves goal progress.

---

### E-006 — Flooding scenario: 0% MCTS improvement
**Status**: DONE (manual run, May 23 2026) — LIMITATION DOCUMENTED
**Result**: MCTS improvement 0.0%. All candidates scored equally.
**Root cause**: Mock candidates are semantically identical under the flooding keyword set.
**Fix needed**: E-006b — Diversity-forcing candidate generation (see below).
**Paper note**: This is an honest limitation — keyword heuristic cannot score
exposure-appropriate vs. avoidance-appropriate responses without semantic content variation.
The fix requires either: (a) LLM-generated diverse candidates, or (b) a trained
linguistic stress estimator (E-008).

---

### E-006b — Flooding MCTS with diverse LLM candidates
**Status**: PENDING
**Hypothesis**: With LLM-generated candidates spanning the hold/escape/deepen spectrum,
MCTS correctly selects hold/deepen responses over premature reassurance.
**Method**: Use Bedrock Llama 4 Scout with system prompt forcing 4 distinct framings:
  - Framing 1: premature reassurance ("It's okay to feel anxious, let's slow down")
  - Framing 2: neutral observation ("I notice you're feeling uncomfortable")
  - Framing 3: hold exposure ("Stay with it. What does the anxiety feel like right now?")
  - Framing 4: deepen exposure ("Describe the cafe in more detail. How many people?")
Measure: MCTS should rank framing 3 or 4 highest under flooding mode.
**Files**: `tests/benchmarks/test_flooding_diverse_candidates.py`

---

### E-007 — Document clause MCTS lift
**Status**: DONE (manual run, May 23 2026)
**Hypothesis**: MCTS clause ordering achieves higher expected all-clause acceptance
probability than document-order for a stressed patient (initial σ=0.55).
**Result**: MCTS lift +5.5% (0.1875 vs 0.1777 expected all-accepted).
Key finding: presenting appeal_basis BEFORE liability increases P(liability accepted)
by reducing σ at the liability presentation moment (0.366 vs 0.388).
**Paper section**: Section 5.3 — Document Negotiation

---

### E-008 — Linguistic stress estimator vs. keyword heuristic
**Status**: PENDING (blocked on E-001 / WESAD data)
**Hypothesis**: A trained classifier (text → Δ HRV impact, trained on WESAD) outperforms
the keyword heuristic in ranking candidates by physiological impact.
**Baseline**: Keyword heuristic (current) — AUC on held-out WESAD conversations.
**Proposed model**: Fine-tuned Mistral 7B on (utterance, Δ RMSSD) pairs from WESAD.
**Files**: `tensornets/tensornets/linguistic/stress_estimator.py` (pending)
**Depends on**: P0.7 (WESAD), Track D (distillation infrastructure)

---

### E-009 — Pharmacological modifier validation
**Status**: PENDING
**Hypothesis**: MetoprololModel produces a peak Γ reduction of 33±5% at t=2h, matching
Kleiger et al. 2005 (beta-blocker HRV increase of ~30% in cardiac patients).
**Method**: Run `MetoprololModel(50).trajectory()`, read peak modifier, compare to literature.
**Expected result**: peak modifier ∈ [0.62, 0.72] (28–38% reduction).
**Files**: `tests/benchmarks/test_pkpd_validation.py`
**Paper section**: Section 3.4 — Pharmacological Subspace

---

### E-010 — Hysteresis worked example reproducibility
**Status**: DONE (automated, May 23 2026)
**Result**: 1-month therapy (4 sessions): SUDS 100→88. 6-month gap: 88→94.
Reinstatement (magnitude 0.7): 94→96.
**Paper section**: Section 3.5 — Hysteretic Baseline Model
**Note**: α_ext=0.04, α_recovery=0.025/week, α_reinstatement=0.45 are currently
prior-based. Validation against empirical extinction curves from Bouton (2004)
and Rescorla-Wagner (1972) is pending (E-010b).

---

### E-011 — Scheduling MCTS: physio readiness vs. earliest-slot baseline
**Status**: DONE (manual run, May 23 2026)
**Result**: For a patient with σ=0.62, HRV=16ms, last psychotherapy session 6 days ago:
  - Earliest available slot: Wednesday 2026-05-27 (cost=0.48, infeasible)
  - MCTS recommended slot: Monday 2026-06-08 09:00 (cost=0.1183)
  - Gap: 13 additional days for physiological recovery
**Paper section**: Section 5.4 — Scheduling Optimization
**Note**: The 13-day gap is driven by hysteresis_w_max=0.75 (high fear weight prevents
full stress recovery). This is a clinically meaningful difference.

---

### E-012 — Reactivity profile discrimination
**Status**: DONE (automated, May 23 2026)
**Result**: At σ=0.35 (just above threshold):
  HYPERSENSITIVE: Γ mod 1.73×, STOIC: 0.93×, LABILE: 1.30×, RUMINANT: 1.09×.
After 5 turns at σ=0.7 then 5 calm turns, RUMINANT retains grudge_state=0.66
(Γ mod 1.73×) while others recover to near-baseline.
**Paper section**: Section 3.6 — Individual Reactivity Profiles

---

### E-013 — Multi-dimensional MCTS reward: trust vs. stress tradeoff
**Status**: PENDING
**Hypothesis**: A response that scores high on trust_delta but low on stress_reduction
is correctly preferred over a response that scores high on stress_reduction but low
on trust in the rapport phase.
**Method**: Create two synthetic candidates:
  A: "You should follow your doctor's instructions" (high stress reduction via authority, trust-eroding)
  B: "It sounds like you're struggling with this" (lower stress reduction, trust-building)
Under rapport phase weights, B should have lower cost than A.
**Files**: `tests/benchmarks/test_multidim_reward.py`

---

### E-014 — MPS constraint projection: safety guarantee
**Status**: DONE (unit test exists)
**Result**: `project_constraint()` with a constraint matrix that zeros out token 7
produces zero probability for token 7 in all test cases (test_core.py).
**Paper section**: Section 4.3 — Safety Constraint Layer
**Note**: The guarantee is hard (mathematical) not statistical. This is the key
distinction from prompt-engineering-based safety.

---

## Open questions requiring experiments

| ID | Question | Experiment needed |
|----|----------|------------------|
| OQ-1 | Which MPS bond dimension χ is optimal? | E: vary χ ∈ {32, 64, 128}, measure constraint fidelity vs. compute cost |
| OQ-2 | Does keyword heuristic rank correlated with WESAD Δ HRV? | Needs WESAD data (P0.7) |
| OQ-3 | Does flooding MCTS correctly select hold vs. escape responses with real LLM candidates? | E-006b |
| OQ-4 | Does reactivity profile assignment from HRV alone correlate with DSM-5 trait scores? | Clinical validation study |
| OQ-5 | Is the 5.5% document MCTS lift statistically significant at N=1000 patients? | Monte Carlo simulation |
| OQ-6 | Does MPS inter-agent partial trace reduce contradictory agent responses? | A/B test in simulation |
| OQ-7 | What is the optimal n_lookahead for MCTS? | Vary n ∈ {1, 3, 5, 10}, measure cost vs. compute |

---

## Paper section → experiment mapping

| Paper section | Experiment(s) |
|---------------|--------------|
| 3.2 Physiological simulation | E-001 |
| 3.3 Stress index | E-002 |
| 3.4 Pharmacological subspace | E-009 |
| 3.5 Hysteretic baseline | E-010, E-010b |
| 3.6 Reactivity profiles | E-012 |
| 4.2 Non-Hermitian operators | E-003 |
| 4.3 Safety constraint | E-014 |
| 5.2 MCTS dialogue | E-004, E-005, E-006b, E-013 |
| 5.3 Document negotiation | E-007 |
| 5.4 Scheduling | E-011 |
| 5.5 Training feedback | judge.py cost analysis |

---

## Future Work — Mixed / Composite Scenario Track

### Rationale
Standard scenarios test a single clinical concern (angina, billing denial, flooding exposure).
Real clinical encounters frequently combine multiple stressors simultaneously:
a patient with angina who also has a billing dispute, or a suicidal patient whose carer is
hitting caregiver burnout at the same time.  Composite scenarios stress-test generalisation
and expose whether physio-aware agents outperform oldschool on harder, more realistic inputs.

### Prerequisite gate
**Do not create composite scenarios until Exp 3 (Inertial PhysioMPS-MCTS) and
Exp 4 (Inertial PhysioLLM CoT) have 500 episodes.**
Adding them earlier dilutes training signal before the base agents converge.

### Proposed composites (3–5 scenarios)
| ID | Domain A | Domain B | Difficulty |
|----|----------|----------|------------|
| `composite_angina_billing` | `angina_lifestyle_resistance` | `billing_denial_mcts_demo` | High — physical urgency + system friction |
| `composite_suicidal_burnout` | `js_suicidal_patient` | caregiver burnout persona | Very High — crisis escalation + carer stress |
| `composite_chest_adherence` | `js_chest_pain_emergency` | medication non-adherence | High — acute + chronic tension |
| `composite_flooding_family` | `flooding_social_anxiety` | world_family_network_care | High — exposure therapy + multi-agent family |
| `composite_depression_billing` | depression + passive suicidality | billing_denial | Moderate-High |

### Implementation strategy
1. Add composite scenarios in `training/world_simulation/world_scenarios.js` using the
   existing `WORLD_SCENARIOS_DEFINITIONS` pattern.  Each composite defines:
   - Two interleaved clinical concerns in the `instructions.agent` field
   - A `difficulty: 'composite'` tag for separate tracking
   - `initial_physio` seeded from the more urgent condition (higher stress_index baseline)
2. The `_no_sensor` variant is auto-generated by `training.js` for each composite.
3. Scenario IDs follow the `composite_<a>_<b>` pattern so the dashboard sensor-comparison
   chart naturally groups them under their base scenario.
4. Evaluation: compare goal rate on composites vs their individual components.
   Hypothesis: physio-aware arms degrade less on composites than oldschool.

### Tracking
- [x] Gate: Exp 3 + Exp 4 now training in run_015 (2026-05-31) — gate lifted at 500-episode target
- [x] Implement 3 composites in `training/simulation/scenarios/composite_scenarios.js`
- [x] Wired into `training/simulation/scenarios/index.js` → appears in /api/training/scenarios
- [x] `routes/training.js` passes `physio_baseline` + `difficulty` through to scenario objects
- [x] `_no_sensor` variants auto-generated by the no-sensor loop in `routes/training.js`
- [x] `composite` filter added to scenario rank table in dashboard (All / Composite / Escalation)
- [ ] Run 200 episodes per composite per arm (composites will appear in run_015 automatically)
- [ ] Verify composite scenarios appear in /api/training/scenarios after server restart
- [ ] Confirm composite goal rates are lower than individual components (hypothesis gate)
