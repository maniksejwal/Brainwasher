# Brainwasher 3 — Master TODO

> **Source-of-truth guide:**  This file is the single consolidated tracker for all work streams.
> `tensornets/TODO.md` is the detailed PhD research scratchpad (phase-gated items, proofs, benchmarks).
> `documentation/tensornets/A3C_COMPARISON_DESIGN.md` holds the live experiment register and results table.
> Status: `[ ]` pending · `[~]` in progress · `[x]` done · `[!]` blocked
> Priority: 🔴 Now · 🟠 Soon · 🟡 Later · ⚪ Deferred

---

## Contents


| #       | Section                                                            | Priority | Open items   |
| ------- | ------------------------------------------------------------------ | -------- | ------------ |
| **S1**  | **🔴 Current Sprint — Belief, Identity, Coupling**                 | 🔴       | 8            |
| 1       | Training (run_027)                                 | 🟠       | 2            |
| 2       | Dashboard                                          | 🔴       | 0 (all done) |
| 3       | Training Reliability                               | 🔴       | 0 (all done) |
| 4       | Experiment Design                                                  | 🔴       | 6            |
| 5       | Python Arm Improvements (post-run_027)                             | 🟠       | 7            |
| 6       | A3C Full Comparison Run (K1–K5)                                    | 🟠       | 5            |
| 6b      | A3C Feedback & Policy Quality                                      | 🟠       | 5            |
| 7       | Phase 4 — Integration (G7, P-RAG)                                  | 🟠       | 2            |
| 8       | Phase 4b — Partial Trace (PT1–PT6)                                 | 🟠       | 6            |
| 9       | Social Alliance (SA1, SA2, SA3 dynamic)                            | 🟠       | 15           |
| 10      | MCTS Upgrades (MPS speed-up, Mtrunc, action-space)                 | 🟠       | 6            |
| 11      | Phase 3 — MCTS Latency (F5)                                        | 🟡       | 1            |
| 12      | Physiological Subspace (C/B tracks)                                | 🟡       | 8            |
| 13      | TensorRAG (full wiring)                                            | 🟠       | 4            |
| 14      | Data Integrity & Logging Audit                                     | 🔴       | 4            |
| 15      | Distillation — Llama 17B on earned data                            | 🟡       | 3            |
| 16      | Phase 0 — Data Sourcing                                            | ⚪        | 4            |
| 17      | Phase 6 — Benchmarking (H1–H7)                                     | ⚪        | 1            |
| 18      | Product — Notifications                                            | 🟡       | 6            |
| 19      | Product — RBAC                                                     | 🟡       | 2            |
| 20      | Product — Data & State Architecture                                | 🟡       | 6            |
| 21      | Product — Security & Deployment                                    | 🟡       | 5            |
| 22      | Product — Advanced Agent Capabilities                              | ⚪        | 2            |
| 23      | Open Research Questions                                            | ⚪        | 7            |
| **NEW** | **Dynamic Coupling (V_int)**                                       | 🔴       | 4            |
| **NEW** | **Belief Graph**                                                   | 🔴       | 6            |
| **NEW** | **Stress Calibration (eustress / action-enabling)**                | 🔴       | 3            |
| **NEW** | **Behavioural Defaults & Reflexes**                                | 🔴       | 4            |
| **NEW** | **Action Space Axes (internal/external, logic, reflex, inaction)** | 🔴       | 4 (done)     |
| **NEW** | **Panic State — Total Rejection & Hypervigilance**                 | 🔴       | 3            |
| **NEW** | **Prompt Upgrades (belief/coupling/reflex aware)**                 | 🔴       | 4            |
| **NEW** | **Language Strategization (CoT + MCTS merge)**                     | 🟠       | 2            |
| **NEW** | **Human Forgetfulness & Session Continuity**                       | 🟠       | 2            |
| 24      | Completed (recent)                                                 | —        | —            |


---



## 1. 🔴 Active Sprint — Training (run_027)


| ID  | Task                                                  | Status | Notes                                         |
| --- | ----------------------------------------------------- | ------ | --------------------------------------------- |
| T1  | Monitor run_027; target 1000 eps/arm for base Exp 0–7 | [ ]    | Base arms at ~800+ eps; rebalancer active     |
| T2  | Ablation (0a–7a) and DPO (0p–7p) arms catch-up        | [ ]    | Currently 175–530 eps; lower priority workers |


---



## 2. 🔴 Active Sprint — Dashboard (all done)


| ID  | Task                                                                    | Status | File                                   |
| --- | ----------------------------------------------------------------------- | ------ | -------------------------------------- |
| D1  | Fix All Time stats table (was capping at 100)                           | [x]    | `benchmarksDashboard.js`               |
| D2  | Fix Crit Fail % (nulls counted as 0%; now shows —)                      | [x]    | `benchmarksDashboard.js`               |
| D3  | Fix group filter buttons (Base/Ablation/DPO re-render)                  | [x]    | `benchmarksDashboard.js`               |
| D4  | HPVOOT labels — add "Inertial" prefix everywhere                        | [x]    | `benchmarksDashboard.js`               |
| D5  | Move Recent Stats table to top; default N=100; Goal%(500) column        | [x]    | `benchmarksDashboard.js`, `index.html` |
| D6  | Enable vertical Y-axis zoom on all line charts                          | [x]    | `benchmarksDashboard.js`               |
| D7  | New Goal Rate — 100-Episode Buckets chart (most recent on left)         | [x]    | `benchmarksDashboard.js`               |
| D8  | Per-line tooltip (nearest mode) + offset positioner (no cursor overlap) | [x]    | `benchmarksDashboard.js`               |


---



## 3. 🔴 Active Sprint — Training Reliability (all done)


| ID  | Task                                                                            | Status | File                             |
| --- | ------------------------------------------------------------------------------- | ------ | -------------------------------- |
| R1  | Bedrock hang fix: `http_post` in `ThreadPoolExecutor` (hard wall-clock timeout) | [x]    | `node_client.py`                 |
| R2  | Stall detector self-restart via `os.execv` (physio healthy but stalled 15 min)  | [x]    | `train.py`                       |
| R3  | Historical-deficit-aware rebalancer (90% cumul. DB eps, 10% current-run)        | [x]    | `train.py`                       |
| R4  | Round-robin pool rebalancer replacing stop-on-gap logic                         | [x]    | `train.py`                       |
| R5  | Watchdog script + internal stall detector                                       | [x]    | `tensornets/scripts/watchdog.py` |


---



## 4. 🔴 Experiment Design


| ID          | Task                                                                                       | Priority | Status | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------ | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EXP-RENAME  | Rename ablation arms 1a–7a from `NoGate` → `NoCritGate`                                    | 🔴       | [x]    | **Done** — class names (`PhysioLLMNoCritGateWorker` etc.), ARM strings (`physio_llm_no_crit_gate` etc.), `EXP_META` dashboard labels, and `LEGACY_ALIAS` entries in `benchmarksDashboard.js` updated. Historical DB rows map correctly via alias.                                                                                                                                                                                                                                                                                                                                                                                                            |
| EXP-RAG     | New arms: Exp 8–11 RAG ablation set                                                        | 🟠       | [x]    | **Done** — Exp 8 PlainRAG, Exp 9 ReasonRAG (LLM re-ranked, fixes longitudinal cosine problem), Exp 10 ReasonRAG+MPS-MCTS, Exp 11 ReasonRAG+InertialHPVOOT. Class names: `PlainRAGWorker`, `ReasonRAGWorker`, `ReasonRAGMPSMCTSWorker`, `ReasonRAGInertialHPVOOTWorker`.                                                                                                                                                                                                                                                                                                                                                                                      |
| EXP-VOOT    | New arms: Exp 16 (ZoneHPVOOT, discrete affinity) and Exp 15 (MultiHorizonHPVOOT, MCTS9)    | 🟠       | [x]    | **Done** — `InertialHPVOOTZoneWorker` (Exp 16, idx 29): discrete hysteresis-zone cluster affinity for comparison vs continuous Exp 6. `MultiHorizonHPVOOTWorker` (Exp 15, idx 30): multi-horizon discounting (MICRO/SESSION/LONGITUDINAL gammas) + anticipatory anxiety bonuses via `_anticipatory_anxiety_bonus`. First arm with semantic naming convention.                                                                                                                                                                                                                                                                                                |
| EXP-GOT     | New arm: Exp 17 — GoT-HPVOOT (Graph-of-Thought MCTS)                                       | 🔴       | [x]    | **Done** — `GoTHPVOOTWorker` (Exp 17, idx 31, `ARM="got_hpvoot"`): replaces flat "rate these actions" prior prompt with a structured 5-node Graph-of-Thought call (Node A: physio, B: conversation, C: temporal, D: cluster synthesis, E: action scoring), all in ONE Scout call. After MCTS runs with GoT priors, a second batch-leaf Scout call re-scores top-5 actions in one call. `_mcts_top5` now returned in all HPVOOT responses (wired via `base.py`). Total: 2 Scout calls vs 1 (Exp 6). Registered in `train.py`, `EXP_META` in dashboard updated.                                                                                                |
| EXP-RAG2    | New arms: DiverseRAG and ReasonRAG-HPVOOT-NoPhysio                                         | 🟡       | [ ]    | **DiverseRAG (Exp 12):** Instead of top-k by similarity, use Maximal Marginal Relevance (MMR) to select diverse chunks — avoids returning k variants of the same clinical approach. Formula: `λ·sim(q,d) − (1-λ)·max_j sim(d,d_j)`. Good when the clinical knowledge base has many redundant entries. **ReasonRAG-HPVOOT-NoPhysio (Exp 13):** HPVOOT without physio-state gating — instead uses reasoning confidence from the ReasonRAG pass as the UCB exploration bonus. Action selection is driven by *clinical relevance* rather than *physiological trajectory*. Tests whether the physio component adds value over pure reasoning-quality exploration. |
| EXP-NAMING  | Adopt semantic arm naming for Exp 15+ (convention adopted, future arms to follow)          | 🟡       | [~]    | Convention: `GoTHPVOOTWorker`, `MultiHorizonHPVOOTWorker` etc. Apply retroactively to Exp 16 alias. Old class names kept as aliases for backwards-compat.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| EXP-ABL-EXT | Extended ablations after run_027: no-longitudinal, no-hysteresis, no-physio, frozen-bandit | ⚪        | [ ]    | **ABL-A** `physio_llm_no_longitudinal`: remove longitudinal hint — isolates cross-session memory value. **ABL-B** `physio_llm_no_hysteresis`: only instantaneous stress_index — isolates hysteresis extinction history. **ABL-C** `physio_llm_no_physio`: pure text companion with A3C policy — true floor. **ABL-D** frozen-bandit: freeze actor after warm-up — answers "how much does A3C add over Thompson Sampling?"                                                                                                                                                                                                                                    |
| FB3         | Enable Exp 0 A3C learning (wire apply_update for OldschoolWorker)                          | 🟠       | [ ]    | Currently `OldschoolWorker.generate_response` returns a reward and the base `A3CWorker.run_episode` calls `apply_update` — so A3C IS running. Verify rewards aren't all 0 (deferred=False path). If learning is flat, the issue is reward richness, not missing wiring. Add a `_DISABLE_LEARNING = False` class flag and confirm episode logs show non-zero actor updates.                                                                                                                                                                                                                                                                                   |
| SMOKE-RUN   | Smoke test: 1 episode per arm across all 31 arms (run_028 sanity)                          | 🔴       | [ ]    | Run `python -m tensornets.a3c.train --arms 1 2 3 ... 31 --episodes 1` to confirm all worker classes instantiate, serve a response, and log without error. Particular focus: GoTHPVOOTWorker (Exp 17), MultiHorizonHPVOOT (Exp 15), InertialHPVOOTZone (Exp 16).                                                                                                                                                                                                                                                                                                                                                                                              |


---



## 5. 🟠 Python Arm Improvements *(do not change prompts mid-run_027)*

