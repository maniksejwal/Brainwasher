# Brainwasher 3 — Master TODO

> **Source-of-truth guide:**  This file is the single consolidated tracker for all work streams.
> `tensornets/TODO.md` is the detailed PhD research scratchpad (phase-gated items, proofs, benchmarks).
> `documentation/tensornets/A3C_COMPARISON_DESIGN.md` holds the live experiment register and results table.
> Status: `[ ]` pending · `[~]` in progress · `[x]` done · `[!]` blocked
> Priority: 🔴 Now · 🟠 Soon · 🟡 Later · ⚪ Deferred

---

## Contents

| # | Section | Priority | Open items |
|---|---------|----------|-----------|
| 1 | Active Sprint — Training (run_027) | 🔴 | 2 |
| 2 | Active Sprint — Dashboard | 🔴 | 0 (all done) |
| 3 | Active Sprint — Training Reliability | 🔴 | 0 (all done) |
| 4 | Experiment Design | 🔴 | 3 |
| 5 | Python Arm Improvements (post-run_027) | 🟠 | 7 |
| 6 | A3C Full Comparison Run (K1–K5) | 🟠 | 5 |
| 6b | A3C Feedback & Policy Quality | 🟠 | 5 |
| 7 | Phase 4 — Integration (G7, P-RAG) | 🟠 | 2 |
| 8 | Phase 4b — Partial Trace (PT1–PT6) | 🟠 | 6 |
| 9 | Social Alliance (SA1, SA2, SA3 dynamic) | 🟠 | 15 |
| 10 | MCTS Upgrades (MPS speed-up, Mtrunc, action-space) | 🟠 | 5 |
| 11 | Phase 3 — MCTS Latency (F5) | 🟡 | 1 |
| 12 | Physiological Subspace (C/B tracks) | 🟡 | 8 |
| 13 | TensorRAG (full wiring) | 🟠 | 4 |
| 14 | Data Integrity & Logging Audit | 🔴 | 4 |
| 15 | Distillation — Llama 17B on earned data | 🟡 | 3 |
| 16 | Phase 0 — Data Sourcing | ⚪ | 4 |
| 17 | Phase 6 — Benchmarking (H1–H7) | ⚪ | 1 |
| 18 | Product — Notifications | 🟡 | 6 |
| 19 | Product — RBAC | 🟡 | 2 |
| 20 | Product — Data & State Architecture | 🟡 | 6 |
| 21 | Product — Security & Deployment | 🟡 | 5 |
| 22 | Product — Advanced Agent Capabilities | ⚪ | 2 |
| 23 | Open Research Questions | ⚪ | 7 |
| 24 | Completed (recent) | — | — |

---

## 1. 🔴 Active Sprint — Training (run_027)

| ID | Task | Status | Notes |
|----|------|--------|-------|
| T1 | Monitor run_027; target 1000 eps/arm for base Exp 0–7 | [ ] | Base arms at ~800+ eps; rebalancer active |
| T2 | Ablation (0a–7a) and DPO (0p–7p) arms catch-up | [ ] | Currently 175–530 eps; lower priority workers |

---

## 2. 🔴 Active Sprint — Dashboard (all done)

| ID | Task | Status | File |
|----|------|--------|------|
| D1 | Fix All Time stats table (was capping at 100) | [x] | `benchmarksDashboard.js` |
| D2 | Fix Crit Fail % (nulls counted as 0%; now shows —) | [x] | `benchmarksDashboard.js` |
| D3 | Fix group filter buttons (Base/Ablation/DPO re-render) | [x] | `benchmarksDashboard.js` |
| D4 | HPVOOT labels — add "Inertial" prefix everywhere | [x] | `benchmarksDashboard.js` |
| D5 | Move Recent Stats table to top; default N=100; Goal%(500) column | [x] | `benchmarksDashboard.js`, `index.html` |
| D6 | Enable vertical Y-axis zoom on all line charts | [x] | `benchmarksDashboard.js` |
| D7 | New Goal Rate — 100-Episode Buckets chart (most recent on left) | [x] | `benchmarksDashboard.js` |
| D8 | Per-line tooltip (nearest mode) + offset positioner (no cursor overlap) | [x] | `benchmarksDashboard.js` |

---

## 3. 🔴 Active Sprint — Training Reliability (all done)

| ID | Task | Status | File |
|----|------|--------|------|
| R1 | Bedrock hang fix: `http_post` in `ThreadPoolExecutor` (hard wall-clock timeout) | [x] | `node_client.py` |
| R2 | Stall detector self-restart via `os.execv` (physio healthy but stalled 15 min) | [x] | `train.py` |
| R3 | Historical-deficit-aware rebalancer (90% cumul. DB eps, 10% current-run) | [x] | `train.py` |
| R4 | Round-robin pool rebalancer replacing stop-on-gap logic | [x] | `train.py` |
| R5 | Watchdog script + internal stall detector | [x] | `tensornets/scripts/watchdog.py` |

---

