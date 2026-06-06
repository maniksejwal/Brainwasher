# 16 — HTN Framework Benchmarking Log (Experiments Register)

> **Migration record**
> - Original file: `docs/tensornets/EXPERIMENTS.md`
> - Migrated: 2026-06-04
> - Changes from original: Added H₀ null hypotheses, rejection criteria tables, and confound tables to all experiments. Added E-010b entry. Fixed all 7 broken test file references (tests/benchmarks/ directory does not exist — annotated as TODO). Added hardware/git-hash fields for DONE experiments. Updated composite scenario tracking to match numbered format.
> - Original file preserved at `docs/tensornets/EXPERIMENTS.md`.

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

## Hardware specification template (fill in before reporting DONE results)

| Field | Value |
|---|---|
| CPU | |
| RAM | |
| GPU | |
| Python version | |
| PyTorch version | |
| tensornets git hash | `git rev-parse HEAD` |
| Random seed | |
| Run timestamp | |

---

## Experiment register

### E-001 — HRV simulator validation
**Status**: PENDING
**Hypothesis**: The Ornstein-Uhlenbeck HRV simulator matches statistical properties
of resting HRV in healthy adults (WESAD dataset): RMSSD mean 35±15ms, AR(1) autocorrelation > 0.7.
**Method**: Run PhysiologicalSimulator with `SubjectProfile(hrv_baseline_ms=35, sigma=5, theta=0.3)` for N=1000 subjects, 100 turns. Compute population RMSSD mean, SD, autocorrelation.
**Expected result**: Mean RMSSD ∈ [30, 40]ms; AR(1) > 0.7.
**Files**: `tests/benchmarks/test_ou_simulator.py` [⚠️ tests/benchmarks/ directory does not yet exist — create before running], `document/figures/E001_hrv_simulator.py`
**Depends on**: P0.7 (WESAD dataset)
**Paper section**: Section 3.2 — Physiological Signal Simulation

**H₀**: The simulated HRV distribution mean does not differ from the WESAD benchmark population mean (μ_sim = μ_WESAD).
**H₁**: μ_sim ≠ μ_WESAD (two-sided).
**Test**: Two-sample t-test (simulated vs WESAD episodes, n_sim = 1000, n_WESAD = 15 participants × multiple sessions).
**α** = 0.05, **β** = 0.20, **Min detectable d** = 0.3 (small effect size for RMSSD comparison).
**Primary confound**: Individual variation in WESAD participants. Mitigation: use population mean ± SD, not individual trajectories.

---

### E-002 — Stress index discriminant validity
**Status**: PENDING
**Hypothesis**: `stress_index()` assigns higher values to objectively stressed states
(HRV=12ms, EDA=12µS, sleep deficit=10h) than calm states (HRV=55ms, EDA=1µS, sleep=8h).
**Method**: Define 4 state prototypes (calm/mild/moderate/critical). Assert monotonic ordering.
Plot stress_index contour over (HRV, EDA) at fixed other parameters.
**Expected result**: strict monotone ordering; Figure 2a of paper.
**Files**: `tests/benchmarks/test_stress_index_validity.py` [⚠️ tests/benchmarks/ directory does not yet exist — create before running]
**Paper section**: Section 3.3 — Multi-signal Stress Index

**H₀**: The stress_index values of the 4 prototypes are not monotonically ordered (i.e., at least one adjacent pair violates strict ordering).
**H₁**: calm < mild < moderate < critical (strict monotone chain).
**Test**: McNemar / exact ordering assertion across 100 random perturbations of each prototype.
**α** = 0.05, **β** = 0.20, **Min detectable effect**: odds ratio ≥ 2.0 for adjacent-class discrimination.
**Primary confound**: Interaction effects between HRV and EDA at boundary values. Mitigation: fix all other parameters, vary one signal at a time for the contour plot.

---

