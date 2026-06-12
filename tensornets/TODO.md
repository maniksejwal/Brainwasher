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
- [x] **E7** Integration test: 10-turn conversation, physio state updates per turn, verify decay and safety hold — **DONE** `tests/test_e7_integration.py` (8/8 tests pass)

**Benchmark E**: Scaling test — N ∈ {10, 50, 100, 500} turns, confirm O(Ndχ²) wall time.

---

## PHASE 3 — MCTS + Dual-Agent
*Start after E7 passes. F1+F2 are now done independently of Phase 2.*

- [x] **F1** `MCTSNode`: state, parent, children, visit count, value — **DONE** `mcts/base.py`
- [x] **F2** `DialogMCTS`: UCB1 selection, expansion, multi-dim reward, backprop — **DONE** `mcts/base.py`
- [x] **F3** SVD compress MCTS path → constraint matrix `M_trunc` — **DONE** `mcts/base.py` `_build_M_trunc()` + `best_action()` now returns `M_trunc`
- [x] **F4** Tactical agent: `project_constraint()` — **DONE** `core/operators.py`, soft-steers token logits toward MCTS-preferred action subspace
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
- [x] **E7** Integration test: 10-turn conversation, physio state updates per turn, verify decay and safety hold — DONE
- [x] **C5.4** `DrugRegimen` integration into `build_Gamma()` (wire `pkpd.py` → `operators.py`) — DONE
- [x] **C6.1** `ReactivityProfile` integration: wire `gamma_modifier()` into `gamma_from_state()` — DONE
- [x] **C7.1** `HystereticBaseline` integration: `TriggerHysteresis.gamma_modifier()` as longitudinal Gamma factor — DONE
- [x] **F3** SVD compress MCTS path → constraint matrix `M_trunc` — DONE
- [x] **F4** Tactical agent: `project_constraint()` — DONE
- [x] **P-HRV** Persist HRV history to disk between server restarts — DONE
      `PhysiologicalHistory.save()/load()` in `physio/state.py`; server auto-loads on startup
      and saves on clean shutdown (lifespan hook) + after every `/physio/history/append`.
      Storage dir: `TENSORNETS_HISTORY_DIR` env var (default `tensornets/data/physio_history/`).
- [ ] **P-RAG** Wire `facts_v2` retrieval into `CompanionCoordinator`: before action selector, query
      relevant facts by circle/subject and inject into prompt. This closes the RAG gap — context
      is currently CAG only (physio hint + longitudinal hint). DB schema already has `subject_id`,
      `target_object`, `sensitivity`, `confidence` columns ready for semantic retrieval.

### A3C warm-up — Thompson Sampling bandit
- [x] **I1** `ActionBandit`: Beta posterior per action per stress bucket — **DONE** `a3c/action_bandit.py`
- [x] **I2** Thompson Sampling action selection (Scout inference, cheap) — **DONE** `ActionBandit.select_action()`
- [x] **I3** Bandit training loop (100 episodes, 3 stress buckets × 12 actions) — **DONE** `run_bandit_training()`
- [x] **I4** Bandit weights → A3C actor initialisation — **DONE** `export_actor_prior()` + `train_and_export()`

