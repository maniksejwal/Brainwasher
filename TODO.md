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
| 4 | Experiment Design | 🔴 | 5 |
| 5 | Python Arm Improvements (post-run_027) | 🟠 | 7 |
| 6 | A3C Full Comparison Run (K1–K5) | 🟠 | 5 |
| 6b | A3C Feedback & Policy Quality | 🟠 | 5 |
| 7 | Phase 4 — Integration (G7, P-RAG) | 🟠 | 2 |
| 8 | Phase 4b — Partial Trace (PT1–PT6) | 🟠 | 6 |
| 9 | Social Alliance (SA1, SA2, SA3 dynamic) | 🟠 | 15 |
| 10 | MCTS Upgrades (MPS speed-up, Mtrunc, action-space) | 🟠 | 6 |
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
| **NEW** | **Dynamic Coupling (V_int)** | 🔴 | 4 |
| **NEW** | **Belief Graph** | 🔴 | 6 |
| **NEW** | **Stress Calibration (eustress / action-enabling)** | 🟠 | 3 |
| **NEW** | **Behavioural Defaults & Reflexes** | 🟠 | 4 |
| **NEW** | **Action Space Axes (internal/external, logic, reflex, inaction)** | 🔴 | 4 |
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
| EXP-RENAME | Rename ablation arms 1a–7a from `NoGate` → `NoCritGate` | 🔴 | [x] | **Done** — class names (`PhysioLLMNoCritGateWorker` etc.), ARM strings (`physio_llm_no_crit_gate` etc.), `EXP_META` dashboard labels, and `LEGACY_ALIAS` entries in `benchmarksDashboard.js` updated. Historical DB rows map correctly via alias. |
| EXP-RAG | New arms: Exp 8–11 RAG ablation set | 🟠 | [x] | **Done** — Exp 8 PlainRAG, Exp 9 ReasonRAG (LLM re-ranked, fixes longitudinal cosine problem), Exp 10 ReasonRAG+MPS-MCTS, Exp 11 ReasonRAG+InertialHPVOOT. Class names: `PlainRAGWorker`, `ReasonRAGWorker`, `ReasonRAGMPSMCTSWorker`, `ReasonRAGInertialHPVOOTWorker`. |
| EXP-VOOT | New arms: Exp 16 (ZoneHPVOOT, discrete affinity) and Exp 15 (MultiHorizonHPVOOT, MCTS9) | 🟠 | [x] | **Done** — `InertialHPVOOTZoneWorker` (Exp 16, idx 29): discrete hysteresis-zone cluster affinity for comparison vs continuous Exp 6. `MultiHorizonHPVOOTWorker` (Exp 15, idx 30): multi-horizon discounting (MICRO/SESSION/LONGITUDINAL gammas) + anticipatory anxiety bonuses via `_anticipatory_anxiety_bonus`. First arm with semantic naming convention. |
| EXP-GOT | New arm: Exp 17 — GoT-HPVOOT (Graph-of-Thought MCTS) | 🔴 | [x] | **Done** — `GoTHPVOOTWorker` (Exp 17, idx 31, `ARM="got_hpvoot"`): replaces flat "rate these actions" prior prompt with a structured 5-node Graph-of-Thought call (Node A: physio, B: conversation, C: temporal, D: cluster synthesis, E: action scoring), all in ONE Scout call. After MCTS runs with GoT priors, a second batch-leaf Scout call re-scores top-5 actions in one call. `_mcts_top5` now returned in all HPVOOT responses (wired via `base.py`). Total: 2 Scout calls vs 1 (Exp 6). Registered in `train.py`, `EXP_META` in dashboard updated. |
| EXP-RAG2 | New arms: DiverseRAG and ReasonRAG-HPVOOT-NoPhysio | 🟡 | [ ] | **DiverseRAG (Exp 12):** Instead of top-k by similarity, use Maximal Marginal Relevance (MMR) to select diverse chunks — avoids returning k variants of the same clinical approach. Formula: `λ·sim(q,d) − (1-λ)·max_j sim(d,d_j)`. Good when the clinical knowledge base has many redundant entries. **ReasonRAG-HPVOOT-NoPhysio (Exp 13):** HPVOOT without physio-state gating — instead uses reasoning confidence from the ReasonRAG pass as the UCB exploration bonus. Action selection is driven by *clinical relevance* rather than *physiological trajectory*. Tests whether the physio component adds value over pure reasoning-quality exploration. |
| EXP-NAMING | Adopt semantic arm naming for Exp 15+ (convention adopted, future arms to follow) | 🟡 | [~] | Convention: `GoTHPVOOTWorker`, `MultiHorizonHPVOOTWorker` etc. Apply retroactively to Exp 16 alias. Old class names kept as aliases for backwards-compat. |
| EXP-ABL-EXT | Extended ablations after run_027: no-longitudinal, no-hysteresis, no-physio, frozen-bandit | ⚪ | [ ] | **ABL-A** `physio_llm_no_longitudinal`: remove longitudinal hint — isolates cross-session memory value. **ABL-B** `physio_llm_no_hysteresis`: only instantaneous stress_index — isolates hysteresis extinction history. **ABL-C** `physio_llm_no_physio`: pure text companion with A3C policy — true floor. **ABL-D** frozen-bandit: freeze actor after warm-up — answers "how much does A3C add over Thompson Sampling?" |
| FB3 | Enable Exp 0 A3C learning (wire apply_update for OldschoolWorker) | 🟠 | [ ] | Currently `OldschoolWorker.generate_response` returns a reward and the base `A3CWorker.run_episode` calls `apply_update` — so A3C IS running. Verify rewards aren't all 0 (deferred=False path). If learning is flat, the issue is reward richness, not missing wiring. Add a `_DISABLE_LEARNING = False` class flag and confirm episode logs show non-zero actor updates. |
| SMOKE-RUN | Smoke test: 1 episode per arm across all 31 arms (run_028 sanity) | 🔴 | [ ] | Run `python -m tensornets.a3c.train --arms 1 2 3 ... 31 --episodes 1` to confirm all worker classes instantiate, serve a response, and log without error. Particular focus: GoTHPVOOTWorker (Exp 17), MultiHorizonHPVOOT (Exp 15), InertialHPVOOTZone (Exp 16). |