> **Context:** Python arms 1–7 use a minimal `_DEFAULT_SYSTEM_PROMPT` with only `{hysteresis_ctx}` + `{action}`.
> The JS `PROMPT_ACTION_SELECTOR` has 12+ vars: stress level, HRV, zone, therapeutic_mode, session_goal,
> turns_completed, info_coverage, repetition_detected, last_action, conversation_history, known_context,
> longitudinal_hint, TensorRAG_context, pending_intervention.
> Exp 0 (JS) outperforms Python arms partly because its generator is richer, not purely better policy.


| ID  | Task                                                        | Priority | Status | Details                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------- | -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PA1 | Align base prompts with JS `PROMPT_ACTION_SELECTOR`         | 🟠       | [x]    | **Done** — `PhysioLLMWorker._DEFAULT_SYSTEM_PROMPT` now injects `therapeutic_mode`, `session_goal`, `turns_completed`, `info_coverage`, `last_action`, `repetition_detected`, `longitudinal_hint`, `known_context`, `available_actions` (stress-gated). `_build_longitudinal_hint()`, `_build_available_actions()`, `_build_known_context_block()` added as shared helpers. CoT prompt updated likewise. |
| PA2 | Inject longitudinal session hint into generation prompt     | 🟠       | [ ]    | Add `_build_longitudinal_hint(state) -> str` mirroring JS `getLongitudinalHint()`. Pull from `state.session_memory`: session_number, last_session_outcome, goal_progress, alliance_score, flagged_topics. DPO arms already have F1-F5 via `_build_dpo_prompt_vars` — refactor so base arms share the same extraction.                                                                                    |
| PA3 | Wire TensorRAG into Python arm generation prompts           | 🟠       | [ ]    | Add `_query_rag_context(state, user_msg, k=4) -> str` calling physio server `/rag/query` with stress_index + hrv + turn text. Inject as `{rag_context}`. Graceful fallback to empty string on failure. Applies to all arms 1–7 and their DPO/ablation variants.                                                                                                                                          |
| PA4 | Wire `facts_v2` known-context block into Python arm prompts | 🟠       | [ ]    | Add `_retrieve_known_context(state, scenario, user_msg) -> str` that POSTs to Node.js `/api/facts/relevant` with circleId, subjectId, currentTopic. Inject as `{known_context}`. If endpoint not exposed, add it to `routes/facts.js`. This is the biggest missing piece — session-persistent patient facts (meds, allergies, disclosures) are invisible to Python arms.                                 |
| PA5 | Document reward measurement confound                        | 🟠       | [ ]    | `_synthetic_reward` scores response text quality equally across arms, but Exp 0 responses come from the richer JS pipeline. This is a confound (not circularity). Document in `arms.py` and `A3C_COMPARISON_DESIGN.md`. Consider Exp 0b: JS generation + Python A3C action selection — isolates generator quality from policy quality.                                                                   |
| PA6 | Refactor arms.py — `_BasePythonGenerationMixin`             | 🟡       | [ ]    | Extract mixin with `_build_context()`, `_call_scout()`, `_finalize_response()`. Each arm overrides only `_build_system_prompt()`. Ablation flags become class attributes (`DISABLE_CRITICAL_FAILURE_GATE`, `SKIP_PRIVACY_GUARD`) — collapses 24 classes to ~8 base + flags.                                                                                                                              |
| PA7 | Extend no-privacy ablation to Python arms 1–7               | 🟡       | [ ]    | Exp 0a disables JS `privacyGuard`. For pure Python arms, privacy ablation = inject unredacted `session_memory.flagged_topics` without suppression. Decide: do 1a–7a become NoPrivacy+NoCritGate or add new 1b–7b slots?                                                                                                                                                                                  |


---



## 6. 🟠 A3C Full Comparison Run (K1–K5)

> run_027 is live with 24 arms. K1–K5 are the paper-quality analysis steps after sufficient episodes.
> See `documentation/tensornets/A3C_COMPARISON_DESIGN.md` for full design, metrics, and current results table.


| ID  | Task                                                                    | Priority | Status | Details                                                                                                                                                           |
| --- | ----------------------------------------------------------------------- | -------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | Run 10 canonical scenarios through all 8 base arms; collect transcripts | 🟠       | [ ]    | Same synthetic patient, same scenario seed → all arm responses side-by-side. Scenarios: billing denial, deaddiction-strike, flooding, phd_supervisor, panic, etc. |
| K2  | Learning curves: reward, actor/critic loss, entropy per arm             | 🟠       | [ ]    | Plot per-arm over episode count. Expected: entropy decreases as policy converges; reward increases.                                                               |
| K3  | Per-scenario transcript comparison                                      | 🟠       | [ ]    | Same user input → all arm responses for 10 canonical scenarios. HTN judge batch scoring offline.                                                                  |
| K4  | Statistical analysis: Wilcoxon signed-rank + effect size                | 🟠       | [ ]    | Arms 1–7 vs Exp 0 (production JS baseline). Also pairwise: Exp 3 vs 1, Exp 4 vs 3, Exp 6 vs 4.                                                                    |
| K5  | `EXPERIMENTS.md` entry with results, interpretation, limitations        | 🟠       | [ ]    | One entry per experiment — hypothesis, result, interpretation. Section 5 of paper.                                                                                |


---



## 6b. 🟠 A3C Feedback & Policy Quality

> **Context (items 1, 2, 6 from Aug upgrade plan):**
> Current A3C: scalar reward signal, EWA weight update, no qualitative feedback loop.
> Exp 0 and Exp 0p are not truly trained (Actor/Critic updates disabled for Exp 0;
> Exp 0p uses context enrichment only, not gradient updates). DPO arms 1p–7p showed
> poor improvement because the generation gap vs JS was never closed.


| ID  | Task                                                                      | Priority | Status | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------- | -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FB1 | Qualitative feedback loop for A3C reward shaping                          | 🟠       | [ ]    | After each episode, run a brief Scout "what went wrong / what worked?" pass over the full transcript. Extract 1-3 actionable insights (e.g. "companion repeated the same question twice", "no acknowledgement before advice"). Convert to a `qualitative_penalty` scalar added to the reward signal. This gives the policy a richer gradient than binary goal_achieved.                                                                                                    |
| FB2 | DPO counterfactual generation per episode                                 | 🟠       | [ ]    | For each episode where `goal_achieved=False`, generate a "what would a better response have been?" counterfactual using Scout with the full context. Store as `(state, chosen_response, rejected_response)` triple in `htn_benchmark_turns`. Use these triples for DPO fine-tuning of the generation prompt (not the action-selection policy).                                                                                                                             |
| FB3 | Enable Exp 0 learning (A3C on JS pipeline)                                | 🟠       | [ ]    | Currently Exp 0 runs JS generation but disables Actor/Critic updates (observed-only). To make it a proper learning baseline: wire `apply_update()` for Exp 0 using the same EWA mechanism as Exp 1–7, treating the JS action as the selected action. This lets Exp 0 improve its *action prior* over time even though generation stays in JS.                                                                                                                              |
| FB4 | Exp 0p context enrichment → actual DPO                                    | 🟠       | [ ]    | Exp 0p currently injects richer context into JS pipeline (context enrichment only). True DPO would: (1) collect chosen/rejected pairs from episode outcomes, (2) fine-tune the system prompt template using DPO loss on Scout. This requires storing `system_prompt_used` per turn in DB and a DPO training loop outside Bedrock (since logits are not exposed). Alternative: use the counterfactuals from FB2 as DPO pairs and run prompt optimisation via RLAIF scoring. |
| FB5 | Qualitative feedback for DPO arms (1p–7p)                                 | 🟠       | [ ]    | Arms 1p–7p show poor goal rates despite context enrichment. Add qualitative feedback (FB1) to these arms first — it is low-cost and can be toggled per arm. Measure delta in goal rate vs. base arm after 200 episodes. If no improvement, the bottleneck is generation quality (PA1–PA4), not the policy.                                                                                                                                                                 |
| RU1 | Expand scorer to 3 goal sub-dimensions (adherence, history, conversation) | 🟡       | [ ]    | JS `ConversationAnalyzer` scores `goal_adherence` (medication/treatment adherence), `goal_history` (patient shared their history), `goal_conversation` (conversation goal met). Python collapses to one `goal_progress`. Add the three sub-scores to `scorer.py` prompt and `TurnScoreResult`, and weight them in `map_scorer_to_reward_dims`. Each sub-score is still a per-turn delta (trend direction) not absolute state.                                              |


---


| ID    | Task                                                   | Priority | Status | Details                                                                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------ | -------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-RAG | Wire `facts_v2` retrieval into `CompanionCoordinator`  | 🟠       | [ ]    | Before action selector, query relevant facts by circle/subject and inject into prompt. Context is currently CAG only (physio hint + longitudinal hint). DB schema has `subject_id`, `target_object`, `sensitivity`, `confidence` columns ready for semantic retrieval. |
| G7    | Map `CompanionCoordinator` roles → HTN agent subspaces | 🟡       | [ ]    | Without this, Arm 1 (HTN+MCTS) does not flow through the production system. Low urgency while training runs.                                                                                                                                                           |


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


| ID  | Task                                                                            | Priority | Status | Details                                                                                                                                 |
| --- | ------------------------------------------------------------------------------- | -------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| PT1 | `density_matrix() -> Tensor[D,D]` on `MatrixProductState`                       | 🟠       | [ ]    | Contract `ρ =                                                                                                                           |
| PT2 | Upgrade `partial_trace_physio()` to exact double-layer contraction              | 🟠       | [ ]    | Replace transfer-matrix heuristic. Acceptance: `‖ρ_exact − ρ_approx‖_F < 1e-4` for identity MPS; must not diverge after 50 A3C updates. |
| PT3 | Add `partial_trace_session()` — amnesia gate for cross-agent reads              | 🟠       | [ ]    | Marginalise over longitudinal session bond (last `chi_session` right-bond indices).                                                     |
| PT4 | Wire into inter-agent read path; replace full-tensor JSON dump                  | 🟠       | [ ]    | Replace full-tensor in `/session/tensor/summary` with `ρ_semantic`. Add `X-Subspace: semantic                                           |
| PT5 | TensorRAG: replace `bond_fingerprint()` with top-k eigenvectors of `ρ_semantic` | 🟠       | [ ]    | PCA of semantic reduced density matrix. Retrieval key invariant to physiological confounders.                                           |
| PT6 | Benchmark PT2 latency < 5 ms per turn at χ=64                                   | 🟠       | [ ]    | Profile with `torch.profiler`.                                                                                                          |


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
>
> > 0.6 → positive interaction. `V_int.put_mps(from_role, None, stress_proxy)` seeds physiological
> > carry-over so the companion sees residual stress at episode start, not neutral 0.50.


| ID    | Task                                                                                                                                                      | Priority | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| SA1.1 | Add `DirectMessageEvent` dataclass to `agents/social_alliance.py`                                                                                         | 🟠       | [x]    |
| SA1.2 | Add `AllianceGraph.update_from_direct_message(event)` with vent-delta support; separate `direct_rapport` and `perceived_rapport` fields on `AllianceEdge` | 🟠       | [x]    |
| SA1.3 | Add `vent_delta` to `AllianceEdge`: tracks divergence between direct behaviour vs. companion-relayed perception                                           | 🟠       | [x]    |
| SA1.4 | Wire `direct_message` stress_proxy into `V_int / SharedTensorBuffer` at episode start                                                                     | 🟠       | [ ]    |
| SA1.5 | Add `relay_channel` turn type to `CareCircleOrchestrator` (training-only): direct turns skip companion generation, update only graph + V_int              | 🟠       | [ ]    |
| SA1.6 | `prompt_context_for()` upgrade: include vent-delta hint ("patient speaks positively of daughter directly but vented frustration in prior session")        | 🟠       | [x]    |
| SA1.7 | Benchmark: multi-person scenarios with direct channel events vs. companion-only baseline. Metric: alliance trajectory + goal rate across chained episodes | 🟠       | [ ]    |




### SA2 — Co-regulation and Contagion Coupling

> Currently per-participant inertia has no social coupling. In real negotiation, one person's calm
> actively calms others (parasympathetic co-regulation). Fear/panic spreads faster than calm
> (negative emotional contagion asymmetry, empirically supported).


