# Conflict Resolution

## Sequence Diagram

```mermaid
sequenceDiagram
    actor User
    participant server as server.js<br/>(Express / SSE)
    participant router as handlers/contextAwareCompanionRouter.js
    participant coord as companions/CompanionCoordinator.js<br/>(coordinateCompanions)
    participant history as companions/handlers/historyAnalyzer.js
    participant privacy as companions/handlers/privacyGuard.js
    participant facts_db as db/queries_facts.js
    participant db as SQLite care_circle_dev.db
    participant confidential as companions/confidential/CompanionConfidentialComm.js
    participant optimizer as companions/agents/patientOptimizer.js
    participant agent as agents/unifiedAgent.js<br/>(processUserMessage)
    participant llm as agents/api/ (Scout LLM)

    User->>server: POST /api/message { text: "I exercised yesterday", circleId, role }
    server->>router: route(req, res)
    router->>coord: coordinateCompanions(req, context)

    coord->>history: extractFacts(text, circleId)
    history-->>coord: { claimedFact: "exercised_yesterday", confidence: 0.92 }

    coord->>privacy: classifyFact(claimedFact, userRole)
    privacy-->>coord: { level: "PRIVATE" | "SENSITIVE" | "PUBLIC" }

    alt level is SENSITIVE
        coord-->>server: deny — fact cannot be stored or compared
        server-->>User: SSE { message: "[Fact withheld — sensitive content]" }
    else level is PRIVATE or PUBLIC
        coord->>facts_db: getContradictingFacts(circleId, factKey: "exercise_log")
        facts_db->>db: SELECT facts WHERE circleId AND key = 'exercise_log'
        db-->>facts_db: rows[]
        facts_db-->>coord: existingFacts[]

        alt Conflict detected (existingFact contradicts claimedFact)
            coord->>confidential: notifyConflict({ circleId, claimedFact, existingFact, role })
            confidential-->>coord: { acknowledged: true, otherCompanionRole }

            coord->>facts_db: upsertFact(circleId, claimedFact, conflictFlag: true)
            facts_db->>db: INSERT OR REPLACE facts (conflictFlag = 1)
            db-->>facts_db: rowId

            coord->>optimizer: generateConflictAwareResponse(claimedFact, existingFact, otherCompanionRole)
            optimizer->>agent: processUserMessage(conflictPrompt, context)
            agent->>llm: chat completion — conflict acknowledgement prompt
            llm-->>agent: reconciliation response text
            agent-->>optimizer: generatedText
            optimizer-->>coord: conflictResponse

            coord-->>server: conflictResponse
            server-->>User: SSE { message: conflictResponse, meta: { conflictFlag: true } }

        else No conflict (claimedFact is consistent or new)
            coord->>facts_db: upsertFact(circleId, claimedFact, conflictFlag: false)
            facts_db->>db: INSERT OR REPLACE facts (conflictFlag = 0)
            db-->>facts_db: rowId

            coord->>optimizer: generateResponse(intent, context)
            optimizer->>agent: processUserMessage(standardPrompt, context)
            agent->>llm: chat completion
            llm-->>agent: response text
            agent-->>optimizer: generatedText
            optimizer-->>coord: standardResponse

            coord-->>server: standardResponse
            server-->>User: SSE { message: standardResponse }
        end
    end
```

## Key Interactions

1. **User → server.js**: User reports a fact embedded in natural language text.
2. **historyAnalyzer**: Extracts the structured fact claim and its confidence score from the message.
3. **privacyGuard gate**: Classifies the fact before it is stored or compared; SENSITIVE facts are blocked immediately.
4. **db/queries_facts.js**: Retrieves existing facts for the same key from `care_circle_dev.db` to check for contradictions.
5. **Conflict detection**: `CompanionCoordinator` compares the incoming fact against stored facts; a mismatch triggers the conflict branch.
6. **CompanionConfidentialComm**: Notifies the peer companion (e.g. doctor companion) that a conflict was detected, so both companions remain in sync.
7. **db/queries_facts.js upsert**: The new fact is stored with `conflictFlag` set appropriately in both branches.
8. **patientOptimizer → unifiedAgent → Scout**: Generates either a conflict-acknowledging response or a standard confirmation.
9. **server.js SSE**: Final reply carries a `conflictFlag` meta field so the client can surface a conflict indicator in the UI.

## Component Roles

| Module | Role |
|--------|------|
| `server.js` | Express HTTP server; SSE broadcaster to connected clients |
| `handlers/contextAwareCompanionRouter.js` | Routes the request to the correct domain companion |
| `companions/CompanionCoordinator.js` | Orchestrates fact extraction, privacy gating, conflict detection, and response generation |
| `companions/handlers/historyAnalyzer.js` | Parses message text to extract structured fact claims with confidence scores |
| `companions/handlers/privacyGuard.js` | LLM-based classifier — Level 1 (PUBLIC) / Level 2 (PRIVATE) / Level 3 (SENSITIVE) |
| `db/queries_facts.js` | Fact retrieval and upsert; surfaces contradicting rows from SQLite |
| `companions/confidential/CompanionConfidentialComm.js` | Companion-to-companion signalling channel; keeps peer companions aware of conflicts |
| `companions/agents/patientOptimizer.js` | Builds conflict-aware or standard prompts and delegates to unifiedAgent |
| `agents/unifiedAgent.js` | Provider-agnostic LLM call executor |
| `agents/api/` | Multi-provider LLM layer (Scout / Maverick / Bedrock) |
| `SQLite care_circle_dev.db` | Persistent store; `facts` table holds keyed fact rows with conflict metadata |

## Data Flow

```
User message
  → fact extraction (historyAnalyzer)
  → privacy classification (privacyGuard)
      SENSITIVE → deny immediately
      PRIVATE / PUBLIC →
          → retrieve existing facts (db/queries_facts.js → SQLite)
          → conflict check (CompanionCoordinator)
              conflict →
                  → notify peer companion (CompanionConfidentialComm)
                  → upsert with conflictFlag=true
                  → conflict-aware response (patientOptimizer → unifiedAgent → Scout)
              no conflict →
                  → upsert with conflictFlag=false
                  → standard response (patientOptimizer → unifiedAgent → Scout)
  → SSE reply to User
```

---

> **Note:** This diagram uses real module file names from the codebase. Earlier versions of this diagram used fictional participant names (ActionExecutor, FactReportingHandler, CriticalEventsHandler, ConsentManager, SharingHandler) — those have been removed.