## 4. 🔴 Experiment Design

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| EXP-RENAME | Rename ablation arms 1a–7a from `NoGate` → `NoCritGate` | 🔴 | [ ] | `NoGate` gives no hint of what was gated. Rename class names (`PhysioLLMNoCritGateWorker` etc.), ARM strings (`physio_llm_no_crit_gate` etc.), `EXP_META` dashboard labels, `A3C_COMPARISON_DESIGN.md`, `EXPERIMENTS.md`. Add `LEGACY_ALIAS` entry in `benchmarksDashboard.js` for existing DB rows so historical data maps correctly. |
| EXP-RAG | New arms: Exp 8 PlainRAG, Exp 9 TensorRAG, Exp 10 TensorRAG+MPS-MCTS | 🟠 | [ ] | **Exp 8** (`physio_llm_plain_rag`): Exp 1 + text-only cosine retrieval from `clinical_kb`. **Exp 9** (`physio_llm_tensor_rag`): Exp 1 + physio-conditioned TensorRAG (mirrors JS `queryTensorRAGContext()`). **Exp 10** (`inertial_tensor_rag_mps_mcts`): Exp 4 + TensorRAG — tests if MPS-MCTS benefits from richer context. Verify `/rag/query` accepts `use_physio` flag; add to `EXP_META` and design doc. TensorRAG index already built (`tensornets/data/rag/clinical_kb.*`). |
| EXP-ABL-EXT | Extended ablations after run_027: no-longitudinal, no-hysteresis, no-physio, frozen-bandit | ⚪ | [ ] | **ABL-A** `physio_llm_no_longitudinal`: remove longitudinal hint — isolates cross-session memory value. **ABL-B** `physio_llm_no_hysteresis`: only instantaneous stress_index — isolates hysteresis extinction history. **ABL-C** `physio_llm_no_physio`: pure text companion with A3C policy — true floor. **ABL-D** frozen-bandit: freeze actor after warm-up — answers "how much does A3C add over Thompson Sampling?" |

---

## 5. 🟠 Python Arm Improvements *(do not change prompts mid-run_027)*

> **Context:** Python arms 1–7 use a minimal `_DEFAULT_SYSTEM_PROMPT` with only `{hysteresis_ctx}` + `{action}`.
> The JS `PROMPT_ACTION_SELECTOR` has 12+ vars: stress level, HRV, zone, therapeutic_mode, session_goal,
> turns_completed, info_coverage, repetition_detected, last_action, conversation_history, known_context,
> longitudinal_hint, TensorRAG_context, pending_intervention.
> Exp 0 (JS) outperforms Python arms partly because its generator is richer, not purely better policy.

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| PA1 | Align base prompts with JS `PROMPT_ACTION_SELECTOR` | 🟠 | [ ] | Define `_PYTHON_BASE_SYSTEM_PROMPT` with therapeutic_mode, session_goal, last_action, turns_completed, repetition_detected. Replace `_DEFAULT_SYSTEM_PROMPT` in `PhysioLLMWorker` and all subclasses. Keep reward fn + policy unchanged — prompt is the only variable. |
| PA2 | Inject longitudinal session hint into generation prompt | 🟠 | [ ] | Add `_build_longitudinal_hint(state) -> str` mirroring JS `getLongitudinalHint()`. Pull from `state.session_memory`: session_number, last_session_outcome, goal_progress, alliance_score, flagged_topics. DPO arms already have F1-F5 via `_build_dpo_prompt_vars` — refactor so base arms share the same extraction. |
| PA3 | Wire TensorRAG into Python arm generation prompts | 🟠 | [ ] | Add `_query_rag_context(state, user_msg, k=4) -> str` calling physio server `/rag/query` with stress_index + hrv + turn text. Inject as `{rag_context}`. Graceful fallback to empty string on failure. Applies to all arms 1–7 and their DPO/ablation variants. |
| PA4 | Wire `facts_v2` known-context block into Python arm prompts | 🟠 | [ ] | Add `_retrieve_known_context(state, scenario, user_msg) -> str` that POSTs to Node.js `/api/facts/relevant` with circleId, subjectId, currentTopic. Inject as `{known_context}`. If endpoint not exposed, add it to `routes/facts.js`. This is the biggest missing piece — session-persistent patient facts (meds, allergies, disclosures) are invisible to Python arms. |
| PA5 | Document reward measurement confound | 🟠 | [ ] | `_synthetic_reward` scores response text quality equally across arms, but Exp 0 responses come from the richer JS pipeline. This is a confound (not circularity). Document in `arms.py` and `A3C_COMPARISON_DESIGN.md`. Consider Exp 0b: JS generation + Python A3C action selection — isolates generator quality from policy quality. |
| PA6 | Refactor arms.py — `_BasePythonGenerationMixin` | 🟡 | [ ] | Extract mixin with `_build_context()`, `_call_scout()`, `_finalize_response()`. Each arm overrides only `_build_system_prompt()`. Ablation flags become class attributes (`DISABLE_CRITICAL_FAILURE_GATE`, `SKIP_PRIVACY_GUARD`) — collapses 24 classes to ~8 base + flags. |
| PA7 | Extend no-privacy ablation to Python arms 1–7 | 🟡 | [ ] | Exp 0a disables JS `privacyGuard`. For pure Python arms, privacy ablation = inject unredacted `session_memory.flagged_topics` without suppression. Decide: do 1a–7a become NoPrivacy+NoCritGate or add new 1b–7b slots? |

---

## 6. 🟠 A3C Full Comparison Run (K1–K5)