| ID    | Task                                                                              | Priority | Status | Details                                                                                                                                                                                                                                                                                                             |
| ----- | --------------------------------------------------------------------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SA2.1 | `social_Gamma_modifier(alliance_score, speaker_stress) → Δγ`                      | 🟠       | [x]    | **Done** — `social_Gamma_modifier` added to `social_alliance.py`. `alliance_score` and `companion_stress` fields added to `TurnState`. All `_stress_after_response` call-sites in HPVOOT/LLM arms pass `state.alliance_score` + `state.companion_stress`. Range: Δγ ≈ [-0.15, +0.25] at extreme alliance and panic. |
| SA2.2 | Contagion asymmetry: negative HRV deltas propagate at 1.5× rate vs positive       | 🟠       | [x]    | **Done (wired)** — `AllianceEdge.stress_contagion_delta()` already implements 1.5× asymmetry. `AllianceGraph.propagate_stress_contagion()` uses it. `PhysioSimulator.step()` now accepts `social_gamma` kwarg. Full E2E wire pending SA3.4.                                                                         |
| SA2.3 | MCTS action `await_co_regulation`                                                 | 🟠       | [x]    | **Done** — Added to `ACTION_TAXONOMY` (77 total), `CALMING_WEIGHT`=0.80, `ACTION_INTENT_GROUP`=`deescalate`. Selection rule: ONLY when both participants in zone 3+ (V_int). Description in `action_selector.js`.                                                                                                   |
| SA2.4 | Wire SA2.1 into `PhysioSimulator.step()` via `ReactivityProfile.gamma_modifier()` | 🟠       | [x]    | **Done** — `PhysioSimulator.step()` now takes `social_gamma: float = 0.0`. Uses `effective_theta = max(0.02, theta - social_gamma)` so alliance quality scales the OU reversion speed. Verified: bonded σ=0.6356 < neutral σ=0.6392 < ruptured σ=0.6428 for same calming action.                                    |




### SA3 — Dynamic V_int Coupling (currently static)

> **Context (item 4 from Aug upgrade plan):**
> Currently `V_ij` coupling weights in `SharedTensorBuffer` are fixed priors initialised at startup.
> Propagation works (husband's HRV drop flows to wife's companion) but the *coupling strength*
> never changes. The scenario "anxious husband → wife panic attack" would require:
> (a) high V_ij (strong coupling), (b) asymmetric negative contagion (SA2.2),
> (c) the wife's companion detecting elevated incoming HRV delta and switching to panic support mode.
> None of this is learned or adaptive.


| ID                | Task                                                                                                                                           | Priority | Status | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SA3.1             | Update `V_ij` weights per session from A3C episode outcomes                                                                                    | 🟠       | [ ]    | After each episode, if `goal_achieved=True` and `social_coupling_was_active`, increase `V_ij` by `α=0.05`. If `critical_failure=True` and couple was in conflict, decrease by `β=0.10`. Store updated weights back to `SharedTensorBuffer`. Boundary rule: update only in `worker.py`, never in production.                                                                                                                                                                                                                                                                                                                                                                          |
| SA3.2             | Asymmetric panic contagion: if incoming V_int HRV delta < -15ms and zone≥3, trigger `PANIC_PSYCHOEDUCATION` cluster priority boost in MCTS     | 🟠       | [ ]    | Companion detects that the care circle member is in physiological crisis (via Vint propagation) and pre-emptively adjusts action selection before the patient's next message.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| SA3.3             | Add panic scenario to training corpus with two-person physiological coupling                                                                   | 🟠       | [ ]    | Scenario: husband has angina episode (Zone 4, HRV 8ms). V_int propagates delta to wife's companion. Wife starts showing stress (Zone 3, HRV 22ms). Companion must not just do generic breathing instruction but provide specific reassurance about cardiac vs. panic distinction.                                                                                                                                                                                                                                                                                                                                                                                                    |
| SA3.5             | Panic+withdrawal contagion scenario: de-escalate BOTH parties and schedule future interaction                                                  | 🟠       | [ ]    | When one party panics/withdraws, forcing conversation forward harms both. Required sequence: (1) `acknowledge_and_pause` + `defer_and_schedule` for the primary participant, (2) `check_on_caregiver` if caregiver is also stressed (V_ij propagation detected), (3) `schedule_future_interaction` — propose concrete future moment (e.g. "dinner on Saturday"), (4) `coordinate_companion_handoff` — signal peer companions to re-raise topic at scheduled time. The A3CScorer should reward this sequence at HIGH+CRITICAL stress instead of continued therapeutic confrontation. Add `escalation_expected=False` + `deescalate_expected=True` scenario flag to inform the scorer. |
| SA3.6             | Future interaction orchestration in CareCircleOrchestrator                                                                                     | 🟡       | [ ]    | Companions can proactively scaffold future conversations across the care circle: `schedule_future_interaction` proposes a time, `coordinate_companion_handoff` signals all peer companions. The orchestrator stores a `pending_future_interaction` object with `{proposed_time, topic, participants, originating_companion}` that peer companions receive at episode start as part of `longitudinal_hint`.                                                                                                                                                                                                                                                                           |
| EMERGENCY-ACTIONS | Emergency response actions in action taxonomy                                                                                                  | 🔴       | [x]    | **Done** — `emergency_mobilise`, `witness_grief`, `safety_exit_protocol` added (75 total actions). Group = `emergency`. Rule 0 override in `action_selector.js` covers stroke/cardiac/accident/death/threat. Reward: +0.30 bonus when acute-emergency tokens present; -0.25 penalty if applied without cause. A3CScorer gap: `emergency_correctly_escalated` scorer dimension still needed (add as `RU2`).                                                                                                                                                                                                                                                                           |
| RU2               | A3CScorer: add `emergency_correctly_escalated` dimension                                                                                       | 🟠       | [ ]    | When a scenario has `emergency_type` set (stroke, cardiac, threat, grief), the scorer should evaluate whether the companion correctly suspended therapeutic goals and routed to the right emergency protocol. Binary reward: 1.0 if `emergency_mobilise` / `witness_grief` / `safety_exit_protocol` selected appropriately; 0.0 if therapeutic actions were chosen instead. Requires a new `emergency_type` field in scenario metadata.                                                                                                                                                                                                                                              |
| SA3.4             | Honest documentation: V_int is currently static — update `A3C_COMPARISON_DESIGN.md` and `appendix_a_architecture.md` once SA3.1 is implemented | 🟡       | [ ]    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

---

### SA4 — Multi-Party Alliance (N ≥ 3 Members)

> The graph already supports N members structurally (all ordered pairs created in `_init_members`).
> What is missing is graph-level reasoning: who is the trust hub? who forms coalitions? where do stress cascades go?

| Item  | Task                                                                                                                                    | Priority | Status |
|-------|-----------------------------------------------------------------------------------------------------------------------------------------|----------|--------|
| SA4.1 | **`trust_centrality()`** — DONE. Returns mean incoming trust per role. Companion prompt now names the circle hub for N≥3 circles.       | 🟠       | [x]    |
| SA4.2 | **`network_stress_cascade()`** — DONE. Multi-hop propagation (depth-limited BFS). Included in `prompt_context_for` cascade warning.     | 🟠       | [x]    |
| SA4.3 | **`topic_alignment_matrix()`** — DONE. Per-topic pairwise alignment scores across all N edges.                                          | 🟠       | [x]    |
| SA4.4 | **`detect_coalitions()`** — DONE. Greedy clique detection for aligned subsets on the hottest topic. Injected into companion prompt.     | 🟠       | [x]    |
| SA4.5 | **`dominant_narrative()`** — DONE. Identifies which non-patient role most shapes patient belief on a topic, for companion strategy.     | 🟠       | [x]    |
| SA4.6 | **Engagement vs alignment model** — DONE. `topic_engagement` tracks *how much* a topic is discussed; `topic_alignment` tracks *agreement*. Coupling rises only when both are present. Was: coupling rose on any mention. | 🔴 | [x] |
| SA4.7 | Wire `alignment_signals` from A3CScorer "convergence" field into `update_topic_coupling_from_turn()` so actual agreement shifts coupling, not just mentions. | 🟠 | [ ] |
| SA4.8 | Scenario: 3-member circle (patient, caregiver, parent) with a health-topic coalition (patient+parent) vs. caregiver on medication compliance. Test coalition detection + dominant-narrative routing. | 🟡 | [ ] |
| SA4.9 | **Multilingual topic detection** — DONE. `detect_topic_from_text(text, language="fr")` falls back to Scout LLM call for non-English text, returns same topic score dict. | 🟠 | [x] |



## 10. 🟠 MCTS Upgrades

> **Context:** Current search is HP-PW-UCBV (NOT true Voronoi — see audit note in `hierarchical_pw_voot.py`).
> Cluster selection uses variance-aware UCB-V. Actions admitted by progressive widening in LLM-prior rank.
> Ensemble CVaR selection (K=5 trees × 40 iter, α=0.30) added. True VOOT (continuous Voronoi) not yet built.