### A3C skeleton
- [x] **J1** `A3CWorker` base class (episode runner, per-turn reward accumulation, jsonl logging) — DONE `a3c/worker.py`
- [x] **J2** Actor: Scout prompt template as policy head (action_selector.js taxonomy) — DONE `a3c/worker.py::Actor`
- [x] **J3** Critic: Maverick value estimate V(s) per turn — DONE `a3c/worker.py::Critic`
- [x] **J4** Advantage A(s,a) = r + γV(s') - V(s); gradient update — DONE `a3c/worker.py::compute_advantage` / `apply_update`
- [x] **J5** Arm 1 worker: HTN + MCTS (full tensornets bridge active) — DONE `a3c/arms.py::Arm1Worker`
- [x] **J6** Arm 2 worker: Old-school production JS via HTTP (no tensornets) — DONE `a3c/arms.py::Arm2Worker`
- [x] **J7** Arm 3 worker: Hysteresis-in-prompt (tensornets physio state as text, no MPS/MCTS) — DONE `a3c/arms.py::Arm3Worker`

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

## PHASE 4b — Partial Trace Operations (Planned)

### What is a partial trace?

In quantum mechanics, the *partial trace* `Tr_B[ρ_AB]` discards one subsystem B from a bipartite
density matrix `ρ_AB`, yielding the *reduced density matrix* `ρ_A` for subsystem A.  In our context:

- The full MPS `|Ψ⟩` lives in a tensor product space `H_semantic ⊗ H_physio ⊗ H_session`.
- `partial_trace_physio(|Ψ⟩)` traces over `H_physio`, producing a reduced density matrix
  `ρ_semantic` that describes only the semantic (linguistic) content of the conversation without
  exposing raw physiological signals.
- `partial_trace_session(|Ψ⟩)` traces over `H_session`, useful for cross-agent reads where
  session-private state must not leak to companion agents.

### Why we need it

1. **Privacy / inter-agent sandboxing** — `CompanionCoordinator` routes queries between the primary
   companion and specialist agents (sleep, medication, exercise).  Each agent should read only the
   subspace it is authorised to see.  Passing the full `|Ψ⟩` tensor leaks physiological and
   session state that the receiving agent has no business accessing.
2. **Mixed-state formulation** — In long therapy relationships the patient state is genuinely
   mixed: uncertainty over diagnosis, dual hysteresis attractors, medication side-effect ambiguity.
   The pure-state MPS is an approximation.  Full density-matrix treatment (Lindblad evolution)
   requires partial trace as a primitive operation to compute environmental decoherence.
3. **TensorRAG retrieval** — The bond fingerprint (`bond_fingerprint()`) is a heuristic.  A
   principled retrieval key is `ρ_semantic`, which separates *what was discussed* from *how the
   patient felt*, enabling retrieval of semantically similar past episodes regardless of physio state.
4. **Distillation** — The distillation objective will require computing a per-agent information
   gain, defined as `I(semantic; physio) = S(ρ_semantic) + S(ρ_physio) - S(ρ)`.  All three terms
   require partial-trace reduced matrices.

### Current implementation status

`partial_trace_physio()` in `core/mps.py` (line ~985) exists and is tested, but it implements
an *approximation*: it restricts the transfer-matrix update to the first `chi_semantic` bond
indices rather than computing a true partial trace over the full density matrix.  This is correct
in the limit where the physio and semantic bonds are orthogonally ordered, but breaks down when
SVD mixes the subspaces (which it will after many policy updates).

The `SharedTensorBuffer.partial_trace_physio()` wrapper in `agents/shared_tensor_state.py`
calls the MPS method correctly but is marked Phase 4 — its full mixed-state counterpart
(trace over the full `|Ψ⟩⟨Ψ|` density matrix) is not yet built.

### Implementation plan

- [ ] **PT1** Define `density_matrix() -> Tensor[D, D]` on `MatrixProductState`: contract
  `ρ = |Ψ⟩⟨Ψ|` by double-layer contraction, returning the full `(d^N) × (d^N)` density matrix
  for small systems (N ≤ 6 sites, d ≤ 4 physical dim) and a truncated `chi² × chi²` bond-space
  approximation for production.  This is the *exact* Phase 4 primitive.

- [ ] **PT2** Upgrade `partial_trace_physio()` to use the exact double-layer contraction, not
  the transfer-matrix heuristic.  Benchmark against current approximation on 10-turn integration
  test.  Acceptance criterion: `‖ρ_exact - ρ_approx‖_F < 1e-4` for identity-initialised MPS;
  must degrade gracefully (not diverge) after 50 A3C policy updates.

- [ ] **PT3** Add `partial_trace_session()` to marginalise over the longitudinal session bond
  (last `chi_session` indices of the right bond).  This is the "amnesia gate" for cross-agent reads.

- [ ] **PT4** Wire `partial_trace_physio()` into the inter-agent read path in
  `agents/shared_tensor_state.py`.  Replace the current full-tensor JSON dump in `/session/tensor/summary`
  with `ρ_semantic`.  Add authorisation header `X-Subspace: semantic|physio|full` — only the primary
  companion receives `full`.

- [ ] **PT5** TensorRAG: replace `bond_fingerprint()` as the retrieval key with the top-`k`
  eigenvectors of `ρ_semantic` (PCA of the semantic reduced density matrix).  This gives a
  retrieval key that is invariant to physiological confounders.

- [ ] **PT6** Benchmark PT2 latency: partial trace must complete in < 5 ms per turn at χ = 64.
  Profile with `torch.profiler`.

### Effect on training

The partial trace does **not** change the A3C policy gradient itself — the actor and critic
operate on the full `|Ψ⟩` (or the `PatientState` feature vector derived from it).  Its effects
on training are:

1. **Reward shaping** — PT4 enables an information-theoretic reward component: `r_privacy = -I(semantic; physio)`
   penalises turns that increase entanglement between the semantic and physiological subspaces
   (i.e. the model over-indexes on physio signals to drive the conversation).  This encourages
   the companion to respond to *meaning*, not just to stress indicators.
2. **Curriculum** — PT5's semantic retrieval key will improve the curriculum pool retrieval:
   the scheduler will be able to find episodes with similar *conversation content* (not just
   similar stress trajectories), producing more targeted past-state curriculum injection.
3. **Distillation loss** — Once PT1 is implemented, the `mutual_information_loss()` term in the
   distillation objective becomes exact rather than heuristic, improving the quality of the
   distilled smaller model.
4. **No impact on current runs** — runs_023 and earlier use only the `PatientState` feature
   vector; the MPS is a side-channel.  Partial trace is a Phase 4b addition, not a blocker for
   the current 8-arm comparison.

---

## SOCIAL ALLIANCE — Production-Safe Extension Plan

> **Boundary rule**: `AllianceGraph` state is loaded/updated only inside `worker.py::run_episode()` (training).
> The alliance graph is **never mutated from production code**; production only *reads* it via
> `session_memory["alliance"]` → `known_context` text injection in `_build_state_with_continuity()`.
> All signals that update edges (`signals_from_score_result`, `trust_delta_final`, rupture/repair)
> come from the **training A3CScorer**, not from any production scorer or companion event.
> This must be preserved: do NOT wire `AllianceGraph.update_from_episode()` to production paths.

### SA1 — Direct messaging channel + vent delta (pending)

The social alliance model currently only covers companion-mediated turns.  Real care circles also
have **direct user-to-user messages** (patient ↔ family, family ↔ cardiologist) that bypass
companions entirely.  These must update the alliance graph through their own path — not through
the training scorer.

Key design points:
- **Vent delta**: people can be positive in direct interactions but vent frustration to their
  companion about the same person (and vice versa: warm in reality, poor direct communicator).
  The direct edge (`patient → daughter`) and the companion-relayed perception
  (`companion.perception_of[daughter]`) can diverge.  Both edges must be tracked separately.
- **DirectMessageEvent** dataclass:
    ```
    from_role:       str       # e.g. "patient"
    to_role:         str       # e.g. "daughter"
    channel:         str       # "direct" | "companion_relay" | "group"
    sentiment:       float     # ±1, Scout-classified at send time
    stress_proxy:    float     # wearable HRV-derived, or null
    timestamp:       float
    session_id:      str
    ```
- `AllianceGraph.update_from_direct_message(event)` — updates the `from→to` edge using
  asymmetric trust/rupture mechanics but **without** `goal_achieved` (no therapeutic goal in
  direct messages).  Sentiment < -0.4 → mild rupture; sentiment > 0.6 → positive interaction.
- `V_int.put_mps(from_role, None, stress_proxy_hrv)` — seeds physiological carry-over so
  the companion sees the residual stress at episode start, not neutral 0.50.
- `CareCircleOrchestrator` (synthetic patient orchestrator in training) needs a
  `relay_channel` concept: messages tagged `channel="direct"` bypass the companion response
  step and update only the graph + V_int.  A lightweight Scout sentiment call classifies
  the message (not a full companion generation).

- [ ] **SA1.1** Add `DirectMessageEvent` dataclass to `agents/social_alliance.py`
- [ ] **SA1.2** Add `AllianceGraph.update_from_direct_message(event)` with vent-delta support:
      separate `direct_rapport` and `perceived_rapport` fields on `AllianceEdge`
- [ ] **SA1.3** Add `vent_delta` to `AllianceEdge`: tracks divergence between how A behaves
      toward B directly vs. how A describes B to companions (positive = nicer in person than
      to companion; negative = meaner in person)
- [ ] **SA1.4** Wire `direct_message` stress_proxy into `V_int / SharedTensorBuffer` at
      episode start so residual inter-session stress propagates correctly
- [ ] **SA1.5** Add `relay_channel` turn type to `CareCircleOrchestrator` (training-only):
      direct turns skip companion generation, update only graph + V_int
- [ ] **SA1.6** `prompt_context_for()` upgrade: include vent-delta hint so companion knows
      "patient speaks positively of daughter directly but vented frustration in prior session"
- [ ] **SA1.7** Benchmark: multi-person scenarios with direct channel events vs. companion-only
      baseline.  Metric: alliance score trajectory + goal rate across chained episodes

### SA2 — Co-regulation and contagion coupling (pending)

Currently per-participant physiological inertia has no social coupling:
- [ ] **SA2.1** `social_Gamma_modifier(alliance_score, speaker_stress) → Δγ`:
      high alliance + calm speaker → reduces patient recovery time constant;
      ruptured alliance + panicked speaker → increases it
- [ ] **SA2.2** Contagion asymmetry: negative HRV deltas propagate at 1.5× rate vs positive
      (fear/panic spreads faster than calm — empirically supported)
- [ ] **SA2.3** MCTS action `await_co_regulation` — strategic pause until multi-person physio
      stabilises, gated on `vint_consistency_hint` showing all participants below zone threshold
- [ ] **SA2.4** Wire SA2.1 into `PhysioSimulator.step()` via `ReactivityProfile.gamma_modifier()`



- Every benchmark: date, model version, hardware spec, random seed, software versions
- Keep `EXPERIMENTS.md`: one entry per experiment — hypothesis, result, interpretation
- Stress decay plot (C4.3) = Figure 3. SVD spectra (distillation) = Figures 1–2.
- Section 5 of paper is blank — filled by H1–H7

