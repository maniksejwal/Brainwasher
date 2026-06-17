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
| 7 | Phase 4 — Integration (G7, P-RAG) | 🟠 | 2 |
| 8 | Phase 4b — Partial Trace (PT1–PT6) | 🟠 | 6 |
| 9 | Social Alliance (SA1, SA2) | 🟠 | 11 |
| 10 | Phase 3 — MCTS Latency (F5) | 🟡 | 1 |
| 11 | Physiological Subspace (C/B tracks) | 🟡 | 8 |
| 12 | Phase 0 — Data Sourcing | ⚪ | 4 |
| 13 | Phase 6 — Benchmarking (H1–H7) | ⚪ | 1 |
| 14 | Product — Notifications | 🟡 | 6 |
| 15 | Product — RBAC | 🟡 | 2 |
| 16 | Product — Data & State Architecture | 🟡 | 6 |
| 17 | Product — Security & Deployment | 🟡 | 5 |
| 18 | Product — Advanced Agent Capabilities | ⚪ | 2 |
| 19 | Open Research Questions | ⚪ | 4 |
| 20 | Completed (recent) | — | — |

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

## 7. 🟠 Phase 4 — Integration Gaps

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

---

## 10. 🟡 Phase 3 — MCTS Latency

| ID | Task | Priority | Status | Details |
|----|------|----------|--------|---------|
| F5 | Latency test: MCTS background + generation foreground < 200 ms TTFT | 🟡 | [ ] | Current smoke test: 13.9 ms for 120 iterations / depth 4 — well within budget. Formal test still needed for paper. |

---

## 11. 🟡 Physiological Subspace (Track C/B)

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

## 12. ⚪ Phase 0 — Data Sourcing

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
