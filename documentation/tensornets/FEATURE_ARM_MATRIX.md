# Feature × Experiment Arms Matrix

> **Purpose**: Single-source reference for which features are active in which arms,
> what is shared vs. arm-specific, which combinations are missing, and the
> implementation maturity of each feature.
>
> **Last audit**: 2026-08-30
>
> **Legend**
> - `[x]` Implemented and active in this arm
> - `[~]` Partially wired (code exists, not all paths exercised)
> - `[ ]` Planned but not yet implemented
> - `[a]` Inherited from parent arm (not re-implemented)
> - `[−]` Intentionally absent (ablation)
> - `[?]` Needs audit
>
> **Feature maturity**
> - **Prod** — used in production JS system
> - **Stable** — implemented, tested in training
> - **Beta** — wired but needs more training signal
> - **Draft** — code exists, integration incomplete
> - **TODO** — in TODO.md, not yet coded

---

## Feature Registry

| ID      | Feature Name                         | Module(s)                                    | Maturity | Last Audit |
|---------|--------------------------------------|----------------------------------------------|----------|------------|
| F-PHYS  | Physiological state (HRV, EDA, etc.) | `physio_simulator.py`, `worker.py`           | Stable   | 2026-08-30 |
| F-MPS   | Matrix Product State encoding        | `mps.py`, `physio_simulator.py`              | Beta     | 2026-08-30 |
| F-MTRUNC| M_trunc constraint projection        | `base.py`, `arms.py`                         | Beta     | 2026-08-30 |
| F-MCTS  | Standard MCTS (DialogMCTS)           | `base.py`, `arms.py`                         | Stable   | 2026-08-30 |
| F-HPVOOT| Hierarchical PW VOOT MCTS            | `hierarchical_pw_voot.py`                    | Stable   | 2026-08-30 |
| F-INERT | Session inertia (gamma_eff)          | `hierarchical_pw_voot.py`, `arms.py`         | Stable   | 2026-08-30 |
| F-COT   | Chain-of-Thought prior scoring       | `arms.py` (CoT variants)                     | Stable   | 2026-08-30 |
| F-GOT   | Graph-of-Thought (5-node GoT)        | `arms.py` (GoTHPVOOTWorker)                  | Beta     | 2026-08-30 |
| F-BATCHLF| Batch leaf re-ranking via GoT       | `arms.py` (GoTHPVOOTWorker)                  | Beta     | 2026-08-30 |
| F-DPO   | DPO/RLAIF prompt preferences         | `arms.py` (DPO variants)                     | Stable   | 2026-08-30 |
| F-RAG-P | Plain RAG (text similarity)          | `arms.py` (PlainRAGWorker)                   | Stable   | 2026-08-30 |
| F-RAG-R | Reason RAG (LLM re-ranking)          | `arms.py` (ReasonRAGWorker)                  | Stable   | 2026-08-30 |
| F-CGAT  | Critical failure gate (2-strike)     | `worker.py`                                  | Stable   | 2026-08-30 |
| F-PRIV  | Privacy guard (JS CompanionCoord.)   | `CompanionCoordinator.js`                    | Prod     | 2026-08-30 |
| F-A3C   | A3C tabular bandit learning          | `action_bandit.py`, `worker.py`              | Stable   | 2026-08-30 |
| F-ALLY  | Alliance graph (trust/rapport)       | `social_alliance.py`, `worker.py`            | Beta     | 2026-08-30 |
| F-VTOPI | Topic engagement + alignment model  | `social_alliance.py`                         | Beta     | 2026-08-30 |
| F-VCOUP | Dynamic V_coupling per relationship  | `social_alliance.py`                         | Beta     | 2026-08-30 |
| F-NCOUP | N-member coalition / cascade        | `social_alliance.py`                         | Draft    | 2026-08-30 |
| F-BGRF  | BeliefGraph (nodes + edges)          | `belief_graph.py`                            | Beta     | 2026-08-30 |
| F-BCOND | Conditional (if) edges in BeliefGraph| `belief_graph.py`                            | Draft    | 2026-08-30 |
| F-BPROV | Node/edge provenance tracking        | `belief_graph.py`                            | Draft    | 2026-08-30 |
| F-OBS   | ObservationUncertainty (11 modes)    | `observation_uncertainty.py`                 | Beta     | 2026-08-30 |
| F-OBSC  | OBS UCB boost in MCTS                | `base.py`, `server.py`, `arms.py`            | Beta     | 2026-08-30 |
| F-OBSP  | OBS prompt context injection         | `worker.py`                                  | Beta     | 2026-08-30 |
| F-OBSRD | OBS robust action discounting        | TODO: OBS5                                   | TODO     | —          |
| F-PU1   | BeliefGraph → Scout prompt inject    | `worker.py`                                  | Beta     | 2026-08-30 |
| F-PU2   | CommRegime + RelType → Scout prompt  | `worker.py`                                  | Beta     | 2026-08-30 |
| F-PU3   | Reflex/panic mode → Scout prompt     | `worker.py`                                  | Beta     | 2026-08-30 |
| F-MHZON | Multi-horizon discounting (MCTS9)    | `hierarchical_pw_voot.py`, `arms.py`         | Beta     | 2026-08-30 |
| F-ZONE  | Discrete zone-cluster MCTS           | `hierarchical_pw_voot.py`, `arms.py`         | Beta     | 2026-08-30 |
| F-PANIC | Panic state gate + mode              | `worker.py` (field), PAN1 pending            | Draft    | 2026-08-30 |
| F-NOPHY | No-physio graceful degradation       | `arms.py`, `worker.py`                       | Stable   | 2026-08-30 |
| F-SESSB | Session boundary / temporal gap      | `worker.py`, `hierarchical_pw_voot.py`       | Stable   | 2026-08-30 |
| F-TOPLD | LLM-based multilingual topic detect. | `observation_uncertainty.py`                 | Beta     | 2026-08-30 |
| F-EMERG | Emergency actions                    | `action_bandit.py`, `action_selector.js`     | Beta     | 2026-08-30 |
| F-FB1   | Qualitative feedback pass (FB1)      | `worker.py`                                  | Beta     | 2026-08-30 |
| F-SC1   | Stress calibration bonus (eustress)  | `physio_simulator.py`, `worker.py`           | Beta     | 2026-08-30 |
| F-AS4   | Inaction appropriateness bonus       | `physio_simulator.py`, `worker.py`           | Beta     | 2026-08-30 |
| F-AXDR  | Deliberated/Reflex axis gating       | `action_bandit.py`, `server.py`              | Beta     | 2026-08-30 |
| F-MULTI | Multi-language topic detection       | `observation_uncertainty.py`                 | Beta     | 2026-08-30 |