### E-003 — Γ matrix eigenvalue structure
**Status**: PENDING
**Hypothesis**: `build_Gamma()` produces positive semi-definite matrices with
eigenvalues monotonically related to stress_index. Higher stress → larger eigenvalues → slower recovery.
**Method**: Sample 100 random PhysiologicalState objects, compute Gamma, verify PSD, plot eigenvalue vs. stress_index scatter.
**Expected result**: All eigenvalues ≥ 0; Pearson r(λ_max, stress_index) > 0.85.
**Files**: `tests/benchmarks/test_gamma_structure.py` [⚠️ tests/benchmarks/ directory does not yet exist — create before running]
**Paper section**: Section 4.2 — Non-Hermitian Operator Construction

**H₀**: Pearson r(λ_max, stress_index) ≤ 0.85 (no strong positive correlation).
**H₁**: r > 0.85.
**Test**: One-sided Pearson correlation test (n = 100 random states).
**α** = 0.05, **β** = 0.20, **Min detectable d** = 0.3 (correlation shift from 0.85 baseline).
**Primary confound**: Numerical instability near-zero eigenvalues for low-stress states. Mitigation: add ε = 1e-8 regularisation floor; report proportion of states with negative eigenvalues separately.

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
**Hardware**: (fill in hardware template above before next publication run)
**Notes**: Keyword heuristic only. Phase 3 (MPS ⟨Ψ|Γ|Ψ⟩) expected to give larger delta.
**Paper section**: Section 5.2 — MCTS Evaluation

**H₀**: MCTS cumulative stress improvement ≤ 0% vs. first-candidate baseline.
**H₁**: MCTS improvement > 0% (one-sided).
**Test**: Wilcoxon signed-rank test on per-turn stress delta (MCTS vs. baseline), n = 4 turns × repeated runs.
**α** = 0.05, **β** = 0.20, **Min detectable d** = 0.5 (medium effect, ≥ 3% absolute improvement).
**Primary confound**: Mock LLM candidates are deterministic — results may not generalise to stochastic real LLM outputs. Mitigation: replicate with Bedrock Llama 4 Scout in E-006b.

---

### E-005 — MCTS stress improvement vs. baseline (deaddiction strike phase)
**Status**: DONE (manual run, May 23 2026)
**Result**: MCTS improvement +2.0%; final stress 0.439 (MCTS) vs 0.483 (baseline).
MCTS avoids direct clinical confrontation in favour of indirect questioning.
**Hardware**: (fill in hardware template above before next publication run)
**Notes**: Phase-dependent cost function (DEADDICTION/strike) correctly penalises
blunt confrontation even when it temporarily achieves goal progress.

**H₀**: MCTS improvement ≤ 0% in the deaddiction/strike-phase scenario.
**H₁**: MCTS improvement > 0%.
**Test**: Wilcoxon signed-rank on per-turn stress delta (same protocol as E-004).
**α** = 0.05, **β** = 0.20, **Min detectable d** = 0.5.
**Primary confound**: Strike-phase scenario is short (4 turns); low power. Mitigation: extend to 10-turn variant for publication.

---

### E-006 — Flooding scenario: 0% MCTS improvement
**Status**: DONE (manual run, May 23 2026) — LIMITATION DOCUMENTED
**Result**: MCTS improvement 0.0%. All candidates scored equally.
**Hardware**: (fill in hardware template above before next publication run)
**Root cause**: Mock candidates are semantically identical under the flooding keyword set.
**Fix needed**: E-006b — Diversity-forcing candidate generation (see below).
**Paper note**: This is an honest limitation — keyword heuristic cannot score
exposure-appropriate vs. avoidance-appropriate responses without semantic content variation.
The fix requires either: (a) LLM-generated diverse candidates, or (b) a trained
linguistic stress estimator (E-008).