---

## 5. 🟠 Python Arm Improvements *(do not change prompts mid-run_027)*

> **Context:** Python arms 1–7 use a minimal `_DEFAULT_SYSTEM_PROMPT` with only `{hysteresis_ctx}` + `{action}`.
> The JS `PROMPT_ACTION_SELECTOR` has 12+ vars: stress level, HRV, zone, therapeutic_mode, session_goal,
> turns_completed, info_coverage, repetition_detected, last_action, conversation_history, known_context,
> longitudinal_hint, TensorRAG_context, pending_intervention.
> Exp 0 (JS) outperforms Python arms partly because its generator is richer, not purely better policy.

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| PA1 | Align base prompts with JS `PROMPT_ACTION_SELECTOR` | 🟠 | [x] | **Done** — `PhysioLLMWorker._DEFAULT_SYSTEM_PROMPT` now injects `therapeutic_mode`, `session_goal`, `turns_completed`, `info_coverage`, `last_action`, `repetition_detected`, `longitudinal_hint`, `known_context`, `available_actions` (stress-gated). `_build_longitudinal_hint()`, `_build_available_actions()`, `_build_known_context_block()` added as shared helpers. CoT prompt updated likewise. |
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
| RU1 | Expand scorer to 3 goal sub-dimensions (adherence, history, conversation) | 🟡 | [ ] | JS `ConversationAnalyzer` scores `goal_adherence` (medication/treatment adherence), `goal_history` (patient shared their history), `goal_conversation` (conversation goal met). Python collapses to one `goal_progress`. Add the three sub-scores to `scorer.py` prompt and `TurnScoreResult`, and weight them in `map_scorer_to_reward_dims`. Each sub-score is still a per-turn delta (trend direction) not absolute state. |

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
| SA1.1 | Add `DirectMessageEvent` dataclass to `agents/social_alliance.py` | 🟠 | [x] | **Done**: `DirectMessageEvent` dataclass with `sender_role`, `receiver_role`, `topic`, `valence` [-1,+1], `sender_stress`, `receiver_stress`, `vent_occurred`, `timestamp`, `session_id`. |
| SA1.2 | Add `AllianceGraph.update_from_direct_message(event)` with vent-delta support; separate `direct_rapport` and `perceived_rapport` fields on `AllianceEdge` | 🟠 | [x] | **Done**: `update_from_direct_message()` updates `direct_rapport`, computes `vent_delta = direct_rapport - perceived_rapport`. Auto-flags `no_go_zones` when `abs(vent_delta) > 0.20`. `AllianceEdge` carries `direct_rapport`, `perceived_rapport`, `vent_delta` fields. |
| SA1.3 | Add `vent_delta` to `AllianceEdge`: tracks divergence between direct behaviour vs. companion-relayed perception | 🟠 | [x] | **Done** (part of SA1.2). |
| SA1.4 | Wire `direct_message` stress_proxy into `V_int / SharedTensorBuffer` at episode start | 🟠 | [ ] |
| SA1.5 | Add `relay_channel` turn type to `CareCircleOrchestrator` (training-only): direct turns skip companion generation, update only graph + V_int | 🟠 | [ ] |
| SA1.6 | `prompt_context_for()` upgrade: include vent-delta hint ("patient speaks positively of daughter directly but vented frustration in prior session") | 🟠 | [x] | **Done**: vent-delta block added to `prompt_context_for()`. Shows warning when `abs(vent_delta) > 0.15` and lists direct-channel no-go zones. |
| SA1.7 | Benchmark: multi-person scenarios with direct channel events vs. companion-only baseline. Metric: alliance trajectory + goal rate across chained episodes | 🟠 | [ ] |

### SA2 — Co-regulation and Contagion Coupling