> run_027 is live with 24 arms. K1–K5 are the paper-quality analysis steps after sufficient episodes.
> See `documentation/tensornets/A3C_COMPARISON_DESIGN.md` for full design, metrics, and current results table.

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| K1 | Run 10 canonical scenarios through all 8 base arms; collect transcripts | 🟠 | [ ] | Same synthetic patient, same scenario seed → all arm responses side-by-side. Scenarios: billing denial, deaddiction-strike, flooding, phd_supervisor, panic, etc. |
| K2 | Learning curves: reward, actor/critic loss, entropy per arm | 🟠 | [ ] | Plot per-arm over episode count. Expected: entropy decreases as policy converges; reward increases. |
| K3 | Per-scenario transcript comparison | 🟠 | [ ] | Same user input → all arm responses for 10 canonical scenarios. HTN judge batch scoring offline. |
| K4 | Statistical analysis: Wilcoxon signed-rank + effect size | 🟠 | [ ] | Arms 1–7 vs Exp 0 (production JS baseline). Also pairwise: Exp 3 vs 1, Exp 4 vs 3, Exp 6 vs 4. |
| K5 | `EXPERIMENTS.md` entry with results, interpretation, limitations | 🟠 | [ ] | One entry per experiment — hypothesis, result, interpretation. Section 5 of paper. |

---

## 6b. 🟠 A3C Feedback & Policy Quality

> **Context (items 1, 2, 6 from Aug upgrade plan):**
> Current A3C: scalar reward signal, EWA weight update, no qualitative feedback loop.
> Exp 0 and Exp 0p are not truly trained (Actor/Critic updates disabled for Exp 0;
> Exp 0p uses context enrichment only, not gradient updates). DPO arms 1p–7p showed
> poor improvement because the generation gap vs JS was never closed.

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| FB1 | Qualitative feedback loop for A3C reward shaping | 🟠 | [ ] | After each episode, run a brief Scout "what went wrong / what worked?" pass over the full transcript. Extract 1-3 actionable insights (e.g. "companion repeated the same question twice", "no acknowledgement before advice"). Convert to a `qualitative_penalty` scalar added to the reward signal. This gives the policy a richer gradient than binary goal_achieved. |
| FB2 | DPO counterfactual generation per episode | 🟠 | [ ] | For each episode where `goal_achieved=False`, generate a "what would a better response have been?" counterfactual using Scout with the full context. Store as `(state, chosen_response, rejected_response)` triple in `htn_benchmark_turns`. Use these triples for DPO fine-tuning of the generation prompt (not the action-selection policy). |
| FB3 | Enable Exp 0 learning (A3C on JS pipeline) | 🟠 | [ ] | Currently Exp 0 runs JS generation but disables Actor/Critic updates (observed-only). To make it a proper learning baseline: wire `apply_update()` for Exp 0 using the same EWA mechanism as Exp 1–7, treating the JS action as the selected action. This lets Exp 0 improve its *action prior* over time even though generation stays in JS. |
| FB4 | Exp 0p context enrichment → actual DPO | 🟠 | [ ] | Exp 0p currently injects richer context into JS pipeline (context enrichment only). True DPO would: (1) collect chosen/rejected pairs from episode outcomes, (2) fine-tune the system prompt template using DPO loss on Scout. This requires storing `system_prompt_used` per turn in DB and a DPO training loop outside Bedrock (since logits are not exposed). Alternative: use the counterfactuals from FB2 as DPO pairs and run prompt optimisation via RLAIF scoring. |
| FB5 | Qualitative feedback for DPO arms (1p–7p) | 🟠 | [ ] | Arms 1p–7p show poor goal rates despite context enrichment. Add qualitative feedback (FB1) to these arms first — it is low-cost and can be toggled per arm. Measure delta in goal rate vs. base arm after 200 episodes. If no improvement, the bottleneck is generation quality (PA1–PA4), not the policy. |

---



| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| P-RAG | Wire `facts_v2` retrieval into `CompanionCoordinator` | 🟠 | [ ] | Before action selector, query relevant facts by circle/subject and inject into prompt. Context is currently CAG only (physio hint + longitudinal hint). DB schema has `subject_id`, `target_object`, `sensitivity`, `confidence` columns ready for semantic retrieval. |
| G7 | Map `CompanionCoordinator` roles → HTN agent subspaces | 🟡 | [ ] | Without this, Arm 1 (HTN+MCTS) does not flow through the production system. Low urgency while training runs. |

---

## 8. 🟠 Phase 4b — Partial Trace Operations

