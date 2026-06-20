# Diagram Index

This file is the single reference for every diagram in the project.
- Source files: `documentation/uml_diagrams/` and `documentation/uml_diagrams/htn_architecture/`
- Exported images: `figures/uml/` and `figures/uml/htn_architecture/`
- Re-export all images: `python scripts/export_mermaid.py`

---

## Part A — Large System Diagrams  (`uml_diagrams/`)

These diagrams show the full system from multiple perspectives. They are suitable for architecture overviews and appendices.

### Environment / deployment diagrams  (`env_*`)

| Source file | Exported image(s) | Scale | What it shows |
|---|---|---|---|
| `env_01_physical_deployment.md` | `env_01_physical_deployment.png` | Physical | Full Node.js + Python + DB deployment topology |
| `env_02_agent_user_topology.md` | `env_02_agent_user_topology_1.png` | Logical | Per-user companion topology (one companion per user) |
| | `env_02_agent_user_topology_2.png` | Logical | Multi-role user: one human, multiple care circles |
| | `env_02_agent_user_topology_3.png` | Logical | Companion pipeline (configurable, not three separate stacks) |
| `env_03_rl_environment_pomdph.md` | `env_03_rl_environment_pomdph_1.png` | Training | POMDP-H state machine with 8-arm capability ladder |
| | `env_03_rl_environment_pomdph_2.png` | Training | Reward function breakdown |
| | `env_03_rl_environment_pomdph_3.png` | Training | A3C worker ↔ global policy update loop |
| `env_04_information_flow.md` | `env_04_information_flow.png` | Process | End-to-end production data flow for one conversation turn |
| `env_05_care_circle_social_graph.md` | `env_05_care_circle_social_graph_1.png` | Logical | Care circle social graph with Vint coupling weights |
| | `env_05_care_circle_social_graph_2.png` | Logical | Multi-circle user: isolated companion instances |
| `env_06_training_environment.md` | `env_06_training_environment_1.png` | Training | 8-arm capability ladder table |
| | `env_06_training_environment_2.png` | Training | Training episode lifecycle |

### Interaction / sequence diagrams  (v1 original vs. v2 real modules)

Each scenario has two versions: `_v1_original.md` is the original design; `_v2_real_modules.md` reflects the actual implemented module names. See the prologue of each v2 file for the differences.

| Source file | Exported image | Scenario |
|---|---|---|
| `basic_message_flow_v1_original.md` | `basic_message_flow_v1_original.png` | Original message flow design |
| `basic_message_flow_v2_real_modules.md` | `basic_message_flow_v2_real_modules.png` | Actual flow: server.js → orchestrator → CompanionCoordinator → tensornetsBridge → LLM → SSE |
| `consent_management_v1_original.md` | `consent_management_v1_original.png` | Original consent design |
| `consent_management_v2_real_modules.md` | `consent_management_v2_real_modules.png` | Actual flow: privacyGuard.js (LLM classifier) + consentManager.js (DB gate) |
| `context_switching_v1_original.md` | `context_switching_v1_original.png` | Original context switching design |
| `context_switching_v2_real_modules.md` | `context_switching_v2_real_modules.png` | Actual /switch [circleId] flow through orchestrator |
| `escalation_flow_v1_original.md` | `escalation_flow_v1_original.png` | Original escalation design |
| `escalation_flow_v2_real_modules.md` | `escalation_flow_v2_real_modules.png` | Actual: MCTS path A + futurePlanningAgent path B + 4-tier consent gate |
| `conflict_resolution_v1_original.md` | `conflict_resolution_v1_original.png` | Original conflict resolution design |
| `conflict_resolution_v2_real_modules.md` | `conflict_resolution_v2_real_modules.png` | Actual: orchestrator adjudication + Vint-weighted priority |

---

## Part B — Small-Scale Focused Diagrams  (`uml_diagrams/htn_architecture/`)

One idea per diagram. Designed for embedding in individual paper sections without readability problems.

### By scale

#### System context

| Source file | Exported image | One idea |
|---|---|---|
| `01_dfd_level0_context.md` | `htn_architecture/01_dfd_level0_context.png` | External actors, system boundary, all inputs and outputs |

#### Physical deployment

| Source file | Exported image(s) | One idea |
|---|---|---|
| `00_deployment.md` | `htn_architecture/00_deployment_1.png` | Smartwatch → mobile → app server → tensor server → cloud LLM, with per-node responsibility table |
| | `htn_architecture/00_deployment_2.png` | Lightweight (edge/app) vs. compute-heavy (tensor server) vs. cloud split |

#### Architecture / data flow

| Source file | Exported image | One idea |
|---|---|---|
| `02_dfd_level1_processes.md` | `htn_architecture/02_dfd_level1_processes.png` | Five main processes (P1 physiological encoding, P2 state update, P3 MCTS planning, P4 response generation, P5 care circle coordination) with data stores |

#### Component level