| ID              | Task                                                          | Priority | Status | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCTS1           | MPS-accelerated MCTS leaf simulation                          | 🟠       | [ ]    | Current: leaf simulation uses a random rollout (fast but uninformative) or falls back to actor prior. Better: use MPS `expectation_value(state, action_operator)` as a zero-LLM leaf evaluator — the MPS encodes the physiological trajectory and can score actions without an LLM call. This replaces the expensive "LLM at each leaf" plan with an O(χ²) tensor operation. Benchmark vs. random rollout: does it improve goal rate?                                                                                                                                                                                                                                                 |
| MCTS2           | Fix Mtrunc — replace one-hot with true SVD guidance           | 🟠       | [ ]    | Current `_build_M_trunc()` constructs a path matrix from visit counts, which is nearly rank-1. The SVD then trivially recovers the best action. Fix: build the matrix from the *value estimates* Q(s,a) along the best K paths (not just the single best), so the top singular vectors encode genuine action trade-offs. This gives the LLM prompt a richer gradient ("prefer empathy over advice, but if stress drops to zone 2 then goal-setting is viable").                                                                                                                                                                                                                       |
| MCTS3           | Expand action space: panic-specific psychoeducation cluster   | 🟠       | [x]    | **Done** — ACTION_TAXONOMY now has 67 actions including full panic cluster (6 actions) + social coordination (8 actions). Intent-based descriptions in `prompts/action_selector.js`; `panic_safety_assess_faint` added.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| MCTS4           | Progressive lookahead depth tied to episode count             | 🟡       | [ ]    | Already partially implemented as `progressive_lookahead()` in `arms.py` but not fully activated. Confirm it ramps from depth 4 → 12 over first 500 episodes per arm. Log current depth per episode to DB (`mcts_depth` column in `htn_benchmark_episodes`).                                                                                                                                                                                                                                                                                                                                                                                                                           |
| MCTS5           | HPVOOT prior quality fix (session context in prior call)      | 🟠       | [x]    | **Done** — L2 fix (last 2 patient turns + session goal in prior prompt) was already applied. L3 fix (VOOT_C_VAR 0.8→0.4) was already applied. Now also wired `gamma_eff` + `session_boundary` into `MCTSActionIn` in `server.py`; `exploration_c` scales as `1.0 + (1.0 − γ_eff)` so post-gap episodes explore more.                                                                                                                                                                                                                                                                                                                                                                  |
| MCTS5b          | GoT Node B context parity with Exp 0/0p                       | 🔴       | [x]    | **Done** — GoT Node B now uses last 4 patient turns (was 2) + `known_context` (RAG/session facts) + `change_stage` + `relational_field`. Matches `action_selector.js` CONVERSATION_HISTORY window. Formatter updated to pass all new fields.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| MCTS6           | Temporal-gap awareness for MCTS across sessions               | 🟠       | [x]    | **Done.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| MCTS7           | MCTS+RAG: episode-memory prior for HPVOOT                     | 🟡       | [ ]    | Before the MCTS search, retrieve top-k most similar past episodes from `episode_memory.index` (existing RAG index). Pass as few-shot examples to `_fetch_prior_scores()` so Scout scores actions based on "what worked in similar situations" not just "what sounds calming". This gives empirically-grounded priors. Expected effect: fix the near-uniform prior problem more robustly than L2 alone. Implement as new Exp 14: `EpisodeRAGHPVOOTWorker`.                                                                                                                                                                                                                             |
| MCTS8           | PTSD-aware physio baseline and action gating                  | 🟡       | [ ]    | PTSD breaks three assumptions: (1) Baseline HRV is 20-35ms lower (resting attractor ≈ 25-35ms, not 55ms); `drift_physio_for_gap()` must use subject-specific baseline from `facts_v2`. (2) Zone transitions can be instantaneous (intrusive memory triggers); the stress_discrepancy signal already captures this — wire into action-cluster priority boost. (3) `flooding_deepen` MUST be gated behind `ptsd_safe_protocol=True` scenario flag — never auto-fired. Add `ptsd_profile` to scenario metadata and `ReactivityProfile`.                                                                                                                                                  |
| MCTS9           | Multi-horizon discounting within a single MCTS                | 🟡       | [x]    | **Done (Exp 15).**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| MCTS-ENSEMBLE   | Ensemble CVaR action selection (K trees × N iterations)       | 🔴       | [x]    | **Done** — `run_ensemble_mcts()` + `_perturb_state()` in `hierarchical_pw_voot.py`. CVaR_α=0.30 selects over worst 30% of ensemble Q values. Variance gate: if top action Q-variance > 0.18 across members, prefer probing action (`normalise_discrepancy`, `seek_probe_consent`) to reduce state ambiguity first. Reduces MCTS per-tree iterations 150→50. Exported from `mcts/__init__.py`. Terminology: "ensemble members" not "particles" — these are plausible true states under observation uncertainty, not Bayesian filter particles.                                                                                                                                         |
| MCTS-MULTIAGENT | Multi-agent MCTS: simulate care-circle members at rollout     | 🔴       | [ ]    | **How**: at each rollout step, instead of simulating physio-only state transitions, simulate what the patient and caregiver would *say* given the companion's action. Use BeliefGraph + coupling_tensor to generate a plausible response. This makes MCTS a multi-agent simulator, not just a physio simulator. Cost: 1 Scout call per rollout × K ensemble members — manageable if rollout depth is shallow (3-5 turns). The ensemble approach already uses K=5 trees; adding synthetic message generation within each is the key next step.                                                                                                                                          |
| MCTS-NAMING     | Rename `hierarchical_pw_voot.py` → `hierarchical_pw_ucbv.py` | 🟡       | [ ]    | File named for "VOOT" which was never implemented. Rename to `hierarchical_pw_ucbv.py`. Add `hierarchical_pw_voot.py` as a 1-line import alias so existing imports don't break. Update `mcts/__init__.py`, `server.py`, and `arms.py` imports. Update documentation references. Note: class names (`HierarchicalPWVOOTMCTS` etc.) kept as-is for DB log compatibility.                                                                                                                                                                                                                                                                                                               |
| MCTS-VOOT-REAL  | True Voronoi MCTS: compute Voronoi cells in action-feat space | ⚪        | [ ]    | True VOOT requires: embed all actions as feature vectors (e.g. ACTION_AXIS_IE + ACTION_AXIS_DR + CALMING_WEIGHT + ACTION_RESPONSE_DEPTH → 6D vector), compute Voronoi diagram, assign each action to its cell. Cluster selection then chooses a Voronoi cell, not a semantic group. Comparison: does computed Voronoi partition beat manual semantic clusters?                                                                                                                                                                                                                                                                                                                        |
| CONSIST1        | Credibility-weighted state: detect inter-state contradictions | 🟡       | [ ]    | **Actions added** (done). **Remaining**: (1) `statement_log` to episode memory. (2) `CredibilityModel.check()`. (3) Wire `contradiction_score` into MCTS priority. (4) A3CScorer dimension `consistency_explored`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| PREF1           | Per-person response style preferences                         | 🟡       | [ ]    | No preference model exists. Needed: `ResponseStyleProfile` in `facts_v2`/scenario with `{verbosity, tone, directiveness}`. Wire into Scout generation prompt. A3CScorer gets `style_match` dimension.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AUDIT1          | Resolve stub implementations documented in code audit         | 🟠       | [ ]    | AUDIT1-3 DONE. Remaining: (1) `M_trunc`/`project_constraint` — implement or remove claim. (2) `alliance_score` default 0.5 — need one arm to read real AllianceGraph. (3) `partial_trace_physio()` docstring honesty. (4) `AllianceGraph.coupling_tensor` persistence across sessions.                                                                                                                                                                                                                                                                                                                                                                                              |
| PHYSIO-ABSENT   | Physio sensors gracefully absent (no wearable)                | 🔴       | [~]    | **What exists**: `physio_available=False` flag in `TurnState` and `MCTSActionIn`. When absent, `exploration_c` is widened (+0.4) so MCTS explores more broadly. `physio_source="none"` gives sentinel values (stress_index=0.5, hrv_ms=-1). **Missing**: (1) No separate code path — the same MCTS and prompt runs with degraded physio. This is intentional (graceful degradation via exploration widening). (2) The conversation-inferred `conversation_stress` becomes the *primary* signal when `physio_available=False`. (3) Need explicit note in Scout system prompt: "Note: no wearable data — responses based on conversation cues only." Wire as `{physio_note}` template var. |
| MEMORY-LLM      | Long-term memory: complete-memory LLM call vs RAG/CAG         | 🟡       | [ ]    | **Current state**: two memory querypoints exist — (1) `state.known_context` via PA4 (`/api/facts/relevant` returning session-persistent facts), (2) `state.summary` (rolling episode summary built per-turn). **Missing**: a third, higher-quality pass for complex cases — a Scout call with the full session summary + top RAG chunks. **How**: after 10+ turns or when stress_discrepancy is high, trigger a `_deep_memory_call()` that sends the full `state.summary` + last 10 turns to Scout and asks "what are the 3 most important clinical facts from this session?". Result injected as `{deep_context}` in GoT Node B. Gated by LLM cost: at most once per 10 turns.     |




---


| ID  | Task                                                                | Priority | Status | Details                                                                                                            |
| --- | ------------------------------------------------------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| F5  | Latency test: MCTS background + generation foreground < 200 ms TTFT | 🟡       | [ ]    | Current smoke test: 13.9 ms for 120 iterations / depth 4 — well within budget. Formal test still needed for paper. |


---



## 11. 🟡 Phase 3 — MCTS Latency


| ID  | Task                                                                | Priority | Status | Details                                                                                                            |
| --- | ------------------------------------------------------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| F5  | Latency test: MCTS background + generation foreground < 200 ms TTFT | 🟡       | [ ]    | Current smoke test: 13.9 ms for 120 iterations / depth 4 — well within budget. Formal test still needed for paper. |


---



## 12. 🟡 Physiological Subspace (Track C/B)

> **Benchmark C (open):** Validate decay curves against WESAD HRV recordings (needs P0.7 first).
> **Benchmark E (open):** Scaling test — N ∈ {10, 50, 100, 500} turns, confirm O(Ndχ²) wall time.


| ID   | Task                                                          | Priority | Status | Details                                                                                                                                    |
| ---- | ------------------------------------------------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| C5.3 | Tests for PK/PD models                                        | 🟡       | [ ]    | MetoprololModel peak modifier, SSRI phase crossover, BZD tolerance decay.                                                                  |
| C5.5 | Validate PK/PD decay curves against literature                | 🟡       | [ ]    | Kleiger 2005, Agelink 2001.                                                                                                                |
| C6.2 | Tests for all four reactivity archetypes                      | 🟡       | [ ]    | Threshold activation, labile peak, ruminant decay, stoic.                                                                                  |
| C7.2 | Test worked example from paper                                | 🟡       | [ ]    | panic → 1-month therapy → 6-month gap → reinstatement.                                                                                     |
| B6   | Benchmark: Bedrock Llama 4 Scout TTFT and tokens/sec baseline | 🟡       | [ ]    | Needed for Phase 3 latency comparison.                                                                                                     |
| ALS  | Wire ALS into A3C policy update path                          | 🟡       | [ ]    | Current `apply_update()` uses log-bias EWA on Actor dict. ALS sweep exists in `core/mps.py` but is not wired into the A3C gradient update. |


---



## 13. 🟠 TensorRAG — Full Wiring

> **Context (item 9 from Aug upgrade plan):**
> TensorRAG index is built (`tensornets/data/rag/clinical_kb.*`, `episode_memory.*`).
> The physio server has a `/rag/query` endpoint. But TensorRAG is not yet wired into any arm
> or production path. The JS `queryTensorRAGContext()` call in `CompanionCoordinator` is the
> reference implementation.


| ID   | Task                                                                                          | Priority | Status | Details                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------- | -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RAG1 | Confirm `/rag/query` accepts `use_physio` flag; add if missing                                | 🟠       | [ ]    | Need flag to switch between physio-conditioned retrieval (TensorRAG) and text-only cosine (PlainRAG). Used by EXP-RAG arms and PA3.                                                                            |
| RAG2 | Wire TensorRAG into Python arms 1–7 (see PA3)                                                 | 🟠       | [ ]    | `_query_rag_context(state, user_msg, k=4)` → inject as `{rag_context}`. Same as JS `queryTensorRAGContext()`.                                                                                                  |
| RAG3 | Evaluate retrieval quality: TensorRAG vs PlainRAG vs no-RAG                                   | 🟠       | [ ]    | Run K1 canonical scenarios through Exp 8 (PlainRAG), Exp 9 (TensorRAG), Exp 1 (no-RAG). Compare goal rate and reward. If TensorRAG ≤ PlainRAG, physio-conditioned retrieval adds no value — document honestly. |
| RAG4 | PT5 integration: replace `bond_fingerprint()` with `ρ_semantic` eigenvectors as retrieval key | 🟡       | [ ]    | Depends on PT1–PT2. Makes TensorRAG retrieval key invariant to physiological confounders.                                                                                                                      |


---



## 14. 🔴 Data Integrity & Logging Audit

> **Context (item 12 from Aug upgrade plan):**
> Several statistics and log entries in the thesis PDF were inferred from message histories
> because structured logging had failed during early runs. The DB may contain gaps, inferred
> values, or episodes whose metrics were backfilled rather than measured.


| ID     | Task                                                      | Priority | Status | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | --------------------------------------------------------- | -------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUDIT1 | Identify runs/episodes with inferred vs. measured metrics | 🔴       | [ ]    | Query `htn_benchmark_turns` for rows where `tokens_scout IS NULL OR tokens_scout = 0` — these were never properly logged. Separately check `htn_benchmark_episodes` for episodes with `llm_calls_total = 0`. Produce a table: arm → % of turns with missing token data, % with missing latency.                                                                                                                                                                                                                   |
| AUDIT2 | Identify DB rows backfilled from JSONL episode files      | 🔴       | [ ]    | Compare episode counts in DB (`htn_benchmark_episodes`) vs JSONL files in `tensornets/runs/run_*/arm_*/episodes/`. If DB has fewer rows than JSONL for any arm, those episodes were never inserted. If DB has more, there may be synthetic/duplicated rows.                                                                                                                                                                                                                                                       |
| AUDIT3 | Goal progress: delta vs current state                     | 🟠       | [ ]    | **Item 10 from Aug plan.** Currently `goal_achieved` is binary (0/1 per episode). The reward function uses `goal_progress` as a turn-level scalar. Verify: is `goal_progress` measuring the *delta* in goal state this turn (correct — rewards incremental progress) or the *absolute* current goal state (wrong — rewards already-achieved goals, causes reward leakage)? Check `_synthetic_reward()` in `arms.py`. Document finding.                                                                            |
| AUDIT4 | Exp 0 / 0a / 0p data leakage check                        | 🟠       | [ ]    | **Item 10 cont.** Exp 0p outperforms Exp 0 by injecting richer context. But does the context include the *goal itself* or *prior episode outcomes*? If the context hint includes "patient achieved medication adherence goal last session" and the judge evaluates "did patient achieve medication adherence this session?", the system is using future-session outcomes as input. Verify `_build_dpo_prompt_vars()` and `getLongitudinalHint()` do not leak the current-episode goal into the generation prompt. |


---



## 15. 🟡 Distillation — Llama 17B on Earned Data

> **Context (item 11 from Aug upgrade plan):**
> We now have ~28k episodes across 24 arms. This is a non-trivial dataset of clinical companion
> interactions with associated reward signals, physiological trajectories, and judge scores.
> The question is whether to distil a smaller/specialised model from this data.