> **What is a partial trace?** In quantum mechanics, `Tr_B[ρ_AB]` discards subsystem B from a bipartite
> density matrix, yielding reduced density matrix `ρ_A`. In our context the full MPS `|Ψ⟩` lives in
> `H_semantic ⊗ H_physio ⊗ H_session`. Partial trace lets each agent read only its authorised subspace.
>
> **Current status:** `partial_trace_physio()` in `core/mps.py` implements an *approximation* (restricts
> transfer-matrix update to first `chi_semantic` bond indices). This breaks down after many policy updates
> when SVD mixes subspaces. The `SharedTensorBuffer` wrapper is correct but the full mixed-state
> counterpart (trace over full `|Ψ⟩⟨Ψ|`) is not yet built.
>
> **Why needed:** (1) Privacy/inter-agent sandboxing — each specialist agent reads only its subspace.
> (2) Mixed-state formulation — long therapy relationships have genuinely mixed state.
> (3) TensorRAG — principled `ρ_semantic` retrieval key invariant to physio confounders.
> (4) Distillation — mutual information `I(semantic; physio)` requires partial-trace primitives.
>
> **Effect on training:** Does NOT change A3C policy gradient. Enables: reward shaping via
> `r_privacy = -I(semantic; physio)`; better curriculum retrieval via semantic key; exact
> `mutual_information_loss()` for distillation.

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| PT1 | `density_matrix() -> Tensor[D,D]` on `MatrixProductState` | 🟠 | [ ] | Contract `ρ = |Ψ⟩⟨Ψ|` by double-layer contraction. Full `(d^N)×(d^N)` for small systems (N≤6, d≤4); truncated `χ²×χ²` for production. Exact Phase 4 primitive. |
| PT2 | Upgrade `partial_trace_physio()` to exact double-layer contraction | 🟠 | [ ] | Replace transfer-matrix heuristic. Acceptance: `‖ρ_exact − ρ_approx‖_F < 1e-4` for identity MPS; must not diverge after 50 A3C updates. |
| PT3 | Add `partial_trace_session()` — amnesia gate for cross-agent reads | 🟠 | [ ] | Marginalise over longitudinal session bond (last `chi_session` right-bond indices). |
| PT4 | Wire into inter-agent read path; replace full-tensor JSON dump | 🟠 | [ ] | Replace full-tensor in `/session/tensor/summary` with `ρ_semantic`. Add `X-Subspace: semantic|physio|full` header — only primary companion receives `full`. |
| PT5 | TensorRAG: replace `bond_fingerprint()` with top-k eigenvectors of `ρ_semantic` | 🟠 | [ ] | PCA of semantic reduced density matrix. Retrieval key invariant to physiological confounders. |
| PT6 | Benchmark PT2 latency < 5 ms per turn at χ=64 | 🟠 | [ ] | Profile with `torch.profiler`. |

---

## 9. 🟠 Social Alliance — Production-Safe Extension

> **Boundary rule:** `AllianceGraph` is loaded/updated only inside `worker.py::run_episode()` (training).
> It is **never mutated from production code**. Production only *reads* it via
> `session_memory["alliance"]` → `known_context` injection in `_build_state_with_continuity()`.
> All edge updates come from the training `A3CScorer`. Do NOT wire `AllianceGraph.update_from_episode()`
> to any production path.

### SA1 — Direct Messaging Channel + Vent Delta

> The alliance model covers only companion-mediated turns. Real care circles also have direct
> user-to-user messages (patient ↔ family, patient ↔ cardiologist) that bypass companions entirely.
> **Vent delta:** a person can be positive in direct interactions but vent frustration to their
> companion about the same person, or vice versa. The `patient → daughter` direct edge and the
> companion's `perception_of[daughter]` edge must be tracked separately.
>
> `DirectMessageEvent` dataclass fields: `from_role`, `to_role`, `channel` ("direct"|"companion_relay"|"group"),
> `sentiment` (±1, Scout-classified), `stress_proxy` (HRV-derived or null), `timestamp`, `session_id`.
>
> `AllianceGraph.update_from_direct_message(event)` uses asymmetric trust/rupture mechanics without
> `goal_achieved` (no therapeutic goal in direct messages). Sentiment < -0.4 → mild rupture;
> > 0.6 → positive interaction. `V_int.put_mps(from_role, None, stress_proxy)` seeds physiological
> carry-over so the companion sees residual stress at episode start, not neutral 0.50.

| ID | Task | Priority | Status |
|----|------|----------|--------|
| SA1.1 | Add `DirectMessageEvent` dataclass to `agents/social_alliance.py` | 🟠 | [ ] |
| SA1.2 | Add `AllianceGraph.update_from_direct_message(event)` with vent-delta support; separate `direct_rapport` and `perceived_rapport` fields on `AllianceEdge` | 🟠 | [ ] |
| SA1.3 | Add `vent_delta` to `AllianceEdge`: tracks divergence between direct behaviour vs. companion-relayed perception | 🟠 | [ ] |
| SA1.4 | Wire `direct_message` stress_proxy into `V_int / SharedTensorBuffer` at episode start | 🟠 | [ ] |
| SA1.5 | Add `relay_channel` turn type to `CareCircleOrchestrator` (training-only): direct turns skip companion generation, update only graph + V_int | 🟠 | [ ] |
| SA1.6 | `prompt_context_for()` upgrade: include vent-delta hint ("patient speaks positively of daughter directly but vented frustration in prior session") | 🟠 | [ ] |
| SA1.7 | Benchmark: multi-person scenarios with direct channel events vs. companion-only baseline. Metric: alliance trajectory + goal rate across chained episodes | 🟠 | [ ] |

### SA2 — Co-regulation and Contagion Coupling

