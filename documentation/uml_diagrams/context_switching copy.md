# Context Switching

## Sequence Diagram

```mermaid
sequenceDiagram
    actor User
    participant server as server.js<br/>(Express / SSE)
    participant cmd as handlers/commandHandler.js
    participant router as handlers/contextAwareCompanionRouter.js
    participant domain as handlers/domainRouter.js
    participant coord as companions/CompanionCoordinator.js<br/>(coordinateCompanions)
    participant bridge as companions/physio/tensornetsBridge.js
    participant fastapi as FastAPI tensornets/server.py :8765
    participant db as SQLite care_circle_dev.db
    participant state as companions/handlers/stateTracker.js
    participant optimizer as companions/agents/patientOptimizer.js
    participant agent as agents/unifiedAgent.js<br/>(processUserMessage)
    participant llm as agents/api/ (Scout LLM)

    User->>server: POST /api/command { command: "/switch", circleId: "X", role: "caregiver" }
    server->>cmd: handleCommand(req, res)
    cmd->>cmd: parseCommand("/switch", { circleId: "X", role: "caregiver" })

    cmd->>db: SELECT circle_members WHERE circleId = "X" AND userId = currentUser
    db-->>cmd: membershipRecord | null

    alt Membership check fails (user not in circle X)
        cmd-->>server: { error: "ACCESS_DENIED", circleId: "X" }
        server-->>User: SSE { error: "You are not a member of circle X." }
    else Membership check passes
        cmd->>router: rerouteContext({ circleId: "X", role: "caregiver" })
        router->>domain: isolateDomain(circleId: "X", role: "caregiver")
        domain-->>router: { domain: "medical", circleId: "X", role: "caregiver" }
        router-->>cmd: routingContext confirmed

        cmd->>coord: coordinateCompanions(req, { circleId: "X", role: "caregiver", reinitialise: true })

        coord->>state: resetState(prevCircleId, newCircleId: "X", newRole: "caregiver")
        state-->>coord: freshStateSnapshot

        coord->>bridge: resetPhysioSession(circleId: "X")
        bridge->>fastapi: POST /session_reset { circleId: "X" }
        fastapi-->>bridge: { reset: true, newSessionId }
        bridge-->>coord: physioSessionReset confirmed

        coord->>db: SELECT circle_context WHERE circleId = "X"
        db-->>coord: { members[], goals[], recentEvents[], activeInterventions[] }

        coord->>optimizer: generateContextSwitchGreeting(role: "caregiver", circleId: "X", context)
        optimizer->>agent: processUserMessage(switchPrompt, newContext)
        agent->>llm: chat completion — first response in new context
        llm-->>agent: greeting text
        agent-->>optimizer: generatedText
        optimizer-->>coord: switchGreeting

        coord-->>server: { switchGreeting, meta: { circleId: "X", role: "caregiver", sessionId: newSessionId } }
        server-->>User: SSE { message: switchGreeting, meta: { circleId: "X", role: "caregiver" } }
    end
```

## Key Interactions

1. **User → server.js**: `/switch` command arrives with the target `circleId` and the new `role`.
2. **commandHandler**: Parses the command and performs the membership gate check against SQLite before any routing occurs.
3. **Invalid access path**: If the user is not a member of the target circle, an `ACCESS_DENIED` error is returned immediately and the switch is aborted.
4. **contextAwareCompanionRouter re-route**: Routes the session to the new `circleId`/`role` combination in the correct domain.
5. **domainRouter isolation**: Ensures the new circleId maps to the correct domain (medical vs. business) before handing back to the router.
6. **CompanionCoordinator re-initialisation**: `coordinateCompanions` is called with `reinitialise: true`, which resets all in-memory state for the new role.
7. **stateTracker reset**: Clears the prior circle's state snapshot and creates a fresh one for circle X.
8. **tensornetsBridge session reset**: Notifies the FastAPI Python server that the physiological session for the old circle has ended and a new one has started for circle X.
9. **SQLite context load**: Full circle context (members, goals, recent events, active interventions) is fetched for the new circle.
10. **First response**: `patientOptimizer` generates a greeting tailored to the new caregiver role and circle context.

## Component Roles

| Module | Role |
|--------|------|
| `server.js` | Express HTTP server; SSE broadcaster |
| `handlers/commandHandler.js` | Processes `/commands`; validates membership before routing |
| `handlers/contextAwareCompanionRouter.js` | Re-routes session to the new circleId and role |
| `handlers/domainRouter.js` | Domain isolation gate — maps circleId to medical or business domain |
| `companions/CompanionCoordinator.js` | Per-request brain; re-initialises with new role and circleId |
| `companions/handlers/stateTracker.js` | Resets per-circle state snapshot on context switch |
| `companions/physio/tensornetsBridge.js` | JS→Python bridge; sends physio session reset to FastAPI |
| `FastAPI tensornets/server.py :8765` | Python inference server; resets MCTS session for the new circle |
| `companions/agents/patientOptimizer.js` | Generates the first response in the new context |
| `agents/unifiedAgent.js` | Executes LLM calls |
| `agents/api/` | Multi-provider LLM layer (Scout / Maverick / Bedrock) |
| `SQLite care_circle_dev.db` | Circle membership records and full circle context |

## Data Flow

```
/switch command { circleId: "X", role: "caregiver" }
  → membership check (commandHandler → SQLite)
      FAIL → ACCESS_DENIED → SSE error to User
      PASS →
          → re-route (contextAwareCompanionRouter → domainRouter)
          → re-initialise CompanionCoordinator (role=caregiver, circleId=X)
          → reset state (stateTracker)
          → physio session reset (tensornetsBridge → FastAPI :8765)
          → load new circle context (SQLite)
          → first response (patientOptimizer → unifiedAgent → Scout LLM)
  → SSE greeting to User in new context
```

---

> **Note:** This diagram uses real module file names from the codebase. Earlier versions of this diagram used fictional participant names (ActionExecutor, FactReportingHandler, CriticalEventsHandler, ConsentManager, SharingHandler) — those have been removed.