> Currently per-participant inertia has no social coupling. In real negotiation, one person's calm
> actively calms others (parasympathetic co-regulation). Fear/panic spreads faster than calm
> (negative emotional contagion asymmetry, empirically supported).

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| SA2.1 | `social_Gamma_modifier(alliance_score, speaker_stress) → Δγ` | 🟠 | [x] | **Done** — `social_Gamma_modifier` added to `social_alliance.py`. `alliance_score` and `companion_stress` fields added to `TurnState`. All `_stress_after_response` call-sites in HPVOOT/LLM arms pass `state.alliance_score` + `state.companion_stress`. Range: Δγ ≈ [-0.15, +0.25] at extreme alliance and panic. |
| SA2.2 | Contagion asymmetry: negative HRV deltas propagate at 1.5× rate vs positive | 🟠 | [x] | **Done (wired)** — `AllianceEdge.stress_contagion_delta()` already implements 1.5× asymmetry. `AllianceGraph.propagate_stress_contagion()` uses it. `PhysioSimulator.step()` now accepts `social_gamma` kwarg. Full E2E wire pending SA3.4. |
| SA2.3 | MCTS action `await_co_regulation` | 🟠 | [x] | **Done** — Added to `ACTION_TAXONOMY` (77 total), `CALMING_WEIGHT`=0.80, `ACTION_INTENT_GROUP`=`deescalate`. Selection rule: ONLY when both participants in zone 3+ (V_int). Description in `action_selector.js`. |
| SA2.4 | Wire SA2.1 into `PhysioSimulator.step()` via `ReactivityProfile.gamma_modifier()` | 🟠 | [x] | **Done** — `PhysioSimulator.step()` now takes `social_gamma: float = 0.0`. Uses `effective_theta = max(0.02, theta - social_gamma)` so alliance quality scales the OU reversion speed. Verified: bonded σ=0.6356 < neutral σ=0.6392 < ruptured σ=0.6428 for same calming action. |

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
| SA3.5 | Panic+withdrawal contagion scenario: de-escalate BOTH parties and schedule future interaction | 🟠 | [ ] | When one party panics/withdraws, forcing conversation forward harms both. Required sequence: (1) `acknowledge_and_pause` + `defer_and_schedule` for the primary participant, (2) `check_on_caregiver` if caregiver is also stressed (V_ij propagation detected), (3) `schedule_future_interaction` — propose concrete future moment (e.g. "dinner on Saturday"), (4) `coordinate_companion_handoff` — signal peer companions to re-raise topic at scheduled time. The A3CScorer should reward this sequence at HIGH+CRITICAL stress instead of continued therapeutic confrontation. Add `escalation_expected=False` + `deescalate_expected=True` scenario flag to inform the scorer. |
| SA3.6 | Future interaction orchestration in CareCircleOrchestrator | 🟡 | [ ] | Companions can proactively scaffold future conversations across the care circle: `schedule_future_interaction` proposes a time, `coordinate_companion_handoff` signals all peer companions. The orchestrator stores a `pending_future_interaction` object with `{proposed_time, topic, participants, originating_companion}` that peer companions receive at episode start as part of `longitudinal_hint`. |
| EMERGENCY-ACTIONS | Emergency response actions in action taxonomy | 🔴 | [x] | **Done** — `emergency_mobilise`, `witness_grief`, `safety_exit_protocol` added (75 total actions). Group = `emergency`. Rule 0 override in `action_selector.js` covers stroke/cardiac/accident/death/threat. Reward: +0.30 bonus when acute-emergency tokens present; -0.25 penalty if applied without cause. A3CScorer gap: `emergency_correctly_escalated` scorer dimension still needed (add as `RU2`). |
| RU2 | A3CScorer: add `emergency_correctly_escalated` dimension | 🟠 | [ ] | When a scenario has `emergency_type` set (stroke, cardiac, threat, grief), the scorer should evaluate whether the companion correctly suspended therapeutic goals and routed to the right emergency protocol. Binary reward: 1.0 if `emergency_mobilise` / `witness_grief` / `safety_exit_protocol` selected appropriately; 0.0 if therapeutic actions were chosen instead. Requires a new `emergency_type` field in scenario metadata. |
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
| MCTS3 | Expand action space: panic-specific psychoeducation cluster | 🟠 | [x] | **Done** — ACTION_TAXONOMY now has 67 actions including full panic cluster (6 actions) + social coordination (8 actions). Intent-based descriptions in `prompts/action_selector.js`; `panic_safety_assess_faint` added. |
| MCTS4 | Progressive lookahead depth tied to episode count | 🟡 | [ ] | Already partially implemented as `progressive_lookahead()` in `arms.py` but not fully activated. Confirm it ramps from depth 4 → 12 over first 500 episodes per arm. Log current depth per episode to DB (`mcts_depth` column in `htn_benchmark_episodes`). |
| MCTS5 | HPVOOT prior quality fix (session context in prior call) | 🟠 | [x] | **Done** — L2 fix (last 2 patient turns + session goal in prior prompt) was already applied. L3 fix (VOOT_C_VAR 0.8→0.4) was already applied. Now also wired `gamma_eff` + `session_boundary` into `MCTSActionIn` in `server.py`; `exploration_c` scales as `1.0 + (1.0 − γ_eff)` so post-gap episodes explore more. |
| MCTS6 | Temporal-gap awareness for MCTS across sessions | 🟠 | [x] | **Done** — (1) `session_gap_days`, `session_boundary`, `elapsed_since_last_s` added to `TurnState`. (2) `drift_physio_for_gap()` exponential decay (λ=0.20, half-life≈3.5d) applied in `from_scenario` when gap>0. (3) `_session_boundary_gate()` suppresses flooding/socratic/discrepancy on first turn. (4) `_temporal_gamma()` scales HPVOOT γ as `γ_base×exp(−gap/τ)` — sent in MCTS bridge payload. (5) `progressive_lookahead()` halves depth at boundary. (6) `goal_reassess` action added (76 total); promoted to front of available list at boundary; reward bonus +0.15. Rule 8b added to `action_selector.js`. |
| MCTS7 | MCTS+RAG: episode-memory prior for HPVOOT | 🟡 | [ ] | Before the MCTS search, retrieve top-k most similar past episodes from `episode_memory.index` (existing RAG index). Pass as few-shot examples to `_fetch_prior_scores()` so Scout scores actions based on "what worked in similar situations" not just "what sounds calming". This gives empirically-grounded priors. Expected effect: fix the near-uniform prior problem more robustly than L2 alone. Implement as new Exp 14: `EpisodeRAGHPVOOTWorker`. |
| MCTS8 | PTSD-aware physio baseline and action gating | 🟡 | [ ] | PTSD breaks three assumptions: (1) Baseline HRV is 20-35ms lower (resting attractor ≈ 25-35ms, not 55ms); `drift_physio_for_gap()` must use subject-specific baseline from `facts_v2`. (2) Zone transitions can be instantaneous (intrusive memory triggers); the stress_discrepancy signal already captures this — wire into action-cluster priority boost. (3) `flooding_deepen` MUST be gated behind `ptsd_safe_protocol=True` scenario flag — never auto-fired. Add `ptsd_profile` to scenario metadata and `ReactivityProfile`. |
| MCTS9 | Multi-horizon discounting within a single MCTS | 🟡 | [x] | **Done (Exp 15)**: `MultiHorizonHPVOOTWorker` (ARM=`multi_horizon_hpvoot`, idx 30). `ActionHorizon` enum (MICRO/SESSION/LONGITUDINAL) in `action_bandit.py`. `ACTION_HORIZON_GAMMA` dict (0.95/0.70/0.40). `MultiHorizonHPVOOTMCTS` in `hierarchical_pw_voot.py` scales each action's backpropagated value by `gamma_ratio`. Also adds `_anticipatory_anxiety_bonus`: routes tree toward `time_bracketing`, `uncertainty_tolerance`, `probability_reframe`, `graded_imagery` when scenario carries `pending_event`. 3 new scenarios in `scenario_loader.py` (exam, diagnosis-wait, job-threat). Rule 13 in `action_selector.js`. First arm to use the new semantic naming convention. |
| CONSIST1 | Credibility-weighted state: detect inter-state contradictions | 🟡 | [ ] | **Actions added** (done): `seek_probe_consent` and `normalise_discrepancy` added to `ACTION_TAXONOMY`, `CALMING_WEIGHT`, `ACTION_INTENT_GROUP`, `action_selector.js` (with Rule 12: CONSISTENCY rule). Reward logic wired in `_synthetic_reward`. **Remaining**: (1) Add `statement_log` to episode memory. (2) `CredibilityModel.check()` retrieves past statements via RAG, computes contradiction score. (3) Wire `contradiction_score` into `stress_discrepancy` and MCTS action priority. (4) A3CScorer dimension `consistency_explored`. Implement alongside MCTS7 as `CredibilityAwareHPVOOTWorker`. |
| PREF1 | Per-person response style preferences | 🟡 | [ ] | No preference model exists. Needed: `ResponseStyleProfile` in `facts_v2`/scenario with `{verbosity: brief\|moderate\|detailed, tone: clinical\|warm\|peer, directiveness: directive\|nondirective}`. Wire into Scout generation prompt (not action selection). A3CScorer gets `style_match` dimension. Style profile persists in `session_memory`. |
| AUDIT1 | Resolve stub implementations documented in code audit | 🟠 | [ ] | **AUDIT1-3 DONE**: `conversation_stress` + `stress_discrepancy` now in `MCTSActionIn` and wired into `_rollout_action` discrepancy penalty. **Remaining**: (1) `M_trunc`/`project_constraint` — implement or remove claim. (2) `alliance_score` default 0.5 — need one arm to read real AllianceGraph. (3) `partial_trace_physio()` docstring honesty. (4) `AllianceGraph.V_ij` persistence. |
| EXP-VOOT | VOOT comparison experiment arms | 🟠 | [x] | **Done**: `InertialHPVOOTZoneWorker` (Exp 16, idx 29) added. Uses `mcts_mode="hpvoot_zone"` via instance-level `_mcts_mode_override`; parent's `getattr(self, "_mcts_mode_override", "hpvoot")` picks it up. Dashboard entry added (`inertial_hpvoot_zone`). **Remaining**: run Exp 6 vs Exp 16 side-by-side; compare cluster selection distributions at stress=0.4 and stress=0.8. |
| EXP-LLMMCTS | LLM-based MCTS reasoning arm | 🟡 | [ ] | Currently MCTS leaf evaluation is a dict lookup (13 actions, heuristic). Two approaches to add reasoning: (A) **CoT-at-root**: before running MCTS, ask Scout "given this physio state and the top 3 candidate actions, rank them and give a score" — use as `llm_prior_scores`. This is essentially what existing CoT arms do. (B) **LLM-at-leaf**: each `_rollout_action` calls Scout with a 1-line prompt — expensive (150 LLM calls per turn) but captures semantics. (A) is already implemented (CoT arms). (B) is a new arm: `ReasonMCTSWorker` (Exp 17). Estimate: ~15× more expensive than CoT-at-root. Ablation: does LLM-at-leaf add value over CoT-at-root? |
| EXP-REASON-ZONE | ReasonRAG + Zone HPVOOT arm | 🟡 | [ ] | We have Exp 11 (ReasonRAG + continuous HPVOOT). Missing combo: `ReasonZoneHPVOOTWorker` (Exp 18) — uses `mcts_mode="hpvoot_zone"` + ReasonRAG retrieval. Answers: does discrete-zone affinity combine with reasoning-reranked RAG differently than continuous? One-line subclass of `ReasonRAGInertialHPVOOTWorker` patching `_mcts_mode_override`. |
| EXP-NAMING | Adopt semantic arm naming for Exp 15+ | 🟢 | [~] | **Convention adopted**: Exp 15 (`MultiHorizonHPVOOTWorker`) uses semantic names. Exp 16 (`InertialHPVOOTZoneWorker`) is transitional. Future arms should use pattern: `{capability}{architecture}{variant}` — e.g. `ReasonMCTSWorker`, `ReasonZoneHPVOOTWorker`, `DistillHPVOOTWorker`. Old classes kept for backward compat via `LEGACY_ALIAS`. |
| ADV-SCENARIOS | Adversarial/failure scenario corpus | 🟠 | [x] | **Done**: 3 scenarios in `scenario_loader.py`: (1) `conflict_escalation` — both users resist companion, stress forces `meta/emergency`; (2) `health_deterioration` — HRV falls 3ms/turn, EDA rises, discrepancy grows; (3) `inverse_hrv` — patient says calm but HRV falls (vasovagal). `load_adversarial_scenarios()` and `load_all_scenarios()` available. `physio_deterioration_per_turn` wired in `worker.py` turn loop (applied to `next_state.physio` before `state = next_state`). **Remaining**: wire into curriculum scheduler at 5% base rate. |

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
| Q7 | **Goal progress: delta or absolute?** `_synthetic_reward()` computes `goal_r` — does it reward the *change* in goal state this turn (correct) or the absolute current goal state (reward leakage)? If absolute, Exp 0p's advantage may be partly spurious. AUDIT3 will answer this. **Status: audited.** When the A3CScorer runs (even turns), `goal_progress` comes from `scorer_reward_dims["goal_progress"]` which is the scorer's per-turn LLM delta (+2→+1→0→-1→-2), not absolute. On odd turns (heuristic carry), `arm_reward_dims["goal_progress"]` (action-taxonomy lookup) is used — this IS an instantaneous delta by action type, not absolute `info_coverage`. **No leakage confirmed.** Remaining gap: the JS ConversationAnalyzer has three goal sub-dimensions (adherence, history, conversation) while Python collapses to one. Adding them requires scorer prompt expansion. Track as RU1 below. | 🟡 |