> Currently per-participant inertia has no social coupling. In real negotiation, one person's calm
> actively calms others (parasympathetic co-regulation). Fear/panic spreads faster than calm
> (negative emotional contagion asymmetry, empirically supported).

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| SA2.1 | `social_Gamma_modifier(alliance_score, speaker_stress) → Δγ` | 🟠 | [ ] | High alliance + calm speaker → reduces patient recovery time constant γ. Ruptured alliance + panicked speaker → increases γ. |
| SA2.2 | Contagion asymmetry: negative HRV deltas propagate at 1.5× rate vs positive | 🟠 | [ ] | Empirically supported; wire into V_int propagation. |
| SA2.3 | MCTS action `await_co_regulation` | 🟠 | [ ] | Strategic pause until multi-person physio stabilises, gated on `vint_consistency_hint` showing all participants below zone threshold. |
| SA2.4 | Wire SA2.1 into `PhysioSimulator.step()` via `ReactivityProfile.gamma_modifier()` | 🟠 | [ ] | |

### SA3 — Dynamic V_int Coupling (currently static)

> **Context (item 4 from Aug upgrade plan):**
> Currently `V_ij` coupling weights in `SharedTensorBuffer` are fixed priors initialised at startup.
> Propagation works (husband's HRV drop flows to wife's companion) but the *coupling strength*
> never changes. The scenario "anxious husband → wife panic attack" would require:
> (a) high V_ij (strong coupling), (b) asymmetric negative contagion (SA2.2),
> (c) the wife's companion detecting elevated incoming HRV delta and switching to panic support mode.
> None of this is learned or adaptive.

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| SA3.1 | Update `V_ij` weights per session from A3C episode outcomes | 🟠 | [ ] | After each episode, if `goal_achieved=True` and `social_coupling_was_active`, increase `V_ij` by `α=0.05`. If `critical_failure=True` and couple was in conflict, decrease by `β=0.10`. Store updated weights back to `SharedTensorBuffer`. Boundary rule: update only in `worker.py`, never in production. |
| SA3.2 | Asymmetric panic contagion: if incoming V_int HRV delta < -15ms and zone≥3, trigger `PANIC_PSYCHOEDUCATION` cluster priority boost in MCTS | 🟠 | [ ] | Companion detects that the care circle member is in physiological crisis (via Vint propagation) and pre-emptively adjusts action selection before the patient's next message. |
| SA3.3 | Add panic scenario to training corpus with two-person physiological coupling | 🟠 | [ ] | Scenario: husband has angina episode (Zone 4, HRV 8ms). V_int propagates delta to wife's companion. Wife starts showing stress (Zone 3, HRV 22ms). Companion must not just do generic breathing instruction but provide specific reassurance about cardiac vs. panic distinction. |
| SA3.4 | Honest documentation: V_int is currently static — update `A3C_COMPARISON_DESIGN.md` and `appendix_a_architecture.md` once SA3.1 is implemented | 🟡 | [ ] | |

---

## 10. 🟠 MCTS Upgrades

> **Context (items 7, 8 from Aug upgrade plan):**
> Current MCTS: standard UCB1 flat tree search with leaf simulation. `Mtrunc` is built from
> the MCTS path using SVD but effectively amounts to a one-hot count of best-action visits —
> the SVD is applied to a nearly degenerate matrix. Earlier design planned LLM calls at each
> leaf node (expensive); switched to one LLM call on best leaf only (cheap but thin).

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| MCTS1 | MPS-accelerated MCTS leaf simulation | 🟠 | [ ] | Current: leaf simulation uses a random rollout (fast but uninformative) or falls back to actor prior. Better: use MPS `expectation_value(state, action_operator)` as a zero-LLM leaf evaluator — the MPS encodes the physiological trajectory and can score actions without an LLM call. This replaces the expensive "LLM at each leaf" plan with an O(χ²) tensor operation. Benchmark vs. random rollout: does it improve goal rate? |
| MCTS2 | Fix Mtrunc — replace one-hot with true SVD guidance | 🟠 | [ ] | Current `_build_M_trunc()` constructs a path matrix from visit counts, which is nearly rank-1. The SVD then trivially recovers the best action. Fix: build the matrix from the *value estimates* Q(s,a) along the best K paths (not just the single best), so the top singular vectors encode genuine action trade-offs. This gives the LLM prompt a richer gradient ("prefer empathy over advice, but if stress drops to zone 2 then goal-setting is viable"). |
| MCTS3 | Expand action space: panic-specific psychoeducation cluster | 🟠 | [ ] | Current action taxonomy has 51 actions with no panic-specific entry. The "breathe" response observed in panic scenarios comes from the generic `de_escalate` cluster. Add a `PANIC_PSYCHOEDUCATION` action type with sub-actions: `reassure_not_cardiac`, `reassure_not_hypoxic` (vasoconstriction ≠ hypoxia), `normalise_duration` ("this will pass in 5-15 min"), `grounding_5_4_3_2_1`, `support_available`. Wire into HPVOOT as a new cluster with zone-4 affinity boost (+0.45). Add to `action_bandit.py`, `arms.py` action taxonomy, and dashboard `EXP_META`. |
| MCTS4 | Progressive lookahead depth tied to episode count | 🟡 | [ ] | Already partially implemented as `progressive_lookahead()` in `arms.py` but not fully activated. Confirm it ramps from depth 4 → 12 over first 500 episodes per arm. Log current depth per episode to DB (`mcts_depth` column in `htn_benchmark_episodes`). |
| MCTS5 | HPVOOT prior quality fix (session context in prior call) | 🟠 | [ ] | Diagnosed in `A3C_COMPARISON_DESIGN.md §10`: Scout prior scores return near-uniform (~0.5±0.1) because the prior prompt lacks session context. Fix: pass last 2 patient turns + session goal into `_fetch_prior_scores()`. Also reduce `VOOT_C_VAR` from 0.8 → 0.4 after 50 arm episodes to reduce over-exploration at cluster level. |