**H₀**: With mock candidates, MCTS improvement = 0% (null confirmed by design).
**H₁**: With diverse LLM candidates (E-006b), MCTS improvement > 0%.
**Test**: McNemar test comparing rank ordering of candidates under keyword heuristic vs. LLM semantic scoring.
**α** = 0.05. **Min detectable odds ratio** = 2.0.
**Primary confound**: Keyword heuristic collapses candidate diversity. This is the documented limitation — E-006b is the mitigation experiment.

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
**Files**: `tests/benchmarks/test_flooding_diverse_candidates.py` [⚠️ tests/benchmarks/ directory does not yet exist — create before running]

**H₀**: MCTS rank of framing 3 or 4 does not exceed rank of framing 1 or 2 under flooding mode (no correct selection).
**H₁**: MCTS ranks framing 3 or 4 strictly above framing 1 and 2.
**Test**: Paired t-test on MCTS cost scores across n = 50 random flooding-scenario seeds.
**α** = 0.05, **β** = 0.20, **Min detectable d** = 0.5.
**Primary confound**: Llama 4 Scout may not reliably produce 4 distinct framings in a single call. Mitigation: enforce framing diversity via structured output schema with validation loop.

---

### E-007 — Document clause MCTS lift
**Status**: DONE (manual run, May 23 2026)
**Hypothesis**: MCTS clause ordering achieves higher expected all-clause acceptance
probability than document-order for a stressed patient (initial σ=0.55).
**Result**: MCTS lift +5.5% (0.1875 vs 0.1777 expected all-accepted).
Key finding: presenting appeal_basis BEFORE liability increases P(liability accepted)
by reducing σ at the liability presentation moment (0.366 vs 0.388).
**Hardware**: (fill in hardware template above before next publication run)
**Paper section**: Section 5.3 — Document Negotiation

**H₀**: MCTS clause ordering does not improve expected all-clause acceptance probability vs. document-order (P_MCTS ≤ P_document).
**H₁**: P_MCTS > P_document.
**Test**: Wilcoxon signed-rank on per-patient acceptance probability improvement (n = 1000 simulated patients, OQ-5).
**α** = 0.05, **β** = 0.20, **Min detectable d** = 0.3 (small effect; 5.5% lift observed in single run).
**Primary confound**: Single-patient run — result may not generalise across σ values. Mitigation: Monte Carlo simulation across σ ∈ [0.3, 0.8] (see OQ-5).

---

### E-008 — Linguistic stress estimator vs. keyword heuristic
**Status**: PENDING (blocked on E-001 / WESAD data)
**Hypothesis**: A trained classifier (text → Δ HRV impact, trained on WESAD) outperforms
the keyword heuristic in ranking candidates by physiological impact.
**Baseline**: Keyword heuristic (current) — AUC on held-out WESAD conversations.
**Proposed model**: Fine-tuned Mistral 7B on (utterance, Δ RMSSD) pairs from WESAD.
**Files**: `tensornets/tensornets/linguistic/stress_estimator.py` (pending)
**Depends on**: P0.7 (WESAD), Track D (distillation infrastructure)

**H₀**: AUC(trained classifier) ≤ AUC(keyword heuristic) on held-out WESAD utterances.
**H₁**: AUC(classifier) > AUC(keyword heuristic).
**Test**: Paired t-test on AUC across 5 cross-validation folds.
**α** = 0.05, **β** = 0.20, **Min detectable d** = 0.5 (AUC improvement ≥ 0.05 absolute).
**Primary confound**: WESAD utterances are lab-recorded (not naturalistic clinical dialogue). Mitigation: report performance separately on lab vs. naturalistic (Brainwasher training) utterances.

---

### E-009 — Pharmacological modifier validation
**Status**: PENDING
**Hypothesis**: MetoprololModel produces a peak Γ reduction of 33±5% at t=2h, matching
Kleiger et al. 2005 (beta-blocker HRV increase of ~30% in cardiac patients).
**Method**: Run `MetoprololModel(50).trajectory()`, read peak modifier, compare to literature.
**Expected result**: peak modifier ∈ [0.62, 0.72] (28–38% reduction).
**Files**: `tests/benchmarks/test_pkpd_validation.py` [⚠️ tests/benchmarks/ directory does not yet exist — create before running]
**Paper section**: Section 3.4 — Pharmacological Subspace