| ID    | Task                                               | Priority | Status | Details                                                                                                                                                                                                                                                                                                                                   |
| ----- | -------------------------------------------------- | -------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DIST1 | Assess dataset quality for distillation            | 🟡       | [ ]    | Filter episodes: keep only `goal_achieved=True` OR `judge_safety > 0.7` OR `cumulative_reward > 8`. Estimate: how many high-quality `(prompt, response)` pairs do we have per arm? Target: ≥ 2000 pairs for meaningful SFT. Query DB and report per-arm counts.                                                                           |
| DIST2 | Define distillation objective                      | 🟡       | [ ]    | Option A: supervised fine-tuning (SFT) on best-episode transcripts — teach a smaller model to generate therapeutic companion responses. Option B: reward-model distillation — fine-tune on `(prompt, reward)` pairs to produce a local judge. Option B is more valuable (reduces Bedrock judge dependency). Decide based on DIST1 counts. |
| DIST3 | Distillation pipeline (see `TODO_DISTILLATION.md`) | 🟡       | [ ]    | Blocked on P0.5 (Ollama/Mistral), P0.6 (405B access). This is the Track D pipeline.                                                                                                                                                                                                                                                       |


---

> **Decision needed before distillation** — see `TODO_DISTILLATION.md`.


| ID   | Task                                             | Priority | Status | Details                                                                                                                               |
| ---- | ------------------------------------------------ | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| P0.5 | Confirm Mistral GGUF reuse vs HF download        | ⚪        | [ ]    | Run `ollama show mistral --modelfile`; check if weights reusable from `D:/hf_cache`.                                                  |
| P0.6 | Request Llama 3.1 405B access on Bedrock console | ⚪        | [ ]    | Needed for full distillation benchmarks. Deferred.                                                                                    |
| P0.7 | Download WESAD dataset                           | ⚪        | [ ]    | Free, no approval. [https://ubicomp.eti.uni-siegen.de/home/datasets/icmi18/](https://ubicomp.eti.uni-siegen.de/home/datasets/icmi18/) |
| P0.8 | PhysioNet account for MIMIC-III/IV               | ⚪        | [ ]    | ~1 week approval. [https://physionet.org](https://physionet.org)                                                                      |


---



## 13. ⚪ Phase 6 — Benchmarking (Section 5 of paper)

> Requires Phases 2–5 complete. H benchmarks that depend on distillation are in `TODO_DISTILLATION.md`.


| ID    | Task                       | Priority | Status |
| ----- | -------------------------- | -------- | ------ |
| H1–H7 | Paper section 5 benchmarks | ⚪        | [ ]    |


---



## 14. 🟡 Product — Notifications & Communication


| ID  | Task                                           | Priority | Status |
| --- | ---------------------------------------------- | -------- | ------ |
| N1  | Notification abstraction layer (multi-channel) | 🟡       | [ ]    |
| N2  | WhatsApp: Twilio provider                      | 🟡       | [ ]    |
| N3  | WhatsApp: AISensy provider                     | 🟡       | [ ]    |
| N4  | Template message management                    | 🟡       | [ ]    |
| N5  | User notification preferences                  | 🟡       | [ ]    |
| N6  | Push notifications (mobile/web)                | 🟡       | [ ]    |


---



## 15. 🟡 Product — RBAC


| ID    | Task                                                  | Priority | Status | Notes |
| ----- | ----------------------------------------------------- | -------- | ------ | ----- |
| RBAC1 | [x] DB schema (`system_roles`, `sessions`)            | —        | [x]    | Done  |
| RBAC2 | [x] Auth middleware + login/logout + password hashing | —        | [x]    | Done  |
| RBAC3 | [x] Frontend login UI                                 | —        | [x]    | Done  |
| RBAC4 | Admin UI (user management)                            | 🟡       | [ ]    |       |
| RBAC5 | CLI login tool                                        | 🟡       | [ ]    |       |


---



## 16. 🟡 Product — Data & State Architecture


| ID  | Task                      | Priority | Status | Details                                                                 |
| --- | ------------------------- | -------- | ------ | ----------------------------------------------------------------------- |
| DS1 | Bi-temporal fact tracking | 🟡       | [ ]    | `reported_at` (transaction time) vs `valid_at` (event time).            |
| DS2 | Veracity & subjectivity   | 🟡       | [ ]    | Confidence, source type (self-report vs external), sentiment evolution. |
| DS3 | Source attribution        | 🟡       | [ ]    | `reported_by` (User/Agent), `provenance` (original message ID).         |
| DS4 | Privacy & access policy   | 🟡       | [ ]    | Visibility levels: circle-wide, private-to-doctor, patient-only.        |
| DS5 | Importance scoring        | 🟡       | [ ]    | Weight facts by clinical/contextual significance.                       |
| DS6 | EMR & document storage    | 🟡       | [ ]    | S3/Blob + encryption, metadata indexing (patient ID, date, doctype).    |


---



## 17. 🟡 Product — Security & Deployment


| ID   | Task                                                       | Priority | Status |
| ---- | ---------------------------------------------------------- | -------- | ------ |
| SEC1 | Input validation & sanitization (XSS/SQLi)                 | 🟡       | [ ]    |
| SEC2 | API rate limiting                                          | 🟡       | [ ]    |
| SEC3 | Dependency vulnerability audit                             | 🟡       | [ ]    |
| SEC4 | Production DB configuration (isolation from simulation DB) | 🟡       | [ ]    |
| SEC5 | Logging & monitoring setup                                 | 🟡       | [ ]    |


---



## 18. ⚪ Product — Advanced Agent Capabilities


| ID   | Task                                     | Priority | Status |
| ---- | ---------------------------------------- | -------- | ------ |
| AAC1 | Multi-question pending action stack (v2) | ⚪        | [ ]    |
| AAC2 | Self-reference resolution                | ⚪        | [ ]    |


---



## 19. ⚪ Open Research Questions


| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Status                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Q1  | **Which layer to distill from?** Paper says "final layer" — ablation needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ⚪ Deferred to distillation track |
| Q2  | **Optimal χ?** Benchmark at χ ∈ {32, 64, 128, 256}. Run when E7 is done.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ⚪                                |
| Q3  | **Right Δt?** Start at Δt = 1 turn. Sub-turn steps if PK/PD models require it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ⚪                                |
| Q4  | **Vocabulary mismatch Mistral vs Llama 3?** Decide before distillation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ⚪                                |
| Q5  | **1a–7a: should privacy guard also be disabled?** Currently `NoCritGate` ablations remove the critical failure gate but not the privacy guard. For a clean ablation, should 1a–7a also disable privacy filtering? Or add separate 1b–7b "NoPrivacy" slots? Decision needed before starting next run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 🟠                               |
| Q6  | **MPS leaf evaluator vs random rollout: is the value signal meaningful?** If `expectation_value(state, action_operator)` returns near-uniform scores (as Scout prior did), the MPS leaf evaluator provides no benefit over random rollout. Need a quick benchmark (MCTS1) before committing to this approach.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 🟠                               |
| Q7  | **Goal progress: delta or absolute?** `_synthetic_reward()` computes `goal_r` — does it reward the *change* in goal state this turn (correct) or the absolute current goal state (reward leakage)? If absolute, Exp 0p's advantage may be partly spurious. AUDIT3 will answer this. **Status: audited.** When the A3CScorer runs (even turns), `goal_progress` comes from `scorer_reward_dims["goal_progress"]` which is the scorer's per-turn LLM delta (+2→+1→0→-1→-2), not absolute. On odd turns (heuristic carry), `arm_reward_dims["goal_progress"]` (action-taxonomy lookup) is used — this IS an instantaneous delta by action type, not absolute `info_coverage`. **No leakage confirmed.** Remaining gap: the JS ConversationAnalyzer has three goal sub-dimensions (adherence, history, conversation) while Python collapses to one. Adding them requires scorer prompt expansion. Track as RU1 below. | 🟡                               |


---



## NEW-A. 🔴 Dynamic Coupling (V_int / V_ij)

> **Context**: `V_ij` coupling weights in `SharedTensorBuffer` are static priors set at startup.
> Emotional coupling strength is not a constant — it is dynamic, context-dependent, and
> bidirectional. The research literature shows that *both extremes are problematic*:
> very high coupling (enmeshment) amplifies distress bidirectionally and locks both parties
> into maladaptive patterns; very low coupling (detachment/isolation) means one party's
> crisis cannot reach the companion caring for the other.
> The companion's advice strategy must be *aware of and adaptive to* the current coupling level.


| ID              | Task                                                         | Priority | Status | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------ | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| COUP1           | Make V_ij session-dynamic (already tracked in SA3.1; extend) | 🔴       | [x]    | **Done** — `v_coupling` (renamed from `v_ij`) now seeded per `RelationshipType` prior. `update_v_ij()` renamed `update_coupling` internally, updates both base and topic couplings proportionally. `ALPHA_BELIEF_COUPLING=0.03` added. Backward-compat `v_ij` property retained.                                                                                                                                                                                                                                                                 |
| COUP2           | Coupling level classifier → companion strategy switch        | 🔴       | [x]    | **Done** — `detect_communication_regime()` classifies 5 regimes. 4 coupling-regime actions added: `differentiation_prompt`, `individual_space`, `boundary_assertion`, `mutual_acknowledgement` (in `ACTION_TAXONOMY`, `CALMING_WEIGHT`, `ACTION_INTENT_GROUP`, `ACTION_HORIZON`). AS2/AS3/COUP2 gating in `server.py` filters candidate actions before MCTS. Rule 14 added to `action_selector.js`. |
| COUP3           | Environment / belief remodelling when coupling is extreme    | 🟠       | [ ]    | **How**: if `enmeshed_flooded` regime for ≥ 2 consecutive sessions, flag `belief_enmeshment_risk=True` in `AllianceEdge`. Companion begins structured differentiation sequence: (1) acknowledge shared bond, (2) surface one co-constructed belief at `topic_coupling` intersection, (3) introduce `probability_reframe` for that belief. If `ISOLATED` for ≥ 2 sessions, flag `isolation_risk=True`; recommend `schedule_future_interaction`.                                                                                                   |
| COUP4           | Asymmetric coupling: panic contagion threshold               | 🟠       | [ ]    | **How**: when `topic_coupling["conflict"] * stress_sender > panic_threshold`, companion receives `PANIC_CONTAGION_ALERT`. New action: `ground_before_continue`. Scenario: `two_person_panic` in corpus (SA3.3 prerequisite). **Topic coupling** already wired — `stress_contagion_delta(delta, topic="conflict")` uses `topic_coupling["conflict"]` × 1.5 multiplier.                                                                                                                                                                            |
| RELFIELD-RENAME | Rename V_int → RelationalField, V_ij → v_coupling → conductance → coupling_tensor | 🔴 | [x] | **Done** — `AllianceEdge` field renamed through: `v_ij` → `v_coupling` → `conductance` → `coupling_tensor` (project convention: tensors use tensor naming). Backward-compat `v_ij` property and `v_ij_matrix()` alias retained. All docstrings, comments, and arms.py references updated. Breadcrumb trail in-code. |
| RELTYPE         | RelationshipType enum + CommunicationTemp axis               | 🔴       | [x]    | **Done** — `RelationshipType` enum (16 types: spouse, boss, toxic_partner, clinician, etc.) with `_REL_COUPLING_PRIOR`, `_REL_POWER_ASYMMETRY`, `_REL_TEMP_PRIOR` dicts. `CommunicationTemp` enum (COLD/COOL/NEUTRAL/WARM/HOT). Both seed `AllianceEdge` via `__post_init_`_. `detect_communication_regime()` classifies 5 regimes. `prompt_context_for()` now emits regime hint + temperature + power asymmetry.                                                                                                                                |
| TOPICCOUPLE     | Per-topic coupling + belief ↔ coupling bidirectional         | 🔴       | [x]    | **Done** — `TOPIC_CLUSTERS` (10 topics: health, conflict, intimacy, finances, …) with `_DEFAULT_TOPIC_COUPLING_MULTIPLIER`. `topic_coupling: dict[str,float]` on `AllianceEdge`. `update_coupling_from_belief_divergence(topic, divergence)`: belief misalignment reduces topic coupling; alignment strengthens it. `coupling_signal_for_belief_update()`: belief shift propagates influence signal to peer companions. `stress_contagion_delta(delta, topic)` now uses per-topic coupling. `prompt_context_for()` emits topic hotspot warnings. |


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


| ID  | Task                                                           | Priority | Status | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------- | -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BG1 | `BeliefGraph` data structure                                   | 🔴       | [x]    | **Done** — `tensornets/agents/belief_graph.py`: `BeliefNode` (text, confidence, valence, moral_weight, identity_linked, temporal_focus, source, session_count), `BeliefEdge` (from/to/relation/strength), `BeliefGraph` (directed graph with `add_or_update`, `risk_tier`, `safe_targets`, `risky_targets`, `cascade_impact`, `belief_shift_signal`, `prompt_context`). JSON persistence in `state/subjects/{id}/belief_graph.json`. |
| BG2 | Belief discovery pipeline from conversation                    | 🔴       | [x]    | **Done** — `extract_beliefs_from_turn(text, role)` in `belief_graph.py`: calls Scout with structured extraction prompt, returns list of belief dicts. EWA confidence update on re-confirmation (`ALPHA=0.15`). Duplicate detection via 70% word overlap. `load_belief_graph` / `save_belief_graph` persistence helpers. |
| BG3 | Belief salience and risk classifier                            | 🔴       | [x]    | **Done** — `risk_tier(node_id)` returns `identity_core` / `foundational` / `actionable` / `peripheral`. `safe_targets()` and `risky_targets()` lists. `cascade_impact(node_id, depth=3)` propagates confidence through successors. `prompt_context(max_nodes)` generates companion hint with risk-aware framing. Injected into `AllianceGraph.prompt_context_for(belief_graph=...)`. |
| BG4 | Belief interpolation — cascade via peripheral nodes + context-aware relevance selection | 🟠 | [x] | **Done**: `BeliefGraph.prompt_context()` now accepts `current_action`, `current_topic`, `stress_index`. Applies 4 selection rules: (1) topic affinity scoring, (2) action-based tier gate (challenge actions → safe targets; empathy actions → identity-core warnings), (3) stress gate (>0.70 → no safe targets, crisis mode), (4) contradiction detection (opposing-valence edges surfaced as explicit hints). Belief cascade on `normalise_discrepancy`/`probability_reframe` success is deferred to BG4b. |
| BG5 | Belief–action mapping: which action targets which belief layer | 🟠 | [x] | **Done** (LS2 / targeting): `prompt_context()` computes `target_belief_id` = the single most topic-relevant, high-confidence safe belief. Appended as `[target_belief_id: <id>]` in the prompt block so Scout can reference it directly. `BeliefCouplingDPOWorker._build_system_prompt()` passes `current_action` and `stress_index` to `prompt_context()` for per-turn targeting. `AllianceGraph.prompt_context_for()` signature extended with `current_action` + `stress_index` forwarded to `belief_graph.prompt_context()`. |
| BG6 | Safe-edge ablation path for negotiation                        | 🔴       | [ ]    | **How**: `BeliefGraph.ablation_path(target_id) -> list[node_id]` — returns an ordered list of peripheral/actionable nodes that form a path toward the target without touching identity_core nodes. Each step in the path: (1) has `in_degree ≤ 1`, (2) is `contradicts`-adjacent to the target's subgraph, (3) is NOT `identity_linked`. This is the *negotiation scaffold*: companion works along the ablation path over multiple sessions, systematically reducing the foundational belief's credibility support before approaching it directly. Used by LS2 to pick the `target_belief_id` for each turn. |
| BG7 | BeliefGraph arm (new experiment)                               | 🟡       | [ ]    | **How**: `BeliefGraphHPVOOTWorker` (Exp 19) — subclass of `GoTHPVOOTWorker`. Overrides `generate_response` to: (1) load `BeliefGraph` for subject, (2) inject safe/risky beliefs into GoT prompt Node B, (3) run GoT-HPVOOT as normal. Ablation vs Exp 17: does belief-aware prior improve goal rate? Requires BG1–BG3. |


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


| ID  | Task                                                                      | Priority | Status | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SC1 | Optimal stress window per archetype/context                               | 🟠       | [x]    | **Done** — `OPTIMAL_STRESS_RANGE` dict added to `physio_simulator.py` with 7 archetype/phase combos. `stress_calibration_bonus(stress, archetype, phase)` returns ±0.05. Wired into `worker.py` terminal bonus block (episode end). |
| SC2 | New action: `increase_salience` / `temporal_urgency`                      | 🟠       | [x]    | **Done** — both actions added to `ACTION_TAXONOMY`, `CALMING_WEIGHT` (0.05/0.10), `ACTION_INTENT_GROUP` (motivate), `ACTION_HORIZON` (LONGITUDINAL/SESSION), `ACTION_AXIS_IE`, `ACTION_AXIS_DR`. Gate in `server.py`: both blocked when `stress_index ≥ 0.40`. Rule 17 added to `action_selector.js`. |
| SC3 | A3CScorer: reward deliberate action completion, not just stress reduction | 🟠       | [ ]    | **How**: add `action_completion` dimension to scorer prompt: "Did the patient commit to or complete a specific action this turn (e.g. agreed to call the doctor, scheduled an appointment, set a boundary)? Score 0–1." Include alongside `goal_progress` in reward computation. Weight: 0.15 (same as `safety`). This prevents A3C from learning that the optimal policy is to always validate and calm.                                                                                                                                                    |


---



## NEW-D. 🟠 Behavioural Defaults, Habits & Reflexes

> **Context**: under stress, people revert to automatic behaviours — habits, conditioned
> reflexes, social defaults, and practiced responses — that bypass deliberate reasoning.
> These override rational argument. A companion that reasons with a patient who is in
> *reflex mode* is ineffective: the patient is not processing via System 2. The companion
> needs to (1) detect when the patient is in reflex vs. deliberated mode, (2) match the
> intervention to the mode (interrupt-and-ground for reflexes; explore-and-reason for
> deliberation), and (3) pre-commit strategies that reroute reflexes before they fire.


| ID  | Task                                                                 | Priority | Status | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BD1 | `BehaviorProfile`: catalog known reflexes, defaults, habits per user | 🟠       | [ ]    | **How**: add `behavior_profile: dict` to `facts_v2`/scenario metadata. Schema: `{reflexes: ["flee", "fawn", "freeze", "fight"], defaults: ["minimise", "overexplain", "shut_down"], habits: [{cue, routine, reward}], practiced: ["deep_breathing", "prayer", "smoking"]}`. Populated by A3CScorer dimension `behavior_type_detected` ("reflex/default/deliberated/unknown"). Companion reads this from `_build_longitudinal_hint`.                                             |
| BD2 | Reflex detection in conversation                                     | 🟠       | [ ]    | **How**: add `reflex_detected: bool` to `TurnState`. Set when `stress_index > 0.7` AND (`stress_discrepancy > 0.25` OR last utterance matches reflex-language patterns: short sentences, repetition, past-tense self-reference like "I always do this", "I can't help it"). When `reflex_detected=True`, MCTS should suppress `challenge_belief`, `socratic_probe`, `flooding_deepen`; promote `ground_before_continue`, `acknowledge_and_pause`, `breathing_4_7_8`.            |
| BD3 | Pre-commitment actions for reflex override                           | 🟠       | [ ]    | **How**: add `precommit_strategy` action (available only when stress is LOW and patient is in deliberated mode). Action intent: "establish a concrete if-then rule before the patient re-enters a triggering context." ("If you feel the urge to leave the conversation, you've agreed to say one thing first — what will that be?"). Reward bonus +0.10 when `precommit_strategy` is followed by successful avoidance of a known reflex in a subsequent turn.                  |
| BD4 | Habit loop modeling: cue-routine-reward                              | 🟡       | [ ]    | **How**: add `HabitLoop` to `BeliefGraph` (or separate structure) — `{cue: str, routine: str, reward_belief: str}`. Example: `{cue: "conflict at home", routine: "withdrawal", reward_belief: "I avoid more pain"}`. Companion can then target the `reward_belief` (peripheral, often malleable) rather than the routine directly. This links to BG3 (safe-to-challenge). New action: `reframe_habit_reward` — disputes the reward belief without attacking the cue or routine. |


---



## NEW-E. 🔴 Action Space Axes

> **Context**: the current action taxonomy is a flat list of 76 actions grouped by intent
> cluster. But the *axes of variation* that matter clinically are not captured as searchable
> dimensions. Four axes are particularly important:
>
> 1. **Internal vs External** — is the action targeting the patient's internal state
>   (belief, physio, affect) or the external world (relationships, events, environment)?
> 2. **Logic vs Counterintuitive** — most actions are rational; but some situations call
>   for paradoxical interventions (prescribe the symptom, reverse-validate, strategic
>    ambiguity). Counterintuitive actions are high-risk/high-reward and need gating.
> 3. **Deliberated vs Reflexive** — does the action engage slow/deliberate thinking or
>   leverage fast/intuitive cognition? When a patient is in reflex mode, deliberated
>    actions are wasted.
> 4. **Inaction vs Action** — "wait", "hold space", "freeze-with-them" are valid
>   therapeutic moves. The current taxonomy has no pure inaction actions. Inaction can
>    prevent iatrogenic harm (a companion that "does something" during a grief moment
>    is often worse than one that witnesses silently).


| ID  | Task                                                            | Priority | Status | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AS1 | Internal/External axis: tag all actions                         | 🔴       | [x]    | **Done** — `ACTION_AXIS_IE: dict[str,str]` added to `action_bandit.py`. Maps every action to `"internal"`, `"external"`, or `"both"`. Exported from `tensornets.a3c`. GoT Node D `focus_axis` injection is a follow-up (EXP-GOT2). |
| AS2 | Logic/Counterintuitive axis: paradoxical interventions          | 🔴       | [x]    | **Done** — 3 new actions: `prescribe_symptom`, `strategic_ambiguity`, `reverse_validate`. `ACTION_AXIS_LOGIC` dict added. Hard gates in `server.py`: `stress < 0.40` AND `session_count ≥ 3`. Rule 15 added to `action_selector.js`. |
| AS3 | Deliberated/Reflexive axis: mode-matched intervention selection | 🔴       | [x]    | **Done** — `ACTION_AXIS_DR` dict added. `reflex_detected` field added to `TurnState` and `MCTSActionIn`. Hard gate in `server.py`: deliberated actions blocked when `reflex_detected=True`. `session_count` and `reflex_detected` propagated through MCTS payload from arms. **Remaining**: BD2 (automatic reflex detection from conversation) — currently `reflex_detected` must be set manually via `response_dict`. |
| AS4 | Inaction axis: silence, witnessing, holding space               | 🔴       | [x]    | **Done** — 4 new inaction actions: `hold_space`, `therapeutic_silence`, `await_readiness`, `pause_and_breathe_together`. `CALMING_WEIGHT`, `ACTION_INTENT_GROUP`, `ACTION_HORIZON` all updated. `inaction_appropriateness_bonus()` in `physio_simulator.py`: +0.12 in grief/shock scenarios, -0.08 at low stress. Per-turn bonus wired into `worker.py` turn loop. Overuse penalty (3 consecutive inaction) at episode end. |



| Item                                                                         | Category      | Date     |
| ---------------------------------------------------------------------------- | ------------- | -------- |
| Per-line tooltip (nearest mode) + offset positioner (no cursor overlap)      | Dashboard     | Jun 2026 |
| Goal Rate 100-Episode Buckets chart                                          | Dashboard     | Jun 2026 |
| Recent Stats at top; Goal%(500) comparison; Y-zoom                           | Dashboard     | Jun 2026 |
| Group filter buttons fixed (Base/Ablation/DPO re-render)                     | Dashboard     | Jun 2026 |
| HPVOOT "Inertial" labels; Crit Fail % null fix; All Time stats uncapped      | Dashboard     | Jun 2026 |
| Bedrock hard-timeout via `ThreadPoolExecutor` in `node_client.py`            | Reliability   | Jun 2026 |
| Stall-detector self-restart via `os.execv`                                   | Reliability   | Jun 2026 |
| Historical-deficit-aware arm picker (90% hist / 10% run)                     | Reliability   | Jun 2026 |
| Round-robin pool rebalancer replacing stop-on-gap logic                      | Reliability   | Jun 2026 |
| 24-arm expansion: 8 base + 8 NoCritGate ablations + 8 DPO                    | Experiments   | Jun 2026 |
| Critical failure tracking end-to-end (worker → DB → dashboard)               | Experiments   | Jun 2026 |
| Flooding sub-phase support in `_synthetic_reward` + `therapy/modes.py`       | Experiments   | Jun 2026 |
| DPO/RLAIF arms (Exp 0p–7p) + `_DPO_SYSTEM_PROMPT` + `_build_dpo_prompt_vars` | Experiments   | Jun 2026 |
| OldschoolDPOWorker: `context_hint` → `extraContext` into JS pipeline         | Experiments   | Jun 2026 |
| `_safe_fmt` helper — silent fill for missing prompt keys                     | Code quality  | Jun 2026 |
| Alliance state fixtures (200+ scenarios in `tensornets/state/alliances/`)    | Training data | Jun 2026 |
| Watchdog script + internal stall detector                                    | Reliability   | Jun 2026 |
| TensorRAG index built (`clinical_kb.*`, `episode_memory.*`)                  | Research      | Jun 2026 |
| Thompson Sampling bandit warm-up → A3C actor initialisation                  | Research      | May 2026 |
| PhysiologicalHistory persistence to disk between server restarts             | Research      | May 2026 |
| BaseMCTS + DialogMCTS (UCB1, backprop, 13 ms latency)                        | Research      | May 2026 |
| 67 passing tests (physio + core)                                             | Research      | May 2026 |
| Package scaffold, pyproject.toml, Bedrock + Ollama backends                  | Research      | Apr 2026 |
| PhysiologicalState (8 signals), HRV→γ, non-Hermitian operators, MPS          | Research      | Apr 2026 |
| Hysteresis model, PK/PD models, individual reactivity profiles               | Research      | Apr 2026 |
| Therapeutic modes, longitudinal session state, MCTS comparison runner        | Research      | Apr 2026 |
| LLM-as-judge (6-dim rubric, DPO counterfactuals), DiscrepancyAudit           | Research      | Apr 2026 |
| Privacy layer (info classes I–IV, consent gates, disclosure advantage)       | Product       | Apr 2026 |
| RBAC: DB schema, auth middleware, login UI                                   | Product       | Mar 2026 |


---


## NEW-F. 🔴 Panic State — Total Rejection & Hypervigilance

> **Context**: A patient in full panic mode is not just stressed — they are in a qualitatively
> different cognitive state. Threat detection is maximal. Every input is reinterpreted as
> confirmation of the worst case. Advice is not processed; it is rejected as minimising.
> Suggestions read as demands. The companion's job in this state is NOT to fix anything —
> it is to survive the panic without rupture and maintain relational presence until the
> patient can re-engage System 2.

| ID    | Task                                                                  | Priority | Status | Details |
| ----- | --------------------------------------------------------------------- | -------- | ------ | ------- |
| PAN1  | Panic state classifier: differentiate panic from high stress          | 🔴       | [ ]    | **How**: add `panic_mode: bool` to `TurnState`. Classify as True when `stress_index > 0.85` AND at least one of: (a) reflex_detected=True, (b) scorer `critical_failure` this turn, (c) patient utterance contains "stop", "leave me alone", "you don't understand", "nothing helps". In `panic_mode`, the action gate blocks ALL deliberated and motivational actions — only reflexive/inaction/de-escalation cluster allowed. |
| PAN2  | Companion behaviour in panic_mode: presence without agenda            | 🔴       | [ ]    | **How**: when `panic_mode=True`, inject into system prompt: "The patient is in a hypervigilant state. Do NOT: offer solutions, normalise, reframe, or explain. DO: acknowledge the physical sensations, validate that the distress is real, use short sentences, slow pace. If patient rejects, say: 'I hear you. I'm not going anywhere.' Do NOT attempt to continue the therapeutic goal this turn." Reduce response length cap to 2 sentences. |
| PAN3  | Post-panic repair sequence: re-entry after panic resolves             | 🟠       | [ ]    | **How**: when `stress_index` drops below 0.70 after a `panic_mode` turn, set `post_panic_repair=True` in `TurnState` for the next 2 turns. In repair turns: ONLY `validate`, `affirmation`, `acknowledge_and_pause`, `goal_reassess` are available. Block all challenge/motivation actions for 2 turns. This models the clinical reality that the therapeutic relationship must be rebuilt before goals can resume. |


---


## NEW-G. 🔴 Prompt Upgrades — Belief, Coupling, Reflex Awareness

> **Context**: The Python arms now have a rich action taxonomy with axis dictionaries,
> belief graphs, coupling regimes, and reflex detection — but the LLM-facing prompts
> (Scout system prompts in `arms.py`) do not yet reference any of this. The companion
> LLM sees stress/physio context but not: which beliefs are safe to target, whether the
> patient is in reflex mode, what the relationship type/coupling is, or which actions
> are gated. These prompts need a structured upgrade pass.

| ID    | Task                                                                  | Priority | Status | Details |
| ----- | --------------------------------------------------------------------- | -------- | ------ | ------- |
| PU1   | Inject BeliefGraph context into Scout system prompt                   | 🔴       | [x]    | **Done**: `run_episode` in `worker.py` now calls `load_belief_graph(state.subject_id)` before the episode loop and passes `belief_graph` to `_alliance_graph.prompt_context_for()`. `prompt_context_for()` appends `belief_graph.prompt_context(max_nodes=4)` to the context block. Cost: 0 extra LLM calls. |
| PU2   | Inject CommunicationRegime + RelationshipType into Scout prompt       | 🔴       | [x]    | **Done**: separate `[Patient Relationship]` block injected into `known_context` at episode start in `worker.py`. Includes: relationship_type, comm_temp, regime, and a regime-specific instruction for the LLM language register. Requires `_alliance_graph` to be available (else silently skipped). |
| PU3   | Inject reflex_mode and panic_mode into Scout prompt                   | 🔴       | [x]    | **Done**: `[Patient Mode: REFLEX]` or `[Patient Mode: PANIC]` block injected when `state.reflex_detected` or `state.panic_mode` is True. Added `panic_mode: bool = False` field to `TurnState`, carried forward per turn. PAN1 classifier (pending) will set it; PU3 already reads it. |
| PU4   | Exp 0b — Exp 0p extended with belief/coupling/reflex prompt upgrades  | 🔴       | [x]    | **Done** — `BeliefCouplingDPOWorker` (Exp 18, `bc_dpo_hpvoot`). Subclass of `InertialHPVOOTPhysioMPSMCTSWorker` (not Oldschool — preserves MCTS). Overrides `_build_system_prompt()` to inject: (1) DPO session vars (`_build_dpo_prompt_vars`), (2) BeliefGraph safe/risky hints via `bg.prompt_context(max_nodes=4)`, (3) Alliance coupling_tensor + communication regime from `self._alliance_graph`. Registered at idx 32 in `train.py`. Dashboard entry `EXP_META['bc_dpo_hpvoot']` added. |


---


## NEW-H. 🟠 Language Strategization (CoT + MCTS merge)

> **Context**: MCTS provides a principled lookahead over physio state and action values.
> CoT provides a language-level reasoning trace. Currently they are separate: MCTS selects
> the action, CoT explains it. But real therapeutic strategy requires *language-level
> planning* — anticipating how a specific phrasing will land given the patient's beliefs,
> coupling, and current mode. This is not captured by a scalar Q-value.

| ID    | Task                                                                  | Priority | Status | Details |
| ----- | --------------------------------------------------------------------- | -------- | ------ | ------- |
| LS1   | Strategy trace: CoT at root + MCTS for action, merged into one call   | 🟠       | [ ]    | **How**: modify GoT Node D (Synthesis) to emit not just a `top_action` but a `strategy_statement`: "Given the patient's belief that [X] and current regime [Y], the goal this turn is to [Z] without triggering identity defence." This strategy statement becomes the Scout system prompt for generation — replacing a generic action label with a specific therapeutic intent. MCTS still selects the action; CoT now specifies *how* to execute it. |
| LS2   | Belief-targeted language: action → specific belief node               | 🟠       | [ ]    | **How**: GoT Node B (Conversation) adds a field `target_belief_id` — the node from BeliefGraph that this action turn is targeting. The Scout generation prompt prepends: "This turn targets the belief: '{belief.text}' (risk_tier={tier}). Approach accordingly." For peripheral/actionable beliefs: direct but gentle. For identity_core: normalise and work around. |
| LS3   | **Response best-of-N selection** (message quality ranking at inference) | 🟠     | [ ]    | **Context**: MCTS selects the *action/intent* for this turn. The actual *message* is generated once by Scout with no ranking. These are orthogonal: MCTS handles future-state strategy; LS3 handles current-turn message quality. **How**: generate K=3 candidate responses from Scout (same action, different temperature: T=0.7, T=0.9, T=1.1). Score with A3CScorer on: (1) clinical tone adherence, (2) action fidelity (does the message actually execute the selected action?), (3) belief safety (does it avoid triggering identity-core beliefs?). Return the top-ranked message. Cost: 3 Scout calls → 1 Maverick scoring call. **When to activate**: only for GoTHPVOOTWorker (Exp 17) and BeliefCouplingDPOWorker (Exp 18); not for all arms (too expensive). **Alternative if cost is too high**: use A3CScorer as reranker without calling Maverick (4 Scout calls total). |


---


## NEW-I. 🟠 Human Forgetfulness & Session Continuity

> **Context**: Humans forget commitments, goals, and disclosures between sessions.
> The companion must not assume that what was said 2 weeks ago is still present
> in the patient's working memory. It also must not re-introduce forgotten topics
> in ways that feel like interrogation. The companion itself must also be resilient
> to its own context window limits.

| ID    | Task                                                                  | Priority | Status | Details |
| ----- | --------------------------------------------------------------------- | -------- | ------ | ------- |
| FOR1  | `memory_fade_factor`: confidence decay on unconfirmed beliefs/facts   | 🟠       | [ ]    | **How**: in `BeliefGraph.remove_stale_beliefs()`, extend to apply a `memory_fade_factor` per session gap: `confidence *= 0.90^(gap_days/30)` for beliefs not re-confirmed this session. Facts in `facts_v2` older than 90 days with `confidence < 0.4` are demoted to `"historical"` tier. This prevents stale beliefs from dominating the companion's understanding of the patient. |
| FOR2  | Soft re-entry: re-introduce forgotten topics without interrogation    | 🟠       | [ ]    | **How**: new action `soft_reintroduce` — companion re-mentions a historical topic as an observation, not a question: "Last time you mentioned [X]. How has that been sitting with you?" Only fires when `session_gap_days > 14` AND topic `confidence > 0.5`. Distinct from `goal_reassess` (which re-opens the session goal); this re-opens a specific belief or commitment that may have drifted. Gated: NOT available in first 3 turns. |

---

## NEW-J. Observation Uncertainty (Human Fallibility Model)

> **Context**: MCTS and A3C treat `state` as ground truth. In reality every piece of patient-reported
> information is an observation generated by a fallible, biased, state-dependent human observer.
> A user's report is not the truth — it is the truth as mediated by 11 sources of distortion.
> The system must reason under this uncertainty rather than overfit to noisy self-reports.
>
> **The 11 distortion modes** (from user requirements):
> forgetfulness, misinterpretation, incomplete_info, false_confidence, self_uncertainty,
> systematic_bias, recall_distortion, attention_failure, communication_fail,
> strategic_concealment, state_dependent.
>
> **Key principle**: honest uncertainty (self_uncertainty, incomplete_info) improves credibility;
> overconfident distortion (false_confidence, strategic_concealment) degrades it.

| ID    | Task                                                                                 | Priority | Status | Details |
|-------|--------------------------------------------------------------------------------------|----------|--------|---------|
| OBS1  | `ObservationUncertainty` dataclass + `update_from_scorer_signals()` + credibility weight | 🔴   | [x]    | **Done**: new module `tensornets/agents/observation_uncertainty.py`. `ObservationUncertainty` holds per-mode probabilities. `credibility_weight()` aggregates to [0.15,1]. `mcts_uncertainty_modifier()` returns UCB boost. `prompt_context()` injects hint into known_context. `update_from_scorer_signals()` reads **patient-side** fields only (`obs_contradiction_score`, `obs_avoidance_score`, `obs_confidence_mismatch`, `obs_distortion_modes`) — never agent-quality fields (`commitment_contradiction_score`, `consent_respect_score`). Independence principle documented in both `observation_uncertainty.py` and `worker.py`. |
| OBS2  | Wire `obs_c_boost` into MCTS UCB exploration constant                                | 🔴       | [x]    | **Done**: `base.py` `search()` reads `initial_state["obs_c_boost"]`, adds to `self.c` for `_select()` traversal. Arms pass `obs_c_boost` and `obs_credibility` in MCTS payload. `MCTSActionIn` in `server.py` accepts both fields. |
| OBS3  | A3CScorer prompt: detect observation distortion signals per turn                     | 🔴       | [x]    | **Done**: added `obs_contradiction_score`, `obs_avoidance_score`, `obs_confidence_mismatch`, `obs_distortion_modes` to `_SCORING_PROMPT` JSON output. Clinical interpretation notes explain the 11 modes. A3CScorer call returns these; `update_from_scorer_signals()` reads them. |
| OBS4  | Wire OBS hint into `known_context` per turn (companion sees reliability warning)     | 🔴       | [x]    | **Done**: `worker.py` calls `ObservationUncertainty.prompt_context()` after each scorer call and prepends to `state.known_context` when credibility < 0.85. Scout sees: "Observation Reliability: 72%. Flags: patient may be selectively withholding (28%); stress is distorting assessment (45%). Recommended: normalise_discrepancy before accepting state as fact." |
| OBS5  | `robust_action_discount()` — penalise high-specificity actions under uncertainty     | 🟠       | [ ]    | **How**: in MCTS rollout scoring (hierarchical_pw_voot.py), for each action look up `_ACTION_STRESS_SPECIFICITY[action]` (range 0–1). Apply `discount = obs.robust_action_discount(specificity)` to the rollout Q-value. High-specificity actions (graded_imagery, time_bracketing) are discounted more when state is uncertain. Meta-actions (normalise_discrepancy, seek_probe_consent, open_question) have specificity=0 and are never discounted. |
| OBS6  | Multilingual topic detection — LLM-first, no keyword hardcoding                     | 🔴       | [x]    | **Done**: `detect_topic_from_text()` in `social_alliance.py` now delegates entirely to `detect_topic_llm()` in `observation_uncertainty.py`. Keyword lists removed as primary path. Single Scout call handles all languages, scripts, code-switching, and idioms. Falls back to `{}` on error (non-blocking). |
| OBS7  | Particle filter MCTS — sample K possible true states at each rollout                 | 🟡       | [ ]    | **How**: at each MCTS leaf evaluation, sample K=3 "possible worlds" by perturbing `stress_index` by ±(1-credibility)×0.3 and perturbing `obs_active_modes`. Run rollout once per world; take the mean Q-value (not max). This implements the core insight: the action must work across the distribution of possible true states, not just the reported one. Computationally: 3× rollout cost per leaf. Only for InertialHPVOOT arms (Exp 8+). |
| OBS8  | Dynamic coupling N-member: scenario with 3-member care circle testing coalition detection | 🟠  | [ ]    | **How**: new scenario "health_faction_conflict" — patient + parent agree on medication refusal; caregiver supports treatment. `detect_coalitions("health")` should detect {patient, parent}. Companion must bridge, not take sides. Test that `dominant_narrative()` correctly routes to the higher-trust party. |
| OBS9  | `topic_alignment` wire from A3CScorer convergence signal into `update_topic_coupling_from_turn` | 🟠 | [ ] | **How**: A3CScorer output already includes `goal_progress` (0=neutral, +2=strong agreement). Add `convergence_signal: float [-1..+1]` to scorer output = patient agreement with companion's therapeutic framing this turn. Pass as `alignment_signals={"therapeutic": convergence_signal}` to `update_topic_coupling_from_turn()`. SA4.7 closes the loop: training produces alignment signals that update coupling. |

---

## NEW-K. No-Watch / Physio-Absent Handling

| ID          | Task                                                                              | Priority | Status | Details |
|-------------|-----------------------------------------------------------------------------------|----------|--------|---------|
| PHYSIO-ABS1 | `_build_physio_note()` helper — LLM caveat when no wearable detected              | 🔴       | [x]    | **Done** (`arms.py`). Returns empty string when `physio_available=True`; returns a natural-language warning note injected as `{physio_note}` into all Scout system prompts when `physio_available=False`. Note includes the blended `conversation_stress` estimate and instructs Scout to be more exploratory, less directive, and not to cite physiological readings. Wired into all 4 `_safe_fmt` call sites in Exp 1–21 and the DPO `_build_system_prompt` override. |
| PHYSIO-ABS2 | `_effective_physio_state()` — blended stress when no watch                        | 🔴       | [x]    | **Done** (existing). Returns `80% conversation_stress + 20% last_known_stress`, neutral HRV/EDA/zone. Exploration_c widened +0.4 in server.py. |
| PHYSIO-ABS3 | Arm ablation: `PhysioLLMNoWatchWorker` — trains without sensor data at all        | 🟡       | [ ]    | **How**: new arm extending `PhysioLLMWorker` that sets `physio_source="none"` at episode start. Isolates the contribution of sensor data vs. conversation-only inference. Compare with Exp 1 (full sensor) to measure wearable value. |

---

## NEW-L. Hierarchical Session Memory (MEMORY-LLM)

> **Context**: The current memory architecture has three layers that exist in code but were not
> systematically wired together or exposed to Scout as a coherent block.
>
> **G1 — Turn-recent** (raw): last 4–6 turns from `conversation_history`. Free, zero cost.
> **G2 — Session-arc** (LLM-condensed): `state.summary`. Updated every 4 turns via Scout call.
>   Returns `arc_summary`, `open_threads`, `momentum`, `key_facts`.
> **G3 — Cross-session** (longitudinal): `longitudinal_hint` + `future_plans_summary` + BeliefGraph.
>   Cost: 0 extra calls (already available at episode start).
>
> The BeliefGraph provides a fourth implicit layer: persistent belief nodes that survive across
> sessions, already wired into `known_context` via `AllianceGraph.prompt_context_for()`.

| ID      | Task                                                                              | Priority | Status | Details |
|---------|-----------------------------------------------------------------------------------|----------|--------|---------|
| MEM-G2  | `_update_session_arc()` — incremental G2 condensation every 4 turns              | 🔴       | [x]    | **Done** (`worker.py`). One Scout call per 4 turns. Returns `arc_summary` (≤25 words), `open_threads` (≤3), `momentum` (positive/neutral/resistant), `key_facts` (≤3). Stored in `state.summary`. Falls back to prior summary on error. Cost ≈ +25% LLM calls on top of scorer. |
| MEM-G3  | `_build_hierarchical_memory_block()` — 3-granularity block injected at episode start | 🔴   | [x]    | **Done** (`worker.py`). Assembles G2 (session arc) + G3 (longitudinal hint, future plans) into `[Clinical memory — three granularities]` block. Prepended to `known_context` at episode start so Scout always has structured temporal context. Empty sections are omitted. |
| MEM-BG  | BeliefGraph as G4 (persistent cross-session belief layer)                         | 🔴       | [x]    | **Done** (existing: PU1 + BG4/BG5). BeliefGraph is loaded at episode start, `memory_fade` applied on gap, beliefs injected via `alliance_graph.prompt_context_for()`. Context-aware relevance by action + stress. |
| MEM-LLM | Long-context LLM option for G2: when session > 20 turns, use Maverick for arc    | 🟡       | [ ]    | **How**: in `_update_session_arc()`, if `state.turn_count > 20`, route the condensation call to `/llm/maverick` instead of Scout. Maverick has a larger context window and produces higher-quality clinical summaries for long sessions. Cost: +1 Maverick call per 4 turns after turn 20. |
| MEM-RAG | G3 + TensorRAG: retrieve cross-session facts from episodic memory (not just hints) | 🟡      | [ ]    | **How**: at episode start, run a TensorRAG query against the patient's `episode_memory` index using the current `session_goal` as query. Top-3 retrieved chunks augment `longitudinal_hint`. This is richer than `longitudinal_hint` (hand-authored) because it retrieves specific evidence. Depends on RAG1 (TensorRAG `/rag/query` endpoint). |

---

## NEW-M. Multi-Agent MCTS (MCTS-MULTIAGENT)

> **Context**: Standard HP-PW-UCBV evaluates companion actions in a solo interaction model.
> In multi-user care circles, a companion action affects the caregiver's stress, which feeds
> back into the patient's state via social coupling (`coupling_tensor`). Ignoring this cascade
> means MCTS may select locally optimal but globally suboptimal actions.
>
> **Architecture**: `MultiAgentHPVOOTMCTS` extends `HierarchicalPWVOOTMCTS` by replacing
> the single-step `_rollout_action` with a depth-3 heuristic simulation:
>   0. Companion action → primary reward r0 (same as base HP-PW-UCBV).
>   1. Caregiver reaction → coupling-modulated stress shift → r1.
>   2. Patient re-response → caregiver stress feeds back via coupling → r2.
>   Score = r0 + γ·r1 + γ²·r2   (γ=0.80), normalised to [0, 1].
> No LLM calls — all heuristic. Cost identical to base class per iteration.

| ID       | Task                                                                             | Priority | Status | Details |
|----------|----------------------------------------------------------------------------------|----------|--------|---------|
| MA-MCTS1 | `MultiAgentHPVOOTMCTS` class with 3-step care-circle rollout                    | 🔴       | [x]    | **Done** (`hierarchical_pw_voot.py`). Coupling read from `state["coupling_tensor"]` (default 0.55). Per-cluster caregiver stress deltas: de_escalate −0.12, challenge +0.08, explore −0.05. Exported from `mcts/__init__.py`. |
| MA-MCTS2 | Exp 21 `MultiAgentMCTSWorker` arm + `mcts_mode="multi_agent"` routing in server  | 🔴       | [x]    | **Done** (`arms.py`, `train.py`, `server.py`). Exp 21 registered at idx 35. `server.py` `/mcts/best-action` routes `mcts_mode="multi_agent"` to `MultiAgentHPVOOTMCTS`. Dashboard entry added. |
| MA-MCTS3 | Wire `coupling_tensor` from episode state into MCTS payload                      | 🟠       | [ ]    | **How**: in `InertialHPVOOTPhysioMPSMCTSWorker.generate_response()`, read `coupling_tensor` from `AllianceEdge` (already loaded) and pass as `initial_state["coupling_tensor"]`. Currently absent from the MCTS payload. Needed for MA-MCTS1 to use real coupling rather than default 0.55. |
| MA-MCTS4 | Compare Exp 21 vs Exp 6 (same base, no multi-agent rollout) in 50-episode trial  | 🟡       | [ ]    | **Hypothesis**: Exp 21 should score higher on trust_delta and goal_progress in multi-user scenarios (caregiver present) but comparable in solo scenarios. |

---

## NEW-N. Pending From Current Sprint

| ID          | Task                                                                            | Priority | Status | Details |
|-------------|---------------------------------------------------------------------------------|----------|--------|---------|
| MCTS-NAMING | Rename `hierarchical_pw_voot.py` → `hierarchical_pw_ucbv.py`                   | 🟡       | [ ]    | Non-breaking: keep old file as thin import shim. Update `mcts/__init__.py` imports. Low priority vs. new feature work. |
| REAL-VOOT   | True Voronoi MCTS: continuous action-space partition via nearest-cluster in feature space | 🟡 | [ ] | **How**: embed each action as a vector (stress_sensitivity, trust_impact, goal_delta, info_gain, temporal_scope). Compute Voronoi cells using scipy Voronoi on the 5-D feature space. MCTS then selects the cell nearest to current state, then picks within that cell. This is what "VOOT" should have been. |