---

## NEW-A. 🔴 Dynamic Coupling (V_int / V_ij)

> **Context**: `V_ij` coupling weights in `SharedTensorBuffer` are static priors set at startup.
> Emotional coupling strength is not a constant — it is dynamic, context-dependent, and
> bidirectional. The research literature shows that *both extremes are problematic*:
> very high coupling (enmeshment) amplifies distress bidirectionally and locks both parties
> into maladaptive patterns; very low coupling (detachment/isolation) means one party's
> crisis cannot reach the companion caring for the other.
> The companion's advice strategy must be *aware of and adaptive to* the current coupling level.

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| COUP1 | Make V_ij session-dynamic (already tracked in SA3.1; extend) | 🔴 | [ ] | **How**: at each session start, compute `coupling_estimate` from recent `vent_delta`, `stress_discrepancy`, and `conversation_stress` cross-correlation between the two parties (from `SharedTensorBuffer`). Store as `effective_V_ij` per pair per session. Decay toward prior between sessions (EWA with τ = 3 sessions). Update immediately when a `DirectMessageEvent` with `valence < -0.5` arrives (conflict signal). Wire `effective_V_ij` into `MCTSActionIn` payload as `coupling_strength: float`. |
| COUP2 | Coupling level classifier → companion strategy switch | 🔴 | [ ] | **How**: add `CouplingRegime` enum: `ISOLATED` (V_ij < 0.2), `HEALTHY` (0.2–0.7), `ENMESHED` (> 0.7). In `generate_response`, detect regime. For `ENMESHED`: suppress `explore_past_trauma`, `flooding_deepen`, `emotional_validation` (risk of amplification); promote `differentiation_prompt`, `individual_space`, `boundary_assertion`. For `ISOLATED`: suppress `individual_coping`; promote `shared_goal_setting`, `mutual_acknowledgement`, `coordinate_companion_handoff`. Add 4 new actions: `differentiation_prompt`, `individual_space`, `boundary_assertion`, `mutual_acknowledgement`. |
| COUP3 | Environment / belief remodelling when coupling is extreme | 🟠 | [ ] | **How**: if `ENMESHED` for ≥ 2 consecutive sessions, flag `belief_enmeshment_risk=True` in `AllianceEdge`. Companion should begin a structured differentiation sequence: (1) acknowledge shared bond, (2) surface one belief held by both that may be co-constructed rather than individual (belief_graph intersection), (3) introduce `probability_reframe` for that belief. If `ISOLATED` for ≥ 2 sessions, flag `isolation_risk=True`; recommend care-circle session or in-person check with `schedule_future_interaction`. A3CScorer: reward differentiation when `enmeshment_risk=True`; reward bridge-building when `isolation_risk=True`. |
| COUP4 | Asymmetric coupling: panic contagion threshold | 🟠 | [ ] | **How**: SA2.2 already codes negative HRV delta at 1.5× propagation rate. Extend: add `panic_contagion_threshold` (V_ij × stress_sender). If threshold exceeded, companion receives `PANIC_CONTAGION_ALERT` in TurnState and must suspend current therapeutic arc to first ground the receiving party. New action: `ground_before_continue`. Scenario: add `two_person_panic` to scenario corpus (SA3.3 prerequisite). |