---



| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| F5 | Latency test: MCTS background + generation foreground < 200 ms TTFT | 🟡 | [ ] | Current smoke test: 13.9 ms for 120 iterations / depth 4 — well within budget. Formal test still needed for paper. |

---

## 11. 🟡 Phase 3 — MCTS Latency

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| F5 | Latency test: MCTS background + generation foreground < 200 ms TTFT | 🟡 | [ ] | Current smoke test: 13.9 ms for 120 iterations / depth 4 — well within budget. Formal test still needed for paper. |

---

## 12. 🟡 Physiological Subspace (Track C/B)

> **Benchmark C (open):** Validate decay curves against WESAD HRV recordings (needs P0.7 first).
> **Benchmark E (open):** Scaling test — N ∈ {10, 50, 100, 500} turns, confirm O(Ndχ²) wall time.

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| C5.3 | Tests for PK/PD models | 🟡 | [ ] | MetoprololModel peak modifier, SSRI phase crossover, BZD tolerance decay. |
| C5.5 | Validate PK/PD decay curves against literature | 🟡 | [ ] | Kleiger 2005, Agelink 2001. |
| C6.2 | Tests for all four reactivity archetypes | 🟡 | [ ] | Threshold activation, labile peak, ruminant decay, stoic. |
| C7.2 | Test worked example from paper | 🟡 | [ ] | panic → 1-month therapy → 6-month gap → reinstatement. |
| B6 | Benchmark: Bedrock Llama 4 Scout TTFT and tokens/sec baseline | 🟡 | [ ] | Needed for Phase 3 latency comparison. |
| ALS | Wire ALS into A3C policy update path | 🟡 | [ ] | Current `apply_update()` uses log-bias EWA on Actor dict. ALS sweep exists in `core/mps.py` but is not wired into the A3C gradient update. |

---

## 13. 🟠 TensorRAG — Full Wiring

> **Context (item 9 from Aug upgrade plan):**
> TensorRAG index is built (`tensornets/data/rag/clinical_kb.*`, `episode_memory.*`).
> The physio server has a `/rag/query` endpoint. But TensorRAG is not yet wired into any arm
> or production path. The JS `queryTensorRAGContext()` call in `CompanionCoordinator` is the
> reference implementation.

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| RAG1 | Confirm `/rag/query` accepts `use_physio` flag; add if missing | 🟠 | [ ] | Need flag to switch between physio-conditioned retrieval (TensorRAG) and text-only cosine (PlainRAG). Used by EXP-RAG arms and PA3. |
| RAG2 | Wire TensorRAG into Python arms 1–7 (see PA3) | 🟠 | [ ] | `_query_rag_context(state, user_msg, k=4)` → inject as `{rag_context}`. Same as JS `queryTensorRAGContext()`. |
| RAG3 | Evaluate retrieval quality: TensorRAG vs PlainRAG vs no-RAG | 🟠 | [ ] | Run K1 canonical scenarios through Exp 8 (PlainRAG), Exp 9 (TensorRAG), Exp 1 (no-RAG). Compare goal rate and reward. If TensorRAG ≤ PlainRAG, physio-conditioned retrieval adds no value — document honestly. |
| RAG4 | PT5 integration: replace `bond_fingerprint()` with `ρ_semantic` eigenvectors as retrieval key | 🟡 | [ ] | Depends on PT1–PT2. Makes TensorRAG retrieval key invariant to physiological confounders. |

---

## 14. 🔴 Data Integrity & Logging Audit

> **Context (item 12 from Aug upgrade plan):**
> Several statistics and log entries in the thesis PDF were inferred from message histories
> because structured logging had failed during early runs. The DB may contain gaps, inferred
> values, or episodes whose metrics were backfilled rather than measured.

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| AUDIT1 | Identify runs/episodes with inferred vs. measured metrics | 🔴 | [ ] | Query `htn_benchmark_turns` for rows where `tokens_scout IS NULL OR tokens_scout = 0` — these were never properly logged. Separately check `htn_benchmark_episodes` for episodes with `llm_calls_total = 0`. Produce a table: arm → % of turns with missing token data, % with missing latency. |
| AUDIT2 | Identify DB rows backfilled from JSONL episode files | 🔴 | [ ] | Compare episode counts in DB (`htn_benchmark_episodes`) vs JSONL files in `tensornets/runs/run_*/arm_*/episodes/`. If DB has fewer rows than JSONL for any arm, those episodes were never inserted. If DB has more, there may be synthetic/duplicated rows. |
| AUDIT3 | Goal progress: delta vs current state | 🟠 | [ ] | **Item 10 from Aug plan.** Currently `goal_achieved` is binary (0/1 per episode). The reward function uses `goal_progress` as a turn-level scalar. Verify: is `goal_progress` measuring the *delta* in goal state this turn (correct — rewards incremental progress) or the *absolute* current goal state (wrong — rewards already-achieved goals, causes reward leakage)? Check `_synthetic_reward()` in `arms.py`. Document finding. |
| AUDIT4 | Exp 0 / 0a / 0p data leakage check | 🟠 | [ ] | **Item 10 cont.** Exp 0p outperforms Exp 0 by injecting richer context. But does the context include the *goal itself* or *prior episode outcomes*? If the context hint includes "patient achieved medication adherence goal last session" and the judge evaluates "did patient achieve medication adherence this session?", the system is using future-session outcomes as input. Verify `_build_dpo_prompt_vars()` and `getLongitudinalHint()` do not leak the current-episode goal into the generation prompt. |

