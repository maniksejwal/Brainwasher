# HTN Architecture Diagrams — Small-Scale Series

Each file in this folder contains **one diagram per file, one idea per diagram**, at a specific scale. They are designed to be embedded individually in the paper or patent filing without the readability problems of the large combined UML diagrams.

## Scale hierarchy

| Scale | Files | What it shows |
|---|---|---|
| System context | `01_dfd_level0_context.md` | External actors, system boundary, inputs/outputs |
| Physical deployment | `00_deployment.md` | Where each component runs: smartwatch → mobile → app server → tensor server → cloud |
| Architecture (data flow) | `02_dfd_level1_processes.md` | Five main processes and data flows between them |
| Component (single component) | `03_physio_pipeline.md` | HRV → stress index → HysteresisGate → MPS update |
| Component (single component) | `06_strategic_tactical_bridge.md` | MCTS → SVD → Mtrunc → [MCTS GUIDANCE] → LLM |
| Component (single component) | `07_companion_turn.md` | One full conversation turn: message in → SSE out |
| Component (single component) | `08_vint_propagation.md` | Social coupling: HRV delta → Vint → other companions |
| Component (single component) | `09_escalation.md` | Escalation triggers and consent-tier gates |
| Component (single component) | `10_consent_gate.md` | privacyGuard + consentManager decision flow |
| Algorithm | `04_mcts_loop.md` | MCTS four-phase iteration loop |
| Algorithm | `05_hpvoot_tiers.md` | Two-tier cluster→action search structure |

## Suggested paper placement

| Section | Diagram |
|---|---|
| §1 Introduction | `01_dfd_level0_context.md` (system context) |
| §3.1 Architecture overview | `00_deployment.md` + `02_dfd_level1_processes.md` |
| §3.3 Physiological encoding | `03_physio_pipeline.md` |
| §2.3.1 / §3.x MCTS | `04_mcts_loop.md` + `05_hpvoot_tiers.md` |
| §3.x Strategic-tactical | `06_strategic_tactical_bridge.md` |
| §3.13 Care circle | `07_companion_turn.md` + `08_vint_propagation.md` |
| §3.13.5 Escalation | `09_escalation.md` |
| §3.13.4 Consent | `10_consent_gate.md` |

## Relationship to existing large UML diagrams

The large diagrams in `../` (basic_message_flow, escalation_flow, consent_management, etc.) show the full system in single views. These small diagrams are **not replacements** — they zoom in on individual mechanisms for clarity. Use both: large diagrams for system overview, small diagrams for section-specific explanation.
