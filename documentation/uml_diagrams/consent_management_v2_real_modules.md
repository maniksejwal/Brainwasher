# Consent Management — v2 (real module names)

> **Supersedes:** `consent_management_v1_original.md`  
> **Original source:** Chat-output design sketch using role-abstraction / design-intent names.  
> **This version:** Rewritten to reflect actual codebase module paths verified against `companions/handlers/privacyGuard.js`, `companions/CompanionCoordinator.js`, `db/queries_interventions.js`, `companions/agents/patientOptimizer.js`, and `agents/unifiedAgent.js`.

## How v2 differs from v1

| Dimension | v1 (original) | v2 (this file) |
|-----------|--------------|----------------|
| Participant names | Role abstractions / design-intent names: `PersonalAgent A`, `Orchestrator`, `SharingHandler`, `ConsentManager`, `StateManager`, `CareAgent B`. PersonalAgent/CareAgent correctly represent role-specific agents. `ConsentManager` represents a planned module (see `DISCREPANCIES.md §D2`). | Real module paths: `server.js`, `contextAwareCompanionRouter.js`, `CompanionCoordinator.js`, `privacyGuard.js`, `state_manager.js`, `db/queries_interventions.js`, `patientOptimizer.js`, `unifiedAgent.js` |
| Consent taxonomy | "Implied / Explicit / No Consent" — maps directly to the DB `consent_level` field and `getImpliedConsent()`. These are valid and important distinctions. | NONE / LIMITED / FULL / EMERGENCY — this is the `privacyLevel` output from the LLM classifier, **a different concept** from `consent_level`. See `DISCREPANCIES.md §D7` for the full taxonomy reconciliation. Both taxonomies should appear in the documentation. |
| Classification mechanism | `ConsentManager` queries a consent table | `privacyGuard.js` performs LLM-based classification of the share request content |
| Emergency path | Not modelled | Emergency override path explicitly shown — bypasses normal consent checks, logs `consent_emergency/EMERGENCY` |
| Consent question generation | `CareAgent B` asks `User B` for consent | `patientOptimizer` + `unifiedAgent` + Scout LLM generate the consent question to send back to the requesting user |
| Audit trail | Not modelled | All consent decisions (pending, granted, emergency) are logged to `db/queries_interventions.js` |
| Second-party consent request | `User B` provides consent response in same sequence | Pending consent stored in `state_manager.js`; second-party response handled asynchronously (not in same sequence) |

## How v1 and v2 align

Both versions model the same **conceptual consent gate**: a sharing request is evaluated, either approved immediately (if consent already exists) or deferred pending explicit consent from the target party. The abstract components in v1 map to real modules in v2:

| v1 concept | v2 module |
|------------|-----------|
| `PersonalAgent A` | `handlers/contextAwareCompanionRouter.js` + `CompanionCoordinator.js` |
| `Orchestrator` | `CompanionCoordinator.js` |
| `SharingHandler` | `CompanionCoordinator.js` (orchestrates the full consent flow) |
| `ConsentManager` | `companions/handlers/privacyGuard.js` |
| `StateManager` | `state_manager.js` (pending action queue) |
| `Database` | `SQLite care_circle_dev.db` via `db/queries_interventions.js` |

## Sequence Diagram

