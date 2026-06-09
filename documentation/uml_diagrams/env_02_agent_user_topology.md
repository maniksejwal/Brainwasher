# Environment Diagram 2 — Agent and User Topology

> **View:** 4+1 Logical View (Kruchten) — who are the actors and what
> processes serve them.
>
> ## Companion model — one companion per user
>
> Each user has a **dedicated companion** — a logical agent whose
> identity is `(companionType, userId)`. The companion's state (facts,
> history, messages, physiological model, consent decisions) is
> permanently keyed to that user. It persists across sessions.
>
> The companion is **not** a class instance held in memory — it is a
> collection of DB-backed state tables and a stateless pipeline that
> reads and writes that state on every request. The pipeline code is
> shared; the state is per-user.
>
> A companion's **type** reflects the primary domain it operates in:
>
> | Companion type | Domain | Activated for roles |
> |---------------|--------|---------------------|
> | `medical` | Health, physiology, clinical | `patient`, `doctor` |
> | `professional` | Business, organisational | (currently unused in routing) |
> | `social` | Social dynamics, relationships | `caregiver` (partially) |
>
> Within a care circle, multiple users each have their own companion.
> The companions within a circle communicate with each other via
> `companion_confidential_messages` and `companion_intel_sharing`,
> mediated by `orchestrator.js` and `CompanionCoordinator.js`.
>
> ## Multi-role user — one companion per circle membership
>
> A single human holds one companion **per care circle they belong to**:
>
> ```
> Person "Alice"
>   Circle 001 (her own health)    → Alice's companion in Circle 001 (type=medical, role=patient)
>   Circle 002 (her mother)        → Alice's companion in Circle 002 (type=social,   role=caregiver)
>   Circle 003 (her practice)      → Alice's companion in Circle 003 (type=medical,  role=doctor)
> ```
>
> The companion adapts its **active role** from the circle membership
> record (`circle_members.role`). `/switch [circleId]` changes which
> companion is active. The companions in different circles are isolated
> by default (privacy) but can exchange signals via `companion_network`
> confidential messages (D9 — not yet implemented).

---

## Diagram A — Per-user companion topology within one care circle

This shows one care circle with three members, each with their own
companion, and how the companions relate to each other.

```mermaid
graph TD
    subgraph care_circle [Care Circle — e.g. Circle 001]

        subgraph patient_user [Patient — Alice]
            PA["👤 Alice\nrole = patient"]
            PComp["Alice's Companion\ncompanionType = medical\nuserId = alice\ncircleId = 001\n\nState: facts · history · HRV/MPS · consent decisions\nPipeline: core handlers + patientOptimizer"]
        end

        subgraph caregiver_user [Caregiver — Bob]
            CA["👥 Bob\nrole = caregiver"]
            CComp["Bob's Companion\ncompanionType = social\nuserId = bob\ncircleId = 001\n\nState: facts · history · caregiver burden state\nPipeline: core handlers only  ⚠ D8: no caregiverOptimizer"]
        end

        subgraph doctor_user [Doctor — Dr. Chen]
            DA["👨‍⚕️ Dr. Chen\nrole = doctor"]
            DComp["Dr. Chen's Companion\ncompanionType = medical\nuserId = drchen\ncircleId = 001\n\nState: facts · history · clinical decisions\nPipeline: core handlers + doctorOptimizer"]
        end

        subgraph inter_companion_layer [Inter-Companion Layer  within the circle]
            Orchestrator["orchestrator.js\nEvent bus  all three companions emit and listen\nRoutes: broadcast · escalate · future_plan_executed"]
            ConfMsg["companion_confidential_messages\nDirect companion-to-companion signals\nsenderType → receiverType  same userId  cross_user\nLevels: companion_only  companion_network  cross_user"]
            IntelShare["companion_intel_sharing\nShared intelligence between companions\nSource · target · intelligence_type · confidence"]
            InterventionQ["db/queries_interventions.js\nCross-user pending items\nEscalation · consent requests · surfaced items"]
        end

    end

    subgraph shared_infra [Shared Infrastructure  all companions use this]
        UnifiedAgent["unifiedAgent.js\nLLM executor  same code for all companions\nSPEAKER_ROLE tells LLM which companion is speaking"]
        ConsentMgr["consentManager.js\nDB-backed consent gate\nprivacyGuard output + circle_members.consent_level"]
        Bridge["tensornetsBridge.js → FastAPI :8765\nMPS · MCTS · A3C · htnJudge"]
    end

    PA -- "POST /api/message" --> PComp
    CA -- "POST /api/message" --> CComp
    DA -- "POST /api/message" --> DComp

    PComp -- "emit escalate" --> Orchestrator
    CComp -- "emit broadcast" --> Orchestrator
    DComp -- "emit escalate" --> Orchestrator

    PComp -- "send intel  conflict sync" --> ConfMsg
    CComp -- "read intel  conflict sync" --> ConfMsg
    DComp -- "read intel  conflict sync" --> ConfMsg

    PComp -- "share intelligence" --> IntelShare
    DComp -- "read intelligence" --> IntelShare

    PComp -- "write pending" --> InterventionQ
    CComp -- "read pending" --> InterventionQ
    DComp -- "read pending" --> InterventionQ

    Orchestrator -- "SSE broadcast\n⚠ D1: currently only to sending userId" --> PA
    Orchestrator -- "SSE broadcast\n⚠ D1: family may not be reached" --> CA
    Orchestrator -- "SSE broadcast" --> DA

    PComp --> UnifiedAgent
    CComp --> UnifiedAgent
    DComp --> UnifiedAgent

    PComp --> ConsentMgr
    CComp --> ConsentMgr

    PComp --> Bridge
    DComp --> Bridge
```

---

## Diagram B — Multi-role user: one person, multiple companions

