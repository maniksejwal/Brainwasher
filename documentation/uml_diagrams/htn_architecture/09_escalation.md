# Escalation Decision Tree

**Scale:** Component level
**One idea:** All paths that can trigger an escalation and how the consent tier gates information flow

```mermaid
flowchart TD
    TURN_END(["Companion turn complete"])

    PATH_A{"Path A\nMCTS action\n= escalate?"}
    PATH_B{"Path B\nfuturePlanningAgent\nfuture_plan_executed?"}
    PATH_U{"User-initiated\nclinicalAgent detects\nhigh criticality?"}

    STRESS_CHECK{"Stress level s?"}
    HIGH_ESC["HIGH escalation\ns > 0.90\nSSE broadcast to ALL circle members immediately"]
    MED_ESC["MEDIUM escalation\n0.85 ≤ s ≤ 0.90\nIntervention queue\n+ doctor notify only"]

    DB_ESC["db.addEscalation()\ndirectly via orchestrator.js"]

    subgraph CONSENT_GATE["Four-tier consent-graduated gate"]
        T1["T1 — Ask permission\nMEDIUM + confidence < 0.6\nnothing shared without consent"]
        T2["T2 — Notify caregiver\nanonymously\nMEDIUM + confidence ≥ 0.6"]
        T3["T3 — Anonymous doctor\nconsultation\nMEDIUM + confidence ≥ 0.8"]
        T4["T4 — Full disclosure\nHIGH or CRITICAL\nany confidence"]
    end

    OUTCOMES(["Outcomes:\n• patient notified\n• caregiver alert (anonymised)\n• doctor consultation\n• full care circle broadcast"])

    TURN_END --> PATH_A & PATH_B & PATH_U
    PATH_A -- yes --> STRESS_CHECK
    PATH_U -- yes --> STRESS_CHECK
    STRESS_CHECK -- "s > 0.90" --> HIGH_ESC
    STRESS_CHECK -- "0.85 ≤ s ≤ 0.90" --> MED_ESC
    PATH_B -- yes --> DB_ESC

    HIGH_ESC --> T4
    MED_ESC --> T1 & T2 & T3
    DB_ESC --> T3

    T1 & T2 & T3 & T4 --> OUTCOMES
```

## Consent tier summary

| Tier | Trigger | What is shared | With whom |
|---|---|---|---|
| T1 | MEDIUM, confidence < 0.6 | Nothing — system asks patient permission first | Patient only |
| T2 | MEDIUM, confidence ≥ 0.6 | Anonymised alert (no message content) | Caregiver |
| T3 | MEDIUM, confidence ≥ 0.8 | Anonymised consultation request | Clinician |
| T4 | HIGH or CRITICAL | Full context | All circle members |

## Escalation sources

```mermaid
flowchart LR
    SRC1["MCTS planner\naction = escalate\n(s > 0.85 threshold)"]
    SRC2["Future planning agent\nscheduled plan triggered"]
    SRC3["Patient explicit request\n'I need to speak to my doctor'\nclinicalAgent high criticality"]

    ESC_PIPE["Unified escalation pipeline\norchestrator.js"]

    SRC1 & SRC2 & SRC3 --> ESC_PIPE
```

All three sources route through the same pipeline. SRC3 (user-initiated) is detected by `clinicalAgent.js` classifying message criticality and then routing through Path A.