```mermaid
sequenceDiagram
    actor User
    participant server as server.js<br/>(Express / SSE)
    participant router as handlers/contextAwareCompanionRouter.js
    participant coord as companions/CompanionCoordinator.js<br/>(coordinateCompanions)
    participant privacy as companions/handlers/privacyGuard.js
    participant state_mgr as state_manager.js<br/>(pending action queue)
    participant interventions as db/queries_interventions.js
    participant db as SQLite care_circle_dev.db
    participant optimizer as companions/agents/patientOptimizer.js
    participant agent as agents/unifiedAgent.js<br/>(processUserMessage)
    participant llm as agents/api/ (Scout LLM)

    User->>server: POST /api/message { text: "Share my pain log with Dr. Smith", circleId, role }
    server->>router: route(req, res)
    router->>coord: coordinateCompanions(req, context)

    coord->>privacy: classifyShareRequest(text, targetRole, circleId)
    Note over privacy: Consent taxonomy:<br/>NONE / LIMITED / FULL / EMERGENCY
    privacy-->>coord: { classification: "SENSITIVE" | "PRIVATE" | "PUBLIC", consentLevel }

    alt classification is SENSITIVE (consentLevel = NONE)
        coord-->>server: deny — sharing blocked unconditionally
        server-->>User: SSE { message: "This information cannot be shared." }

    else classification is PRIVATE (consentLevel = LIMITED or NONE)
        coord->>privacy: checkExistingConsent(circleId, userId, targetRole)
        privacy->>db: SELECT consent WHERE circleId AND userId AND targetRole
        db-->>privacy: consentRecord | null

        alt No existing consent on record
            coord->>state_mgr: enqueuePendingAction({ type: "CONSENT_REQUEST", circleId, targetRole, requestedData })
            state_mgr-->>coord: { pendingId, queued: true }

            coord->>interventions: logConsentPending(circleId, userId, targetRole, requestedData)
            interventions->>db: INSERT interventions (type='consent_pending', status='awaiting')
            db-->>interventions: rowId

            coord->>optimizer: generateConsentQuestionResponse(targetRole, requestedData)
            optimizer->>agent: processUserMessage(consentPrompt, context)
            agent->>llm: chat completion — ask user to confirm consent
            llm-->>agent: consent question text
            agent-->>optimizer: generatedText
            optimizer-->>coord: consentQuestion

            coord-->>server: consentQuestion
            server-->>User: SSE { message: consentQuestion, meta: { awaitingConsent: true, pendingId } }

        else Existing consent = LIMITED — data subset allowed
            coord->>interventions: logConsentDecision(circleId, userId, targetRole, level: "LIMITED")
            interventions->>db: INSERT interventions (type='consent_granted', level='LIMITED')
            db-->>interventions: rowId

            coord->>optimizer: generateSharingConfirmationResponse(level: "LIMITED")
            optimizer->>agent: processUserMessage(sharingPrompt, context)
            agent->>llm: chat completion — confirm limited share
            llm-->>agent: confirmation text
            agent-->>optimizer: generatedText
            optimizer-->>coord: confirmationResponse
            coord-->>server: confirmationResponse
            server-->>User: SSE { message: confirmationResponse, meta: { consentLevel: "LIMITED" } }

        else Existing consent = FULL — all data allowed
            coord->>interventions: logConsentDecision(circleId, userId, targetRole, level: "FULL")
            interventions->>db: INSERT interventions (type='consent_granted', level='FULL')
            db-->>interventions: rowId
            coord-->>server: proceed with sharing
            server-->>User: SSE { message: "Sharing approved.", meta: { consentLevel: "FULL" } }
        end

    else classification is PUBLIC (consentLevel = FULL — implicit)
        coord->>interventions: logConsentDecision(circleId, userId, targetRole, level: "FULL")
        interventions->>db: INSERT interventions (type='consent_granted', level='FULL')
        db-->>interventions: rowId
        coord-->>server: allow sharing immediately
        server-->>User: SSE { message: "Information shared with Dr. Smith." }
    end

    rect rgb(240, 248, 255)
        Note over coord,server: EMERGENCY OVERRIDE PATH
        coord->>privacy: checkEmergencyFlag(circleId)
        privacy-->>coord: { emergency: true, authorizedBy: "system" }
        coord->>interventions: logConsentDecision(circleId, userId, targetRole, level: "EMERGENCY")
        interventions->>db: INSERT interventions (type='consent_emergency', level='EMERGENCY')
        db-->>interventions: rowId
        coord-->>server: emergency share authorised
        server-->>User: SSE { message: "Emergency share authorised.", meta: { consentLevel: "EMERGENCY" } }
    end
```

## Key Interactions

1. **User → server.js**: User's sharing request arrives as a natural-language message.
2. **privacyGuard classification**: Content is assigned one of four consent levels — NONE / LIMITED / FULL / EMERGENCY — using LLM-based classification.
3. **SENSITIVE path (NONE)**: Sharing is denied immediately; no database writes occur.
4. **PRIVATE path — no consent**: `state_manager.js` queues a pending consent action; `db/queries_interventions.js` logs it as `consent_pending`; a consent question is generated and sent to the user.
5. **PRIVATE path — LIMITED consent**: Sharing proceeds for the permitted data subset; decision is logged as `consent_granted/LIMITED`.
6. **PRIVATE path — FULL consent**: Sharing proceeds in full; decision is logged as `consent_granted/FULL`.
7. **PUBLIC path**: Implicit FULL consent; sharing proceeds immediately with an audit log entry.
8. **Emergency override**: An out-of-band flag on the circle bypasses normal consent checks and logs the decision as `consent_emergency/EMERGENCY`.

## Component Roles

| Module | Role |
|--------|------|
| `server.js` | Express HTTP server; SSE broadcaster |
| `handlers/contextAwareCompanionRouter.js` | Routes request to the appropriate domain companion |
| `companions/CompanionCoordinator.js` | Orchestrates the full consent decision flow |
| `companions/handlers/privacyGuard.js` | LLM classifier that assigns NONE / LIMITED / FULL / EMERGENCY consent level |
| `state_manager.js` | Intent-classified pending action queue; holds unanswered consent requests |
| `db/queries_interventions.js` | Logs consent decisions and pending items to the interventions table |
| `companions/agents/patientOptimizer.js` | Generates consent question or confirmation message |
| `agents/unifiedAgent.js` | Executes LLM calls for response generation |
| `agents/api/` | Multi-provider LLM layer (Scout / Maverick / Bedrock) |
| `SQLite care_circle_dev.db` | Persistent store; `consent` and `interventions` tables |

## Data Flow

```
User sharing request
  → privacy classification (privacyGuard)
      SENSITIVE / NONE → deny — no DB write
      PRIVATE →
          check existing consent (privacyGuard → SQLite)
              NONE → enqueue pending (state_manager) + log (db/queries_interventions) + ask user
              LIMITED → log + confirm limited share
              FULL → log + confirm full share
      PUBLIC / implicit FULL → log + share immediately
      EMERGENCY override → log EMERGENCY + share immediately
  → SSE reply to User
```

---

> **Note:** This diagram uses real module file names from the codebase. Earlier versions used role-abstraction / design-intent names (ActionExecutor, FactReportingHandler, CriticalEventsHandler, ConsentManager, SharingHandler). Those names correctly represent the conceptual architecture — the v1 names like `PersonalAgent`, `CareAgent`, `Doctor`, `Caregiver` map to `role` values in the `care_circle_members` table, not to separate module files.