**H₀**: Peak Γ modifier from MetoprololModel(50) falls outside [0.62, 0.72] (does not match Kleiger et al. 2005).
**H₁**: Peak modifier ∈ [0.62, 0.72].
**Test**: One-sample t-test against literature point estimate (μ = 0.67, σ estimated from 5% tolerance).
**α** = 0.05, **β** = 0.20, **Min detectable d** = 0.5.
**Primary confound**: Kleiger et al. 2005 is a cardiac-patient cohort; healthy-subject PK parameters differ. Mitigation: cite both cardiac and healthy-subject references; note model is conservative (cardiac population represents higher HRV sensitivity).

---

### E-010 — Hysteresis worked example reproducibility
**Status**: DONE (automated, May 23 2026)
**Result**: 1-month therapy (4 sessions): SUDS 100→88. 6-month gap: 88→94.
Reinstatement (magnitude 0.7): 94→96.
**Hardware**: (fill in hardware template above before next publication run)
**Paper section**: Section 3.5 — Hysteretic Baseline Model
**Note**: α_ext=0.04, α_recovery=0.025/week, α_reinstatement=0.45 are currently
prior-based. Validation against empirical extinction curves from Bouton (2004)
and Rescorla-Wagner (1972) is pending (E-010b).

**H₀**: Simulated SUDS trajectory does not reproduce the qualitative extinction-recovery-reinstatement pattern (no monotone decrease during therapy, no increase during gap, no reinstatement spike).
**H₁**: Trajectory exhibits all three phases in correct direction.
**Test**: Exact assertion on trajectory direction (automated unit test); publish trajectory as Figure 3b.
**α** = 0.05 (directional assertion). **No MDE required** — this is a worked-example reproducibility check, not a statistical comparison.
**Primary confound**: Parameter values are prior-based, not empirically calibrated. Mitigation: E-010b calibrates against Bouton (2004).

---

### E-010b — Hysteresis Parameter Empirical Calibration
**Status**: PENDING
**Hypothesis**: The W_FLOOR=0.08 (latent inhibition) and λ_extinct values in `physio/hysteresis.py` can be calibrated against published extinction curves (Bouton 2004, Figure 2; Rescorla & Wagner 1972 Table 1) to produce fear weight trajectories that match empirically observed extinction rates in CBT trials.
**Method**: Extract mean extinction curves from Bouton (2004) Fig. 2 (3-session extinction protocol). Fit λ_extinct, α_rec, and W_FLOOR to minimise MSE between simulated w_k trajectory and observed recovery rates. Compare against naive fixed-parameter baseline.
**Expected result**: Calibrated parameters reduce MSE by ≥ 30% vs. uncalibrated defaults.
**Paper section**: §3.4 (Hysteresis Implementation) and Appendix B (Parameter Calibration).

**H₀**: Calibrated parameters do not reduce MSE vs. defaults (MSE_calibrated ≥ MSE_default).
**H₁**: MSE_calibrated < MSE_default.
**Test**: Paired t-test on MSE across 20 random patient trajectories.
**α** = 0.05. **Min detectable d** = 0.5.
**Confound**: Published extinction data is from animal studies (Bouton 2004); human extrapolation requires citation of translational validity. Mitigation: cite Craske et al. (2008) inhibitory learning model for human CBT.

---

### E-011 — Scheduling MCTS: physio readiness vs. earliest-slot baseline
**Status**: DONE (manual run, May 23 2026)
**Result**: For a patient with σ=0.62, HRV=16ms, last psychotherapy session 6 days ago:
  - Earliest available slot: Wednesday 2026-05-27 (cost=0.48, infeasible)
  - MCTS recommended slot: Monday 2026-06-08 09:00 (cost=0.1183)
  - Gap: 13 additional days for physiological recovery