---

## Arms × Features Matrix

Key: `[x]`=active, `[a]`=inherited, `[−]`=ablated, `[ ]`=TODO, `[?]`=needs audit

| Exp | Arm Name (ARM id)                          | F-PHYS | F-MPS | F-MCTS | F-HPVOOT | F-INERT | F-COT | F-GOT | F-DPO | F-RAG-R | F-CGAT | F-A3C | F-ALLY | F-BGRF | F-OBS | F-PU1 | F-PU2 | F-PU3 | F-MHZON | F-ZONE | F-NOPHY | F-OBSRD |
|-----|---------------------------------------------|--------|-------|--------|----------|---------|-------|-------|-------|---------|--------|-------|--------|--------|-------|-------|-------|-------|---------|--------|---------|---------|
| 0   | `oldschool` (JS)                            | [x]    | [−]   | [−]    | [−]      | [−]     | [−]   | [−]   | [−]   | [x]     | [−]    | [−]   | [x]    | [−]    | [−]   | [−]   | [−]   | [−]   | [−]     | [−]    | [?]     | [−]     |
| 0a  | `oldschool_no_privacy`                      | [a]    | [−]   | [−]    | [−]      | [−]     | [−]   | [−]   | [−]   | [a]     | [−]    | [−]   | [a]    | [−]    | [−]   | [−]   | [−]   | [−]   | [−]     | [−]    | [?]     | [−]     |
| 0p  | `oldschool_dpo` (JS+DPO)                    | [a]    | [−]   | [−]    | [−]      | [−]     | [−]   | [−]   | [x]   | [a]     | [−]    | [−]   | [a]    | [−]    | [−]   | [−]   | [−]   | [−]   | [−]     | [−]    | [?]     | [−]     |
| 1   | `physio_llm`                                | [x]    | [−]   | [−]    | [−]      | [−]     | [−]   | [−]   | [−]   | [−]     | [x]    | [x]   | [x]    | [x]    | [x]   | [x]   | [x]   | [x]   | [−]     | [−]    | [x]     | [ ]     |
| 1a  | `physio_llm_no_crit_gate`                   | [a]    | [−]   | [−]    | [−]      | [−]     | [−]   | [−]   | [−]   | [−]     | [−]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 1p  | `physio_llm_dpo`                            | [a]    | [−]   | [−]    | [−]      | [−]     | [−]   | [−]   | [x]   | [−]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 2   | `physio_llm_cot_mcts`                       | [x]    | [−]   | [x]    | [−]      | [−]     | [x]   | [−]   | [−]   | [−]     | [x]    | [x]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [x]     | [ ]     |
| 2a  | `physio_llm_cot_mcts_no_crit_gate`          | [a]    | [−]   | [a]    | [−]      | [−]     | [a]   | [−]   | [−]   | [−]     | [−]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 2p  | `physio_llm_cot_mcts_dpo`                   | [a]    | [−]   | [a]    | [−]      | [−]     | [a]   | [−]   | [x]   | [−]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 3   | `physio_mps_mcts`                           | [x]    | [x]   | [x]    | [−]      | [−]     | [−]   | [−]   | [−]   | [−]     | [x]    | [x]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [x]     | [ ]     |
| 3a  | `physio_mps_mcts_no_crit_gate`              | [a]    | [a]   | [a]    | [−]      | [−]     | [−]   | [−]   | [−]   | [−]     | [−]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 3p  | `physio_mps_mcts_dpo`                       | [a]    | [a]   | [a]    | [−]      | [−]     | [−]   | [−]   | [x]   | [−]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 4   | `inertial_physio_mps_mcts`                  | [a]    | [a]   | [a]    | [−]      | [x]     | [−]   | [−]   | [−]   | [−]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 4a  | `inertial_physio_mps_mcts_no_crit_gate`     | [a]    | [a]   | [a]    | [−]      | [a]     | [−]   | [−]   | [−]   | [−]     | [−]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 4p  | `inertial_physio_mps_mcts_dpo`              | [a]    | [a]   | [a]    | [−]      | [a]     | [−]   | [−]   | [x]   | [−]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 5   | `inertial_physio_llm_cot_mcts`              | [a]    | [−]   | [a]    | [−]      | [x]     | [x]   | [−]   | [−]   | [−]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 5a  | `inertial_physio_llm_cot_mcts_no_crit_gate` | [a]    | [−]   | [a]    | [−]      | [a]     | [a]   | [−]   | [−]   | [−]     | [−]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 5p  | `inertial_physio_llm_cot_mcts_dpo`          | [a]    | [−]   | [a]    | [−]      | [a]     | [a]   | [−]   | [x]   | [−]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 6   | `inertial_hpvoot_physio_mps_mcts`           | [a]    | [a]   | [a]    | [x]      | [a]     | [−]   | [−]   | [−]   | [−]     | [a]    | [a]   | [a]    | [a]    | [x]   | [x]   | [x]   | [x]   | [−]     | [−]    | [a]     | [ ]     |
| 6a  | `inertial_hpvoot_physio_mps_mcts_no_crit`   | [a]    | [a]   | [a]    | [a]      | [a]     | [−]   | [−]   | [−]   | [−]     | [−]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 6p  | `inertial_hpvoot_physio_mps_mcts_dpo`       | [a]    | [a]   | [a]    | [a]      | [a]     | [−]   | [−]   | [x]   | [−]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 7   | `inertial_hpvoot_physio_llm_cot_mcts`       | [a]    | [−]   | [a]    | [x]      | [a]     | [x]   | [−]   | [−]   | [−]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 7a  | `inertial_hpvoot_physio_llm_cot_mcts_no_c`  | [a]    | [−]   | [a]    | [a]      | [a]     | [a]   | [−]   | [−]   | [−]     | [−]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 7p  | `inertial_hpvoot_physio_llm_cot_mcts_dpo`   | [a]    | [−]   | [a]    | [a]      | [a]     | [a]   | [−]   | [x]   | [−]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 8   | `plain_rag`                                 | [a]    | [−]   | [−]    | [−]      | [−]     | [−]   | [−]   | [−]   | [−]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 9   | `reason_rag`                                | [a]    | [−]   | [−]    | [−]      | [−]     | [x]   | [−]   | [−]   | [x]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 10  | `reason_rag_mps_mcts`                       | [a]    | [a]   | [a]    | [−]      | [−]     | [a]   | [−]   | [−]   | [a]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 11  | `reason_rag_inertial_hpvoot`                | [a]    | [a]   | [a]    | [a]      | [a]     | [a]   | [−]   | [−]   | [a]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 15  | `multi_horizon_hpvoot`                      | [a]    | [a]   | [a]    | [a]      | [a]     | [−]   | [−]   | [−]   | [−]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [x]     | [−]    | [a]     | [ ]     |
| 16  | `inertial_hpvoot_zone`                      | [a]    | [a]   | [a]    | [a]      | [a]     | [−]   | [−]   | [−]   | [−]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [x]    | [a]     | [ ]     |
| 17  | `got_hpvoot`                                | [a]    | [a]   | [a]    | [a]      | [a]     | [−]   | [x]   | [−]   | [−]     | [a]    | [a]   | [a]    | [a]    | [a]   | [a]   | [a]   | [a]   | [−]     | [−]    | [a]     | [ ]     |
| 18  | `belief_coupling_dpo` *(TODO: PU4)*         | [ ]    | [ ]   | [ ]    | [ ]      | [ ]     | [ ]   | [ ]   | [x]   | [ ]     | [ ]    | [ ]   | [x]    | [x]    | [x]   | [x]   | [x]   | [x]   | [−]     | [−]    | [ ]     | [ ]     |

