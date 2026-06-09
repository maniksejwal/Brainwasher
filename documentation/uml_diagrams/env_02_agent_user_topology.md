# Environment Diagram 2 — Agent and User Topology

> **View:** 4+1 Logical View (Kruchten) — who are the actors and what
> processes serve them.  
> **Purpose:** Shows the three human principals, their companion agents,
> the inter-companion coordination layer, and the ML inference layer.

## Topology Diagram

```mermaid
graph TD
    subgraph principals [Human Principals]
        Patient["👤 Patient\n(role = patient)"]
        Caregiver["👥 Caregiver / Family\n(role = caregiver)"]
        Clinician["👨‍⚕️ Doctor / Clinician\n(role = doctor)"]
    end

    subgraph patient_companion [Patient Companion Stack]
        PCC["CompanionCoordinator\n(patient instance)"]
        POptimizer["patientOptimizer.js\nRole-specific response\ngenerator"]
        PClinical["clinicalAgent.js\nCriticality assessment"]
        PEscalation["escalationManager.js\nCriticality → escalation decision"]
        PFuture["futurePlanningAgent.js\nScheduled interventions"]
        PPrivacy["privacyGuard.js\nPrivacy classification\n+ consent gate"]
        PHandlers["Core Handlers\ninputUnderstanding\nhistoryAnalyzer\nempathyHandler\nstateTracker"]
    end

    subgraph caregiver_companion [Caregiver Companion Stack]
        CGcc["CompanionCoordinator\n(caregiver instance)"]
        CGopt["caregiverOptimizer\nRole-specific response"]
        CGhandlers["Core Handlers\n(same set as patient)"]
        CGprivacy["privacyGuard.js\n(caregiver context)"]
    end

    subgraph doctor_companion [Doctor Companion Stack]
        DCC["CompanionCoordinator\n(doctor instance)"]
        DOptimizer["doctorOptimizer.js\nRole-specific response\ngenerator"]
        DHandlers["Core Handlers\n(same set)"]
        DPrivacy["privacyGuard.js\n(doctor context)"]
    end

    subgraph inter_companion [Inter-Companion Layer]
        OrchestratorBus["orchestrator.js\n(EventEmitter event bus)\nRoutes: broadcast · escalate\nfuture_plan_executed"]
        ConfComm["CompanionConfidentialComm.js\nPeer companion signalling\n(conflict sync, intel sharing)"]
        InterventionQ["db/queries_interventions.js\nCross-user intervention queue\n(MEDIUM escalations,\nconsent requests, surfaced items)"]
    end

    subgraph ml_layer [ML / Physio Layer — shared by all companions]
        Bridge["tensornetsBridge.js\nJS→Python bridge"]
        FastAPI_ML["FastAPI :8765\nMPS · MCTS · A3C\nLongitudinal hint\nTensor RAG"]
    end

    subgraph llm_layer [LLM Layer — shared]
        UnifiedAgent["unifiedAgent.js\nProvider-agnostic\nLLM executor"]
        Scout["Scout LLM\n(AWS Bedrock)"]
        Maverick["Maverick LLM\n(LLM-as-judge)"]
    end

    Patient -- "POST /api/message" --> PCC
    Caregiver -- "POST /api/message" --> CGcc
    Clinician -- "POST /api/message" --> DCC

    PCC --> PHandlers
    PCC --> POptimizer
    PCC --> PClinical
    PCC --> PEscalation
    PCC --> PFuture
    PCC --> PPrivacy
    PCC --> Bridge

    CGcc --> CGhandlers
    CGcc --> CGopt
    CGcc --> CGprivacy
    CGcc --> Bridge

    DCC --> DHandlers
    DCC --> DOptimizer
    DCC --> DPrivacy
    DCC --> Bridge

    POptimizer --> UnifiedAgent
    CGopt --> UnifiedAgent
    DOptimizer --> UnifiedAgent
    UnifiedAgent --> Scout
    UnifiedAgent --> Maverick

    Bridge --> FastAPI_ML

    PEscalation -- "emit escalate" --> OrchestratorBus
    PFuture -- "emit future_plan_executed" --> OrchestratorBus
    PCC -- "write pending items" --> InterventionQ
    CGcc -- "read pending items" --> InterventionQ
    DCC -- "read pending items" --> InterventionQ

    OrchestratorBus -- "SSE broadcast\n(⚠ currently only to userId,\nnot all circle members)" --> Patient
    OrchestratorBus -- "SSE broadcast\n(⚠ gap: family not always reached)" --> Caregiver
    OrchestratorBus -- "SSE broadcast" --> Clinician

    PCC -- "conflict sync" --> ConfComm
    CGcc -- "conflict sync" --> ConfComm
    DCC -- "conflict sync" --> ConfComm
```

## Role → Agent mapping

| Human role | `role` value | Primary agent | Response optimizer |
|-----------|-------------|---------------|--------------------|
| Patient | `patient` | `CompanionCoordinator` (patient instance) | `patientOptimizer.js` |
| Caregiver / Family | `caregiver` | `CompanionCoordinator` (caregiver instance) | `caregiverOptimizer` |
| Doctor / Clinician | `doctor` | `CompanionCoordinator` (doctor instance) | `doctorOptimizer.js` |

> **Note:** "Patient Companion" and "Doctor Companion" are not separate
> files — they are the same `CompanionCoordinator.js` module instantiated
> per-request with a different `role` value. The `getRelevantHandlers()`
> function selects role-specific sub-agents based on `role`.

## Confidentiality levels (CompanionConfidentialComm)

| Level | Meaning | Example use |
|-------|---------|-------------|
| `companion_only` | Only the sending companion's own LLM context | Internal reasoning trace |
| `companion_network` | All companions for the same user | Role switch sync |
| `cross_user` | May be shared with companions of other users | Conflict notification, intel sharing |

## Known Gaps (see `documentation/DISCREPANCIES.md`)

- Escalation SSE broadcast does not fan out to all circle members — Caregiver/Family and Doctor only receive escalation if their `userId` is known to the orchestrator at the time of the event.
- No dedicated `consentManager.js` — consent logic is embedded in `privacyGuard.js` (see `DISCREPANCIES.md` §D2).
