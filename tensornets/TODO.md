# tensornets — TODO (Active)

> PhD research package. Every item that generates a result must be benchmarked.
> Status legend: `[ ]` pending · `[~]` in progress · `[x]` done · `[!]` blocked
>
> Distillation pipeline (Track D) moved to `TODO_DISTILLATION.md` — requires data sourcing decisions first.

---

## WHAT IS DONE

| Item | File | Status |
|---|---|---|
| Package scaffold | `pyproject.toml`, `tensornets/__init__.py` | ✅ |
| PhysiologicalState (8 signals) + PhysiologicalHistory | `physio/state.py` | ✅ |
| Sleep deficit, circadian entrainment, respiratory rate | `physio/state.py` | ✅ |
| HRV → γ → λ₁ mapping (sleep-aware `gamma_from_state`) | `physio/hrv.py` | ✅ |
| Non-Hermitian operators H_eff, H, Γ | `core/operators.py` | ✅ |
| Matrix Product State + contraction + constraint projection | `core/mps.py` | ✅ |
| Synthetic HRV simulator (Ornstein-Uhlenbeck) | `physio/simulator.py` | ✅ |
| Bedrock backend (Llama 4 Scout/Maverick, Llama 3.3 70B, Mistral 675B) | `linguistic/bedrock.py` | ✅ |
| Ollama local backend | `distillation/backends/ollama_local.py` | ✅ |
| CLI demo (HRV simulation + constraint projection + Bedrock live) | `demo.py` | ✅ |
| **Hysteresis model** (extinction learning, spontaneous recovery, reinstatement) | `physio/hysteresis.py` | ✅ |
| **PK/PD models** (Metoprolol, SSRI, BZD, Naltrexone) | `physio/pkpd.py` | ✅ |
| **Individual reactivity profiles** (HYPERSENSITIVE, STOIC, LABILE, RUMINANT) | `physio/reactivity.py` | ✅ |
| **Therapeutic modes** (flooding, deaddiction phases, MCTS cost functions) | `therapy/modes.py` | ✅ |
| **Longitudinal session state** + secret detection | `therapy/longitudinal.py` | ✅ |
| **MCTS comparison runner** (billing, deaddiction-strike, flooding) | `therapy/comparison_runner.py` | ✅ |
| **FastAPI bridge** (physio, MCTS, therapy, longitudinal endpoints) | `server.py` | ✅ |
|| **Multi-dimensional MCTS reward** (stress, trust, goal, info, consistency) | `therapy/mcts_reward.py` | done |
|| **Document clause MCTS** (ordering, acceptance probability) | `documents/clause_mcts.py` | done |
|| **Scheduling MCTS** (physio-aware slot ranking, PK/PD + hysteresis) | `scheduling/mcts_scheduling.py` | done |
|| **LLM-as-judge** (405B, 6-dim rubric, DPO counterfactuals) | `training/judge.py` | done |
|| **MET/OARS/SPIKE framework** (phase gates, readiness, phase prompts) | `therapy/met_framework.py` | done |
|| **Linguistic stress model** (confrontation, density, valence, loss-frame) | `linguistic/stress_model.py` | done |
|| **Habit hysteresis** (formation, decay, relapse, rebuild asymmetry) | `physio/habit_hysteresis.py` | done |
|| **Inter-agent communication** (SharedDialogueState, V_int coupling) | `agents/inter_agent_comm.py` | done |
|| **EXPERIMENTS.md** (benchmarking register, paper section -> experiment map) | `docs/tensornets/EXPERIMENTS.md` | done |
|| **Companion hysteresis** (alliance, trust, strategic patience, rupture/repair) | `agents/companion_hysteresis.py` | done |
|| **Activity context** (post-workout, fasting, illness, pain, food-drug gate) | `physio/activity_context.py` | done |
|| **Action selector prompt** (planning layer, MCTS action taxonomy) | `prompts/action_selector.js` | done |
|| **Benchmarks runner** (dedicated, separate from tests) | `benchmarks/runner.py` | done |
|| **Edge-case personas** (bipolar, ASPD, NPD, 6 religions, game-theory) | `training/simulation/personas/edge_case_personas.js` | done |
|| **Privacy layer** (info classes I-IV, consent gates, disclosure advantage, audit log) | `agents/privacy_layer.py` | done |
|| **Phase 3: BaseMCTS + DialogMCTS** (UCB1, backprop, multi-dim reward, 13ms latency) | `mcts/base.py` | ✅ DONE |
|| **Session manager** (multi-session state, longitudinal MCTS, contact preferences) | `agents/session_manager.py` | done |
|| **JS judge** → DELETED (redundant with `llm_scorer.js` + `simulation_scorer.js`) | — | done |
|| **HTN Judge endpoints** (/judge/turn, /judge/session, /judge/audit) | `server.py` | done |
|| **DiscrepancyAudit** (cross-evaluator divergence detection, trust-weighted scoring) | `training/judge.py` | done |
|| **MCTS best-action endpoint** (/mcts/best-action, Phase 3 FastAPI) | `server.py` | done |
|| **Personas subpackage** + **docs/tensornets/** (file organisation) | `training/simulation/personas/index.js` | done |
|| **Phase 2: SVD truncation, apply_transition, expectation_value, ALS update** | `core/mps.py` | ✅ DONE |
|| **Phase 2: partial_trace_physio** (Phase 4 preview, privacy) | `core/mps.py` | done |
|| **PhD defence pre-meeting document** (clause_mcts, DisclosureAdvantagePlanner) | `documents/clause_mcts.py` | done |
|| **auditJudgeDiscrepancy** JS bridge function | `companions/physio/tensornetsBridge.js` | done |
|| 67 tests (physio + core) | `tests/test_physio.py`, `tests/test_core.py` | ✅ 67/67 |

---

## PHASE 0 — Remaining Setup

- [x] P0.1–P0.4 Package scaffold, pyproject.toml, tests, __init__
- [ ] **P0.5** Run `ollama show mistral --modelfile` — confirm whether GGUF weights can be reused or HF download needed to `D:/hf_cache`
- [ ] **P0.6** Request Llama 3.1 405B access on Bedrock console (needed for full distillation benchmarks — deferred)
- [ ] **P0.7** Download WESAD dataset (free, no approval): https://ubicomp.eti.uni-siegen.de/home/datasets/icmi18/
- [ ] **P0.8** PhysioNet account for MIMIC-III/IV: https://physionet.org (~1 week)

**Data sourcing decision needed before distillation — see `TODO_DISTILLATION.md`**

---

## TRACK C — Physiological Subspace

### Done
- [x] C1 — PhysiologicalState dataclass + normalization + stress_index
- [x] C2 — HRV → γ mapping, gamma_to_lambda1, decay amplitude, half-life
- [x] C3 — build_H0, build_Gamma, build_H_eff, build_transition_operator, safety_zero_out
- [x] C4 — PhysiologicalSimulator (OU process, stressor events, subject profiles)

### Pending

- [x] **C4.2** MC ensemble — 1000 trajectories, mean + p10/p90 bands — **DONE** `physio/monte_carlo.py`
- [x] **C4.3** Figure 3 (ASCII console + matplotlib-ready) — **DONE** `physio/monte_carlo.py`
- [x] **C4.4** Convergence unit test — PASS (29 turns, theory=30) — **DONE** `physio/monte_carlo.py`- [ ] **C5.1** `MetoprololModel`: two-compartment PK/PD, ke0 equilibration rate → Γ diagonal — **DONE** in `physio/pkpd.py`
- [ ] **C5.2** `SSRIModel`: fast activation syndrome + slow receptor downregulation — two-timescale Γ — **DONE** in `physio/pkpd.py`
- [ ] **C5.3** Tests for PK/PD models (MetoprololModel peak modifier, SSRI phase crossover, BZD tolerance decay)
- [ ] **C5.4** `DrugRegimen` integration into `build_Gamma()` (wire `pkpd.py` → `operators.py`)
- [ ] **C5.5** Validate PK/PD decay curves against literature values (Kleiger 2005, Agelink 2001)
- [ ] **C6.1** `ReactivityProfile` integration: wire `gamma_modifier()` into `gamma_from_state()`
- [ ] **C6.2** Tests for all four archetypes (threshold activation, labile peak, ruminant decay)
- [ ] **C7.1** `HystereticBaseline` integration: `TriggerHysteresis.gamma_modifier()` as longitudinal Γ factor
- [ ] **C7.2** Test worked example from paper (panic → 1-month therapy → 6-month gap → reinstatement)

**Benchmark C (open)**: Validate decay curves against WESAD HRV recordings (need P0.7 first).

---

## TRACK B — LLM Backend

### Done
- [x] `linguistic/bedrock.py` — Bedrock Converse API, all working models, streaming, fallback
- [x] `distillation/backends/ollama_local.py` — Ollama REST adapter

### Pending
- [x] **B1** Abstract `LLMBackend` interface — **DONE** `linguistic/backend_base.py` (MockLLMBackend for tests)
- [ ] **B6** Benchmark: Bedrock Llama 4 Scout TTFT and tokens/sec baseline (needed for Phase 3 latency comparison)

---

## PHASE 2 — MPS Core Engine
*Prerequisite: C4.4 + C5 complete. MPS structure already existed — this phase wires physio evolution in.*

- [x] **E3** SVD-based bond truncation (`svd_truncate`, `compress`) — **DONE** `core/mps.py`
- [x] **E4** Wire `apply_transition(mps, H)` — full MPS update per conversational turn — **DONE** `core/mps.py`
- [x] **E5** `expectation_value(mps, operator, site)` — `⟨Ψ|Ô|Ψ⟩` scalar, `physio_energy()` — **DONE** `core/mps.py`
- [x] **E6** ALS localized update + sweep (`als_update`, `als_sweep`) — **DONE** `core/mps.py`
- [x] **E6b** `partial_trace_physio()` (Phase 4 preview) — **DONE** `core/mps.py`
- [ ] **E7** Integration test: 10-turn conversation, physio state updates per turn, verify decay and safety hold
  - *Smoke test passes. Full integration test with operators pending.*

**Benchmark E**: Scaling test — N ∈ {10, 50, 100, 500} turns, confirm O(Ndχ²) wall time.

---

## PHASE 3 — MCTS + Dual-Agent
*Start after E7 passes. F1+F2 are now done independently of Phase 2.*

- [x] **F1** `MCTSNode`: state, parent, children, visit count, value — **DONE** `mcts/base.py`
- [x] **F2** `DialogMCTS`: UCB1 selection, expansion, multi-dim reward, backprop — **DONE** `mcts/base.py`
- [ ] **F3** SVD compress MCTS path → constraint matrix `M_trunc` (requires Phase 2 MPS)
- [ ] **F4** Tactical agent: Bedrock Llama + `M_trunc` projection via `project_constraint()`
- [ ] **F5** Latency test: MCTS background + generation foreground < 200ms TTFT
  - *(Current smoke test: 13.9ms for 120 iterations / depth 4 — well within budget)*
- [x] **F6** FastAPI `/mcts/best-action` endpoint — **DONE** `server.py`
- [x] **F7** `tensornetsBridge.js` `getMCTSAction()` — **DONE** `companions/physio/tensornetsBridge.js`
- [x] **F8** Multi-session state + longitudinal MCTS (`/session/open`, `/session/close`, `/session/hint`) — **DONE**

---

## PHASE 4 — Integration with Brainwasher 3
*Start after F5. See separate JS fix task below (priority).*

- [x] **G1** Shared tensor state buffer (thread-safe) — **DONE** `agents/shared_tensor_state.py` + `/session/tensor/update`
- [x] **G2** Partial trace for inter-agent reading — **DONE** `SharedTensorBuffer.partial_trace_physio()` + `/session/tensor/summary`
- [x] **G3** Social coupling matrix V_int — **DONE** `V_INT_PRIOR` + `v_int_propagate()` (Phase 5 A3C will learn per-session values)
- [ ] **G7** Map CompanionCoordinator roles → HTN agent subspaces

---

## PHASE 5 — A3C Comparison (three arms)
*See `docs/tensornets/A3C_COMPARISON_DESIGN.md` for full design.*

### Blocking prerequisites (must complete before A3C)
- [ ] **E7** Integration test: 10-turn conversation, physio state updates per turn, verify decay and safety hold
- [ ] **C5.4** `DrugRegimen` integration into `build_Gamma()` (wire `pkpd.py` → `operators.py`)
- [ ] **C6.1** `ReactivityProfile` integration: wire `gamma_modifier()` into `gamma_from_state()`
- [ ] **C7.1** `HystereticBaseline` integration: `TriggerHysteresis.gamma_modifier()` as longitudinal Gamma factor
- [ ] **F3** SVD compress MCTS path → constraint matrix `M_trunc` (requires E7)
- [ ] **F4** Tactical agent: Bedrock Llama + `M_trunc` projection via `project_constraint()`

### A3C warm-up — Thompson Sampling bandit
- [ ] **I1** `ActionBandit`: Beta posterior per action per stress bucket
- [ ] **I2** Thompson Sampling action selection (Scout inference, cheap)
- [ ] **I3** Bandit training loop (100 episodes, 3 stress buckets × 12 actions)
- [ ] **I4** Bandit weights → A3C actor initialisation

### A3C skeleton
- [ ] **J1** `A3CWorker` base class (episode runner, per-turn reward accumulation, jsonl logging)
- [ ] **J2** Actor: Scout prompt template as policy head (action_selector.js taxonomy)
- [ ] **J3** Critic: Maverick value estimate V(s) per turn
- [ ] **J4** Advantage A(s,a) = r + γV(s') - V(s); gradient update
- [ ] **J5** Arm 1 worker: HTN + MCTS (full tensornets bridge active)
- [ ] **J6** Arm 2 worker: Old-school production JS via HTTP (no tensornets)
- [ ] **J7** Arm 3 worker: Hysteresis-in-prompt (tensornets physio state as text, no MPS/MCTS)

### Full comparison run
- [ ] **K1** 3-arm parallel run (50 episodes each, 10 canonical scenarios, same synthetic personas)
- [ ] **K2** Learning curves: reward, actor/critic loss, entropy per arm
- [ ] **K3** Per-scenario transcript comparison (same dialog graph → 3 arm responses side-by-side)
- [ ] **K4** Statistical analysis: Wilcoxon signed-rank + effect size (Arm 1 vs 2 and Arm 1 vs 3)
- [ ] **K5** EXPERIMENTS.md entry with results, interpretation, limitations

---

## PHASE 6 — Benchmarking (Section 5 of paper)
*Last. Requires Phases 2–5 complete.*

- [ ] H1–H7 (see `TODO_DISTILLATION.md` for H benchmarks that depend on distillation)

---

## Open Research Questions

1. **Which layer to distill from?** Paper says "final layer" — ablation needed. Deferred to distillation track.
2. **Optimal χ?** Benchmark at χ ∈ {32, 64, 128, 256}. Run when E7 is done.
3. **Right Δt?** Start at Δt = 1 turn. Sub-turn steps if PK/PD models require it.
4. **Vocabulary mismatch Mistral vs Llama 3?** Decide before distillation.

---

## Notes for PhD Documentation

- Every benchmark: date, model version, hardware spec, random seed, software versions
- Keep `EXPERIMENTS.md`: one entry per experiment — hypothesis, result, interpretation
- Stress decay plot (C4.3) = Figure 3. SVD spectra (distillation) = Figures 1–2.
- Section 5 of paper is blank — filled by H1–H7