---

## NEW-B. 🔴 Belief Graph

> **Context**: the companion currently operates on *disclosed facts* (from `facts_v2`) and
> *physiological state*. But human behaviour is governed by *beliefs* — stable cognitive
> structures that mediate between events and reactions. A belief graph maps beliefs as nodes
> with directed dependency edges ("I can't cope → I am weak → I don't deserve help").
> Foundational beliefs (high in-degree, identity-linked) are resistant to direct challenge
> and can backfire catastrophically if targeted prematurely. Peripheral beliefs (low in-degree,
> situation-specific) can be changed with less risk and can progressively destabilise
> foundational ones through cascade effects.

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| BG1 | `BeliefGraph` data structure | 🔴 | [ ] | **How**: create `tensornets/agents/belief_graph.py`. `BeliefNode`: `{id, text, confidence: 0–1, valence: -1/0/+1, moral_weight: 0–1, identity_linked: bool, temporal_focus: ST/LT/BOTH, source: "stated/inferred/extrapolated"}`. `BeliefEdge`: `{from_id, to_id, relation: "supports/contradicts/requires/undermines", strength: 0–1}`. `BeliefGraph`: dict of nodes + adjacency list. Persist as JSON alongside `AllianceGraph` in `state/subjects/{id}/`. |
| BG2 | Belief discovery pipeline from conversation | 🔴 | [ ] | **How**: after each turn, send the patient's utterance + last belief summary to Scout with prompt: "Extract any explicit or implied beliefs from this statement. Format: [{text, confidence, valence, identity_linked}]. Return [] if none." Parse and upsert into `BeliefGraph`. Run on Scout (not Maverick) — cost: 1 extra call every 3 turns (sampled). Conflicting beliefs are `BeliefEdge(relation="contradicts")`. Consistent re-assertions increment `confidence`. |
| BG3 | Belief salience and risk classifier | 🔴 | [ ] | **How**: `BeliefGraph.foundational_beliefs()` — return nodes where `in_degree ≥ 3` OR `identity_linked=True` OR `moral_weight > 0.7`. `BeliefGraph.safe_to_challenge(node_id)` returns `True` when: `in_degree ≤ 1`, `identity_linked=False`, `confidence < 0.6`. Inject into Scout system prompt via `prompt_context_for()`: "SAFE TO EXPLORE: {safe_beliefs[:3]}. AVOID DIRECT CHALLENGE: {risky_beliefs[:2]}." |
| BG4 | Belief interpolation — cascade via peripheral nodes | 🟠 | [ ] | **How**: when `normalise_discrepancy` or `probability_reframe` succeeds (A3CScorer marks `belief_shift=True`), identify all beliefs with an edge to the challenged belief. Reduce their `confidence` by `0.05 × edge_strength`. If a foundational belief's confidence drops below 0.4, flag `belief_ready_for_revisit=True` in next session's `longitudinal_hint`. This models therapeutic change as belief cascade, not direct assault. |
| BG5 | Belief–action mapping: which action targets which belief layer | 🟠 | [ ] | **How**: in `action_bandit.py`, add `ACTION_BELIEF_TARGET: dict[str, str]` — maps actions to belief layers they primarily engage: `"peripheral"`, `"relational"`, `"foundational"`, `"none"`. MCTS prior call (`_fetch_prior_scores`) gets belief context: "Current safe-to-challenge beliefs: {safe_beliefs}. Preferred layer: peripheral." GoT Node D cluster synthesis now includes a `belief_layer` field. |
| BG6 | BeliefGraph arm (new experiment) | 🟡 | [ ] | **How**: `BeliefGraphHPVOOTWorker` (Exp 19) — subclass of `GoTHPVOOTWorker`. Overrides `generate_response` to: (1) load `BeliefGraph` for subject, (2) inject safe/risky beliefs into GoT prompt Node B, (3) run GoT-HPVOOT as normal. Ablation vs Exp 17: does belief-aware prior improve goal rate? Requires BG1–BG3. |