Alice has three companion instances — one in each circle she belongs to.
Each is an independent logical agent with its own state. They are
isolated by default (privacy). Cross-role hints via `companion_network`
are the proposed (D9) but unimplemented bridge.

```mermaid
graph LR
    subgraph alice_user [Alice — one person, three circle memberships]
        A["👤 Alice"]
    end

    subgraph circle_001 [Circle 001 — Alice's own health]
        AC1["Alice's Companion\nrole = patient\ntype = medical\ncircle = 001\n\nState: Alice's health facts\nHRV/MPS model\ncompliance trajectory"]
    end

    subgraph circle_002 [Circle 002 — Alice's mother]
        AC2["Alice's Companion\nrole = caregiver\ntype = social\ncircle = 002\n\nState: Alice's caregiver messages\nMother's facts Alice has shared\ncaRegiver burden state"]
    end

    subgraph circle_003 [Circle 003 — Alice's clinical practice]
        AC3["Alice's Companion\nrole = doctor\ntype = medical\ncircle = 003\n\nState: Alice's clinical messages\nPatient facts Alice discussed\nclinical decisions"]
    end

    subgraph isolation [Privacy isolation boundary]
        Barrier["Facts do NOT cross circles without consent.\nRaw health data from Circle 001 is invisible\nto Alice's companion in Circle 002 or 003.\nThis is correct behaviour."]
    end

    subgraph d9_bridge [D9 — proposed cross-role hint  not yet implemented]
        Hint["companion_network confidential message\n{ type: cross_role_hint, sender_role: patient, wellness_flag: active_patient }\n\nNo raw facts — only role/status metadata.\nWould let Circle 002 companion know Alice is\nalso currently unwell, without leaking health data."]
    end

    A -- "/switch 001  active" --> AC1
    A -. "/switch 002" .-> AC2
    A -. "/switch 003" .-> AC3

    AC1 -. "companion_network signal\n(D9 — not yet implemented)" .-> AC2
    AC1 -. "companion_network signal\n(D9 — not yet implemented)" .-> AC3
```

---

## Diagram C — The companion pipeline (same code, different role context)

The pipeline code is **shared across all companions**. What differs per
companion is the `role` parameter and the DB state it reads/writes.

```mermaid
graph TD
    subgraph pipeline [companions/CompanionCoordinator.js  per-request invocation]

        Input["coordinateCompanions userId role message circleId ctx\nRole extracted from circle_members.role for this user in this circle"]

        subgraph stage1 [Stage 1 — Core Handlers  always run in parallel]
            IU["inputUnderstanding.js"]
            HA["historyAnalyzer.js"]
            EH["empathyHandler.js"]
            ST["stateTracker.js"]
            PG["privacyGuard.js\nLLM classifier PUBLIC  PRIVATE  SENSITIVE"]
        end

        subgraph stage2 [Stage 2 — Role-Specific Specialist]
            RB{"role = ?"}
            PO["patientOptimizer.js\nrole = patient"]
            DO["doctorOptimizer.js\nrole = doctor"]
            CO["⚠ none  D8\nrole = caregiver"]
        end

        subgraph stage2b [Stage 2 — Content-Triggered Specialists  keyword-gated]
            CL["clinicalAgent.js\npain  symptom  emergency"]
            ES["escalationManager.js\nHIGH  MEDIUM criticality"]
        end

        subgraph stage3 [Stage 3 — LLM Response Generation]
            UA["unifiedAgent.js\nSPEAKER_ROLE  PATIENT_USERNAME  USER_STATE\nSame model call for all roles"]
        end
    end

    Input --> stage1
    Input --> RB
    RB -- patient --> PO
    RB -- doctor --> DO
    RB -- caregiver --> CO
    Input -- "if medical keywords" --> CL
    CL -- "HIGH  MEDIUM" --> ES

    PO --> UA
    DO --> UA
    CL --> UA
```

---

## Role → Pipeline mapping (ground truth from `CompanionCoordinator.js:390–413`)

| Human role | `role` value | Specialist activated | Core handlers |
|-----------|-------------|---------------------|---------------|
| Patient | `patient` | `patientOptimizer.js` | All 5 |
| Caregiver / Family | `caregiver` | **none** ⚠ D8 | All 5 |
| Doctor / Clinician | `doctor` | `doctorOptimizer.js` | All 5 |
| Any (medical content) | any | `clinicalAgent.js` added | All 5 |
| Any (urgent content) | any | `escalationManager.js` added | All 5 |

---

## Confidentiality levels — `companion_confidential_messages`

| Level | Scope | Example use |
|-------|-------|-------------|
| `companion_only` | Originating companion's LLM context only | Internal reasoning trace |
| `companion_network` | All companions **for the same user** across all their circles | Cross-role wellness hint (D9) |
| `cross_user` | Companions of **other users** | Conflict notification between Alice's and Bob's companions |

The `cross_user` level is how companions belonging to **different people
in the same care circle** communicate — e.g. Alice's companion sends a
conflict notification to Bob's companion.

The `companion_network` level is how one user's companions across
**different circles** can share metadata (D9 — not yet used).

---

## Known Gaps (cross-referenced to `documentation/DISCREPANCIES.md`)

| ID | Severity | Status | Summary |
|----|----------|--------|---------|
| D1 | HIGH | 🔴 Open | Escalation SSE broadcast reaches only the sending `userId`, not all circle members |
| D2 | LOW | 🟢 Resolved | `consentManager.js` now separated from `privacyGuard.js` |
| D8 | MEDIUM | 🔴 Open | No `caregiverOptimizer.js` — caregivers have no specialist response generator |
| D9 | LOW | 🟡 Documented | No cross-role longitudinal awareness for multi-role users; `companion_network` channel exists but unused for this purpose |