| Source file | Exported image(s) | One idea |
|---|---|---|
| `03_physio_pipeline.md` | `htn_architecture/03_physio_pipeline.png` | Wearable signals → OU process → weighted stress index → Schmitt-trigger HysteresisGate → zone + MPS update |
| `06_strategic_tactical_bridge.md` | `htn_architecture/06_strategic_tactical_bridge_1.png` | MCTS optimal path → unfold → SVD → Mtrunc truncation → [MCTS GUIDANCE] prompt injection → LLM → SSE |
| | `htn_architecture/06_strategic_tactical_bridge_2.png` | What SVD truncation keeps (dominant directions) vs. discards (noise) |
| `07_companion_turn.md` | `htn_architecture/07_companion_turn.png` | Full single conversation turn: HTTP message in → router → coordinator (5 parallel handlers) → tensor bridge → LLM → SSE out, with latency budget |
| `08_vint_propagation.md` | `htn_architecture/08_vint_propagation_1.png` | HRV delta × Vint coupling weight → adjacent companion HRV slots, with privacy gate |
| | `htn_architecture/08_vint_propagation_2.png` | Hysteretic alliance dead-band: A3C signal → HystereticVIntStore → persistent per-circle coupling |
| `09_escalation.md` | `htn_architecture/09_escalation_1.png` | Three trigger paths (MCTS / future-plan / user-initiated) converging on four-tier consent-graduated gate |
| | `htn_architecture/09_escalation_2.png` | Three escalation sources → single unified pipeline (orchestrator.js) |
| `10_consent_gate.md` | `htn_architecture/10_consent_gate_1.png` | privacyGuard.js classification → consentManager.js tier check → allow / anonymise / deny |
| | `htn_architecture/10_consent_gate_2.png` | Three confidentiality channel levels: companion_only, companion_network, cross_user |

#### Algorithm level

| Source file | Exported image(s) | One idea |
|---|---|---|
| `04_mcts_loop.md` | `htn_architecture/04_mcts_loop_1.png` | MCTS four-phase loop: Select → Expand → Simulate → Backpropagate (80–150 iterations) |
| | `htn_architecture/04_mcts_loop_2.png` | Tier structure within SELECT: Tier 1 (UCB-V cluster) → Tier 2 (UCB1 action) |
| `05_hpvoot_tiers.md` | `htn_architecture/05_hpvoot_tiers_1.png` | Two-tier cluster→action tree with zone-seeded priors and UCB-V score equation broken into labelled terms |
| | `htn_architecture/05_hpvoot_tiers_2.png` | Visit-count comparison: flat MCTS (~3 visits/arm) vs. two-tier (~25 Tier-1, ~19 Tier-2) |

---

## Part C — Generated data figures  (`figures/`)

Produced by `python scripts/gen_figures.py`.

| File | What it shows | Paper section |
|---|---|---|
| `figures/fig_run018_bars.pdf` | Per-arm episode completion rates, run 018 (8 arms) | §4.7 Preliminary Results |
| `figures/fig_stress_trajectories.pdf` | Simulated stress index trajectories under STANDARD vs. FLOODING reward mode | §3.12.3 Flooding |
| `figures/fig_v_int_prior.pdf` | Vint prior values as a grouped bar chart (6 directed role pairs) | §3.13.6 Social Prior Matrix |
| `figures/fig_pkpd.pdf` | Two-timescale SSRI PK/PD model: plasma concentration vs. symptom trajectory | §1.3.2 Anti-Depressants |
| `figures/fig_vint_coupling.pdf` | Asymmetric 3×3 Vint heatmap (patient–caregiver–clinician) with coupling values | §3.13.6 / Fig 12 in PDF |

---

## Suggested paper figure assignments

| PDF Figure | Best diagram image | Section |
|---|---|---|
| Fig 1 (dual-rank architecture) | `htn_architecture/06_strategic_tactical_bridge_1.png` | §1 / §3.12 |
| Fig 8 (strategic-tactical separation) | `htn_architecture/06_strategic_tactical_bridge_1.png` | §3.12 |
| Fig 10 (care circle topology) | `env_02_agent_user_topology_1.png` | §3.13.1 |
| Fig 11 (end-to-end data flow) | `env_04_information_flow.png` or `htn_architecture/07_companion_turn.png` | §3.13.3 |
| Fig 12 (Vint heatmap) | `figures/fig_vint_coupling.pdf` | §3.13.6 |
| Appendix (deployment) | `htn_architecture/00_deployment_1.png` | Appendix |
| Appendix (DFD Level 0) | `htn_architecture/01_dfd_level0_context.png` | Appendix |
| Appendix (DFD Level 1) | `htn_architecture/02_dfd_level1_processes.png` | Appendix |
| Appendix (physio pipeline) | `htn_architecture/03_physio_pipeline.png` | Appendix |
| Appendix (MCTS loop) | `htn_architecture/04_mcts_loop_1.png` | Appendix |
| Appendix (HPVOOT tiers) | `htn_architecture/05_hpvoot_tiers_1.png` | Appendix |
| Appendix (escalation) | `htn_architecture/09_escalation_1.png` | Appendix |
| Appendix (consent gate) | `htn_architecture/10_consent_gate_1.png` | Appendix |