---

## NEW-C. 🟠 Stress Calibration (eustress / action-enabling stress)

> **Context**: the current reward function (`_synthetic_reward`) and MCTS heuristics always
> treat stress reduction as the goal. But stress is not uniformly bad — moderate acute stress
> (eustress) enables action, facilitates difficult decisions, creates memory consolidation, and
> drives behaviour change. A companion that *always* de-escalates will produce passivity: the
> patient never makes the hard phone call, never confronts the avoidance behaviour, never
> crosses the uncomfortable threshold. The companion needs to *calibrate* stress — reducing
> it when it's paralysing or harmful, and *preserving or mildly amplifying* it when it's
> enabling.

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| SC1 | Optimal stress window per archetype/context | 🟠 | [ ] | **How**: define `OPTIMAL_STRESS_RANGE: dict[str, tuple[float,float]]` in `physio_simulator.py` — maps `(archetype, scenario_phase)` to `(min_stress, max_stress)`. Examples: `("avoidant", "action_taking") → (0.40, 0.65)`, `("catastrophiser", "any") → (0.10, 0.35)`. In `_synthetic_reward`, add `stress_calibration_r`: +0.05 bonus if final stress is within the window, -0.05 penalty if over-reduced (patient brought below minimum action threshold). |
| SC2 | New action: `increase_salience` / `temporal_urgency` | 🟠 | [ ] | **How**: add 2 actions to `ACTION_TAXONOMY`: `increase_salience` (make the cost of inaction tangible — "what happens in 6 months if nothing changes?") and `temporal_urgency` (introduce time pressure — "you said the appointment is next week"). `CALMING_WEIGHT`: 0.0 (these raise stress). `ACTION_HORIZON`: SESSION. Gate: only available when `stress_index < OPTIMAL_STRESS_RANGE[archetype].min`. Add Rule 14 to `action_selector.js`: "If patient is below action threshold and goal requires decision, use increase_salience or temporal_urgency." |
| SC3 | A3CScorer: reward deliberate action completion, not just stress reduction | 🟠 | [ ] | **How**: add `action_completion` dimension to scorer prompt: "Did the patient commit to or complete a specific action this turn (e.g. agreed to call the doctor, scheduled an appointment, set a boundary)? Score 0–1." Include alongside `goal_progress` in reward computation. Weight: 0.15 (same as `safety`). This prevents A3C from learning that the optimal policy is to always validate and calm. |