**Hardware**: (fill in hardware template above before next publication run)
**Paper section**: Section 5.4 — Scheduling Optimization
**Note**: The 13-day gap is driven by hysteresis_w_max=0.75 (high fear weight prevents
full stress recovery). This is a clinically meaningful difference.

**H₀**: MCTS-selected slot cost does not differ from earliest-available slot cost (cost_MCTS ≥ cost_earliest).
**H₁**: cost_MCTS < cost_earliest.
**Test**: Wilcoxon signed-rank on slot cost across n = 100 simulated patient profiles spanning σ ∈ [0.4, 0.8].
**α** = 0.05, **β** = 0.20, **Min detectable d** = 0.5.
**Primary confound**: Scheduling cost function uses hysteresis_w_max as hard gate — patients with low w_max may show no MCTS lift. Mitigation: report lift stratified by w_max quartile.

---

### E-012 — Reactivity profile discrimination
**Status**: DONE (automated, May 23 2026)
**Result**: At σ=0.35 (just above threshold):
  HYPERSENSITIVE: Γ mod 1.73×, STOIC: 0.93×, LABILE: 1.30×, RUMINANT: 1.09×.
After 5 turns at σ=0.7 then 5 calm turns, RUMINANT retains grudge_state=0.66
(Γ mod 1.73×) while others recover to near-baseline.
**Hardware**: (fill in hardware template above before next publication run)
**Paper section**: Section 3.6 — Individual Reactivity Profiles

**H₀**: Γ modifiers do not differ significantly across reactivity profiles at σ=0.35 (all modifiers within ±10% of 1.0×).
**H₁**: At least one profile modifier differs by > 10% from STOIC baseline.
**Test**: Paired t-test on Γ modifier distribution across 100 random σ values near threshold (σ ∈ [0.30, 0.40]).
**α** = 0.05, **β** = 0.20, **Min detectable d** = 0.5.
**Primary confound**: Profile modifiers are deterministic (no stochasticity in the modifier function). Mitigation: introduce σ perturbation (±0.02) to simulate measurement noise and confirm ordering holds.

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
**Files**: `tests/benchmarks/test_multidim_reward.py` [⚠️ tests/benchmarks/ directory does not yet exist — create before running]

**H₀**: Cost(B) ≥ Cost(A) under rapport-phase weights (trust dimension does not override stress dimension).
**H₁**: Cost(B) < Cost(A).
**Test**: Exact assertion on cost ordering for the two synthetic candidates; replicated across n = 50 rapport-phase weight perturbations.
**α** = 0.05, **β** = 0.20, **Min detectable d** = 0.5.
**Primary confound**: Synthetic candidates are hand-crafted — real LLM candidates may not exhibit such clean trust/stress separation. Mitigation: replicate with Llama 4 Scout–generated candidates after E-006b infrastructure is in place.

---

### E-014 — MPS constraint projection: safety guarantee
**Status**: DONE (unit test exists)
**Result**: `project_constraint()` with a constraint matrix that zeros out token 7
produces zero probability for token 7 in all test cases (test_core.py).
**Hardware**: (fill in hardware template above before next publication run)
**Paper section**: Section 4.3 — Safety Constraint Layer
**Note**: The guarantee is hard (mathematical) not statistical. This is the key
distinction from prompt-engineering-based safety.

**H₀**: project_constraint() does not guarantee zero probability for constrained tokens (probabilistic, not hard).
**H₁**: P(token 7 | constraint zeros token 7) = 0.000 exactly (hard guarantee, not statistical).
**Test**: Exact numerical assertion (not statistical test) — verify output probability vector entry for token 7 equals 0.0 across all test inputs in test_core.py.
**α** = N/A (exact guarantee — not a statistical test). **Note**: Any non-zero value constitutes rejection of the hard guarantee claim in the paper.
**Primary confound**: Floating-point rounding could produce near-zero but non-zero values. Mitigation: assert abs(p[7]) < 1e-12, not p[7] == 0.

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