---

## What's shared across all arms (common infrastructure)

All arms receive the following via `worker.py` at episode start regardless of arm type:

| Feature              | Injected via                          |
|----------------------|---------------------------------------|
| AllianceGraph context| `state.known_context` (PU2)           |
| BeliefGraph context  | `state.known_context` (PU1)           |
| CommRegime hint      | `state.known_context` (PU2)           |
| Reflex/panic mode    | `state.known_context` (PU3)           |
| ObservationUncertainty hint | `state.known_context` (OBS)    |
| Topic coupling update| `AllianceEdge.update_coupling_from_conversation()` per turn |
| A3CScorer (OBS signals) | `worker.py` scorer pass            |
| Session gap / boundary | `TurnState.session_gap_days`        |
| `panic_mode` field   | `TurnState.panic_mode`               |

---

## Missing combinations (experiment gaps)

| Gap | Description | Priority |
|-----|-------------|----------|
| BeliefGraph + HPVOOT + DPO | Exp 18 covers BeliefGraph + DPO; missing HPVOOT | 🟠 |
| GoT + RAG | GoT (Exp 17) does not use any RAG | 🟠 |
| ReasonRAG + DPO | Exp 9/10/11 have no preference learning | 🟠 |
| MultiHorizon + DPO | Exp 15 has no DPO | 🟡 |
| OBS robust discounting | `F-OBSRD` column is `[ ]` for all arms | 🔴 |
| Zone MCTS + CoT | Exp 16 has no CoT prior | 🟡 |
| GoT + MultiHorizon | Not combined | 🟡 |
| Alliance SA3.1 feedback | v_coupling not updated from A3C outcomes | 🟠 |
| BeliefGraph ablation | No arm where BeliefGraph is specifically removed to measure impact | 🟡 |
| 3-member coalition scenario | SA4.8 not yet tested | 🟡 |
| Panic state arm | PAN1 pending; no arm specifically tests panic handling | 🔴 |

---

## Feature implementation state summary

| Category          | Features | Stable | Beta | Draft | TODO |
|-------------------|----------|--------|------|-------|------|
| MCTS / Lookahead  | 8        | 3      | 4    | 1     | 0    |
| Social Graphs     | 6        | 0      | 2    | 4     | 0    |
| Belief Model      | 3        | 0      | 1    | 2     | 0    |
| Observation Model | 4        | 0      | 2    | 1     | 1    |
| Prompt Context    | 3        | 0      | 3    | 0     | 0    |
| Reward / Scoring  | 5        | 2      | 3    | 0     | 0    |
| Language / RAG    | 3        | 2      | 1    | 0     | 0    |
| Safety / Gates    | 3        | 3      | 0    | 0     | 0    |