---

## 15. 🟡 Distillation — Llama 17B on Earned Data

> **Context (item 11 from Aug upgrade plan):**
> We now have ~28k episodes across 24 arms. This is a non-trivial dataset of clinical companion
> interactions with associated reward signals, physiological trajectories, and judge scores.
> The question is whether to distil a smaller/specialised model from this data.

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| DIST1 | Assess dataset quality for distillation | 🟡 | [ ] | Filter episodes: keep only `goal_achieved=True` OR `judge_safety > 0.7` OR `cumulative_reward > 8`. Estimate: how many high-quality `(prompt, response)` pairs do we have per arm? Target: ≥ 2000 pairs for meaningful SFT. Query DB and report per-arm counts. |
| DIST2 | Define distillation objective | 🟡 | [ ] | Option A: supervised fine-tuning (SFT) on best-episode transcripts — teach a smaller model to generate therapeutic companion responses. Option B: reward-model distillation — fine-tune on `(prompt, reward)` pairs to produce a local judge. Option B is more valuable (reduces Bedrock judge dependency). Decide based on DIST1 counts. |
| DIST3 | Distillation pipeline (see `TODO_DISTILLATION.md`) | 🟡 | [ ] | Blocked on P0.5 (Ollama/Mistral), P0.6 (405B access). This is the Track D pipeline. |

---



> **Decision needed before distillation** — see `TODO_DISTILLATION.md`.

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| P0.5 | Confirm Mistral GGUF reuse vs HF download | ⚪ | [ ] | Run `ollama show mistral --modelfile`; check if weights reusable from `D:/hf_cache`. |
| P0.6 | Request Llama 3.1 405B access on Bedrock console | ⚪ | [ ] | Needed for full distillation benchmarks. Deferred. |
| P0.7 | Download WESAD dataset | ⚪ | [ ] | Free, no approval. https://ubicomp.eti.uni-siegen.de/home/datasets/icmi18/ |
| P0.8 | PhysioNet account for MIMIC-III/IV | ⚪ | [ ] | ~1 week approval. https://physionet.org |

---

## 13. ⚪ Phase 6 — Benchmarking (Section 5 of paper)

> Requires Phases 2–5 complete. H benchmarks that depend on distillation are in `TODO_DISTILLATION.md`.

| ID | Task | Priority | Status |
|----|------|----------|--------|
| H1–H7 | Paper section 5 benchmarks | ⚪ | [ ] |

---

## 14. 🟡 Product — Notifications & Communication

| ID | Task | Priority | Status |
|----|------|----------|--------|
| N1 | Notification abstraction layer (multi-channel) | 🟡 | [ ] |
| N2 | WhatsApp: Twilio provider | 🟡 | [ ] |
| N3 | WhatsApp: AISensy provider | 🟡 | [ ] |
| N4 | Template message management | 🟡 | [ ] |
| N5 | User notification preferences | 🟡 | [ ] |
| N6 | Push notifications (mobile/web) | 🟡 | [ ] |

---

## 15. 🟡 Product — RBAC

| ID | Task | Priority | Status | Notes |
|----|------|----------|--------|-------|
| RBAC1 | [x] DB schema (`system_roles`, `sessions`) | — | [x] | Done |
| RBAC2 | [x] Auth middleware + login/logout + password hashing | — | [x] | Done |
| RBAC3 | [x] Frontend login UI | — | [x] | Done |
| RBAC4 | Admin UI (user management) | 🟡 | [ ] | |
| RBAC5 | CLI login tool | 🟡 | [ ] | |

---

## 16. 🟡 Product — Data & State Architecture

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| DS1 | Bi-temporal fact tracking | 🟡 | [ ] | `reported_at` (transaction time) vs `valid_at` (event time). |
| DS2 | Veracity & subjectivity | 🟡 | [ ] | Confidence, source type (self-report vs external), sentiment evolution. |
| DS3 | Source attribution | 🟡 | [ ] | `reported_by` (User/Agent), `provenance` (original message ID). |
| DS4 | Privacy & access policy | 🟡 | [ ] | Visibility levels: circle-wide, private-to-doctor, patient-only. |
| DS5 | Importance scoring | 🟡 | [ ] | Weight facts by clinical/contextual significance. |
| DS6 | EMR & document storage | 🟡 | [ ] | S3/Blob + encryption, metadata indexing (patient ID, date, doctype). |

---

## 17. 🟡 Product — Security & Deployment