---

## NEW-D. 🟠 Behavioural Defaults, Habits & Reflexes

> **Context**: under stress, people revert to automatic behaviours — habits, conditioned
> reflexes, social defaults, and practiced responses — that bypass deliberate reasoning.
> These override rational argument. A companion that reasons with a patient who is in
> *reflex mode* is ineffective: the patient is not processing via System 2. The companion
> needs to (1) detect when the patient is in reflex vs. deliberated mode, (2) match the
> intervention to the mode (interrupt-and-ground for reflexes; explore-and-reason for
> deliberation), and (3) pre-commit strategies that reroute reflexes before they fire.

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| BD1 | `BehaviorProfile`: catalog known reflexes, defaults, habits per user | 🟠 | [ ] | **How**: add `behavior_profile: dict` to `facts_v2`/scenario metadata. Schema: `{reflexes: ["flee", "fawn", "freeze", "fight"], defaults: ["minimise", "overexplain", "shut_down"], habits: [{cue, routine, reward}], practiced: ["deep_breathing", "prayer", "smoking"]}`. Populated by A3CScorer dimension `behavior_type_detected` ("reflex/default/deliberated/unknown"). Companion reads this from `_build_longitudinal_hint`. |
| BD2 | Reflex detection in conversation | 🟠 | [ ] | **How**: add `reflex_detected: bool` to `TurnState`. Set when `stress_index > 0.7` AND (`stress_discrepancy > 0.25` OR last utterance matches reflex-language patterns: short sentences, repetition, past-tense self-reference like "I always do this", "I can't help it"). When `reflex_detected=True`, MCTS should suppress `challenge_belief`, `socratic_probe`, `flooding_deepen`; promote `ground_before_continue`, `acknowledge_and_pause`, `breathing_4_7_8`. |
| BD3 | Pre-commitment actions for reflex override | 🟠 | [ ] | **How**: add `precommit_strategy` action (available only when stress is LOW and patient is in deliberated mode). Action intent: "establish a concrete if-then rule before the patient re-enters a triggering context." ("If you feel the urge to leave the conversation, you've agreed to say one thing first — what will that be?"). Reward bonus +0.10 when `precommit_strategy` is followed by successful avoidance of a known reflex in a subsequent turn. |
| BD4 | Habit loop modeling: cue-routine-reward | 🟡 | [ ] | **How**: add `HabitLoop` to `BeliefGraph` (or separate structure) — `{cue: str, routine: str, reward_belief: str}`. Example: `{cue: "conflict at home", routine: "withdrawal", reward_belief: "I avoid more pain"}`. Companion can then target the `reward_belief` (peripheral, often malleable) rather than the routine directly. This links to BG3 (safe-to-challenge). New action: `reframe_habit_reward` — disputes the reward belief without attacking the cue or routine. |