| ID | Task | Priority | Status |
|----|------|----------|--------|
| SEC1 | Input validation & sanitization (XSS/SQLi) | 🟡 | [ ] |
| SEC2 | API rate limiting | 🟡 | [ ] |
| SEC3 | Dependency vulnerability audit | 🟡 | [ ] |
| SEC4 | Production DB configuration (isolation from simulation DB) | 🟡 | [ ] |
| SEC5 | Logging & monitoring setup | 🟡 | [ ] |

---

## 18. ⚪ Product — Advanced Agent Capabilities

| ID | Task | Priority | Status |
|----|------|----------|--------|
| AAC1 | Multi-question pending action stack (v2) | ⚪ | [ ] |
| AAC2 | Self-reference resolution | ⚪ | [ ] |

---

## 19. ⚪ Open Research Questions

| # | Question | Status |
|---|----------|--------|
| Q1 | **Which layer to distill from?** Paper says "final layer" — ablation needed. | ⚪ Deferred to distillation track |
| Q2 | **Optimal χ?** Benchmark at χ ∈ {32, 64, 128, 256}. Run when E7 is done. | ⚪ |
| Q3 | **Right Δt?** Start at Δt = 1 turn. Sub-turn steps if PK/PD models require it. | ⚪ |
| Q4 | **Vocabulary mismatch Mistral vs Llama 3?** Decide before distillation. | ⚪ |
| Q5 | **1a–7a: should privacy guard also be disabled?** Currently `NoCritGate` ablations remove the critical failure gate but not the privacy guard. For a clean ablation, should 1a–7a also disable privacy filtering? Or add separate 1b–7b "NoPrivacy" slots? Decision needed before starting next run. | 🟠 |
| Q6 | **MPS leaf evaluator vs random rollout: is the value signal meaningful?** If `expectation_value(state, action_operator)` returns near-uniform scores (as Scout prior did), the MPS leaf evaluator provides no benefit over random rollout. Need a quick benchmark (MCTS1) before committing to this approach. | 🟠 |
| Q7 | **Goal progress: delta or absolute?** `_synthetic_reward()` computes `goal_r` — does it reward the *change* in goal state this turn (correct) or the absolute current goal state (reward leakage)? If absolute, Exp 0p's advantage may be partly spurious. AUDIT3 will answer this. | 🔴 |

---

## 20. ✅ Completed (recent)

| Item | Category | Date |
|------|----------|------|
| Per-line tooltip (nearest mode) + offset positioner (no cursor overlap) | Dashboard | Jun 2026 |
| Goal Rate 100-Episode Buckets chart | Dashboard | Jun 2026 |
| Recent Stats at top; Goal%(500) comparison; Y-zoom | Dashboard | Jun 2026 |
| Group filter buttons fixed (Base/Ablation/DPO re-render) | Dashboard | Jun 2026 |
| HPVOOT "Inertial" labels; Crit Fail % null fix; All Time stats uncapped | Dashboard | Jun 2026 |
| Bedrock hard-timeout via `ThreadPoolExecutor` in `node_client.py` | Reliability | Jun 2026 |
| Stall-detector self-restart via `os.execv` | Reliability | Jun 2026 |
| Historical-deficit-aware arm picker (90% hist / 10% run) | Reliability | Jun 2026 |
| Round-robin pool rebalancer replacing stop-on-gap logic | Reliability | Jun 2026 |
| 24-arm expansion: 8 base + 8 NoCritGate ablations + 8 DPO | Experiments | Jun 2026 |
| Critical failure tracking end-to-end (worker → DB → dashboard) | Experiments | Jun 2026 |
| Flooding sub-phase support in `_synthetic_reward` + `therapy/modes.py` | Experiments | Jun 2026 |
| DPO/RLAIF arms (Exp 0p–7p) + `_DPO_SYSTEM_PROMPT` + `_build_dpo_prompt_vars` | Experiments | Jun 2026 |
| OldschoolDPOWorker: `context_hint` → `extraContext` into JS pipeline | Experiments | Jun 2026 |
| `_safe_fmt` helper — silent fill for missing prompt keys | Code quality | Jun 2026 |
| Alliance state fixtures (200+ scenarios in `tensornets/state/alliances/`) | Training data | Jun 2026 |
| Watchdog script + internal stall detector | Reliability | Jun 2026 |
| TensorRAG index built (`clinical_kb.*`, `episode_memory.*`) | Research | Jun 2026 |
| Thompson Sampling bandit warm-up → A3C actor initialisation | Research | May 2026 |
| PhysiologicalHistory persistence to disk between server restarts | Research | May 2026 |
| BaseMCTS + DialogMCTS (UCB1, backprop, 13 ms latency) | Research | May 2026 |
| 67 passing tests (physio + core) | Research | May 2026 |
| Package scaffold, pyproject.toml, Bedrock + Ollama backends | Research | Apr 2026 |
| PhysiologicalState (8 signals), HRV→γ, non-Hermitian operators, MPS | Research | Apr 2026 |
| Hysteresis model, PK/PD models, individual reactivity profiles | Research | Apr 2026 |
| Therapeutic modes, longitudinal session state, MCTS comparison runner | Research | Apr 2026 |
| LLM-as-judge (6-dim rubric, DPO counterfactuals), DiscrepancyAudit | Research | Apr 2026 |
| Privacy layer (info classes I–IV, consent gates, disclosure advantage) | Product | Apr 2026 |
| RBAC: DB schema, auth middleware, login UI | Product | Mar 2026 |