---

## NEW-E. 🔴 Action Space Axes

> **Context**: the current action taxonomy is a flat list of 76 actions grouped by intent
> cluster. But the *axes of variation* that matter clinically are not captured as searchable
> dimensions. Four axes are particularly important:
>
> 1. **Internal vs External** — is the action targeting the patient's internal state
>    (belief, physio, affect) or the external world (relationships, events, environment)?
> 2. **Logic vs Counterintuitive** — most actions are rational; but some situations call
>    for paradoxical interventions (prescribe the symptom, reverse-validate, strategic
>    ambiguity). Counterintuitive actions are high-risk/high-reward and need gating.
> 3. **Deliberated vs Reflexive** — does the action engage slow/deliberate thinking or
>    leverage fast/intuitive cognition? When a patient is in reflex mode, deliberated
>    actions are wasted.
> 4. **Inaction vs Action** — "wait", "hold space", "freeze-with-them" are valid
>    therapeutic moves. The current taxonomy has no pure inaction actions. Inaction can
>    prevent iatrogenic harm (a companion that "does something" during a grief moment
>    is often worse than one that witnesses silently).

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| AS1 | Internal/External axis: tag all actions | 🔴 | [ ] | **How**: add `ACTION_AXIS_IE: dict[str, str]` in `action_bandit.py` — maps each action to `"internal"`, `"external"`, or `"both"`. Examples: `breathing_4_7_8 → internal`, `coordinate_companion_handoff → external`, `schedule_future_interaction → external`, `reframe_situation → both`. In MCTS prior call, inject "Current axis needed: {axis}" derived from scenario `focus_axis` field (new). GoT Node D cluster synthesis emits a `focus_axis` field. Enables scenario-level ablations: internal-only vs external-only companion modes. |
| AS2 | Logic/Counterintuitive axis: paradoxical interventions | 🔴 | [ ] | **How**: add 3 new actions: `prescribe_symptom` (intentionally tell patient to do the maladaptive thing for a controlled period — paradoxical intention, Frankl), `strategic_ambiguity` (deliberately withhold interpretation to allow the patient to fill in meaning), `reverse_validate` (validate the opposing belief to surface ambivalence). All tagged `logic_axis="counterintuitive"`. Gate: ONLY available when `stress_index < 0.40` (low stress = System 2 accessible) AND `session_count ≥ 3` (established alliance). Reward: +0.15 if `belief_shift` detected on next turn; -0.20 if `critical_failure` triggered. Rule 15 in `action_selector.js`: "Paradoxical interventions require low stress and established rapport. Never use in crisis." |
| AS3 | Deliberated/Reflexive axis: mode-matched intervention selection | 🔴 | [ ] | **How**: wire `reflex_detected` (from BD2) into GoT Node B as `patient_mode: "reflex/deliberated"`. Add `ACTION_AXIS_DR: dict[str, str]` — maps actions to `"deliberated"`, `"reflexive"`, `"both"`. Deliberated actions (socratic, reframe, explore) are blocked when `reflex_detected=True`. Reflexive-compatible actions (ground_before_continue, acknowledge_and_pause, breathing_4_7_8, witness_grief) are promoted. This is the most important axis for crisis safety. |
| AS4 | Inaction axis: silence, witnessing, holding space | 🔴 | [ ] | **How**: add 4 new actions: `hold_space` (pure witness — companion generates a minimal, non-directive acknowledgement: "I'm here with you"), `therapeutic_silence` (companion sends nothing — signals patient can take time), `await_readiness` (explicit "I'll wait until you feel ready to continue"), `pause_and_breathe_together` (shared physiological regulation without content). All tagged `action_axis="inaction"`. Reward: in grief/shock scenarios (`scenario_type in ["witness_grief", "health_deterioration"]`), inaction actions get +0.12 bonus (currently penalised by low `goal_progress`). A3CScorer new dimension `appropriate_inaction` — was silence clinically appropriate here? |

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
