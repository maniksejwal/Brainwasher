# Logical View - Care Circle Component Diagram (v1 Original)

**Purpose**: Component diagram showing the static structure of the Care Circle framework (JS-only, pre-HTN)

---

## Mermaid Source

Save this as `documentation/uml_diagrams/care_circle_logical_view_v1.md`:

```markdown
# Care Circle Logical View - Component Diagram (v1 Original Design)

This diagram shows the major components and their relationships in the original Care Circle framework (Node.js-only, pre-HTN).

## Component Diagram

```mermaid
graph TB
    subgraph external[External Actors]
        USER_A[👤 User A<br/>Patient/Caregiver]
        USER_B[👤 User B<br/>Caregiver/Clinician]
        LLM_API[☁️ LLM API<br/>Scout/Maverick]
    end

    subgraph server[Node.js Server Layer]
        SRVJS[server.js<br/>HTTP/SSE Endpoint<br/>Port 3000]
        
        subgraph orchestration[Orchestration Layer]
            ORC[orchestrator.js<br/>Central Coordinator<br/>EventEmitter<br/>broadcast/escalate]
        end
        
        subgraph agents[Agent Layer]
            PA[PersonalAgent A<br/>For User A<br/>State: facts, history]
            CA[CareAgent B<br/>For User B<br/>State: facts, history]
        end
        
        subgraph handlers[Handler Components]
            AI_ANALYSIS[AI Analysis Handler<br/>Message content analysis<br/>Agent identity]
            INTENT[Intent Handler<br/>Intent classification<br/>fact/doctor/mediation]
            ACTION_EXEC[Action Executor<br/>Execute determined actions<br/>Mediation logic]
            STATE_MGR[State Manager<br/>Pending actions<br/>Action status]
            PRIV_GUARD[Privacy Guard<br/>Content classification<br/>public/private/sensitive]
            CONSENT[Consent Manager<br/>4-tier consent gate<br/>emergency/implied/explicit]
        end
    end

    subgraph storage[Storage Layer]
        DB[(SQLite Database<br/>users, facts, messages<br/>consent, state, actions)]
    end

    %% External connections
    USER_A -->|HTTP POST /message| SRVJS
    USER_B -->|HTTP POST /message| SRVJS
    SRVJS -.->|SSE Stream| USER_A
    SRVJS -.->|SSE Stream| USER_B

    %% Server layer connections
    SRVJS --> ORC
    ORC --> PA
    ORC --> CA

    %% Agent to handlers
    PA --> AI_ANALYSIS
    PA --> INTENT
    PA --> ACTION_EXEC
    CA --> AI_ANALYSIS
    CA --> INTENT
    CA --> ACTION_EXEC

    %% Handler interactions
    AI_ANALYSIS --> DB
    INTENT --> AI_ANALYSIS
    ACTION_EXEC --> STATE_MGR
    STATE_MGR --> DB
    ACTION_EXEC --> PRIV_GUARD
    PRIV_GUARD --> CONSENT
    CONSENT --> DB

    %% LLM connection
    AI_ANALYSIS --> LLM_API
    INTENT --> LLM_API

    %% Cross-agent mediation
    ACTION_EXEC -.->|mediated message| CA
    ACTION_EXEC -.->|mediated message| PA

    %% Orchestrator broadcasts
    ORC -.->|broadcast event| PA
    ORC -.->|broadcast event| CA
    
    style external fill:#e1f5ff
    style server fill:#fff4e6
    style orchestration fill:#ffd966
    style agents fill:#b6d7a8
    style handlers fill:#ffe599
    style storage fill:#d9d9d9
```

## Component Descriptions

### Server Layer
- **server.js**: HTTP/SSE endpoint, port 3000, handles client connections
- **orchestrator.js**: Central coordinator with EventEmitter for broadcast/escalate events

### Agent Layer
- **PersonalAgent**: Per-user agent instance (patient/caregiver), maintains state
- **CareAgent**: Per-user agent for caregivers/clinicians, maintains state

### Handler Components
- **AI Analysis Handler**: Analyzes message content, determines agent identity
- **Intent Handler**: Classifies message intent (fact/doctor/mediation/advice)
- **Action Executor**: Executes determined actions, handles mediation logic
- **State Manager**: Manages pending actions and action status
- **Privacy Guard**: Classifies content as public/private/sensitive
- **Consent Manager**: Enforces 4-tier consent gate (emergency/implied/explicit/full)

### Storage Layer
- **SQLite Database**: Stores users, facts, messages, consent levels, state, pending actions

### External
- **Users**: Patients, caregivers, clinicians
- **LLM API**: Scout/Maverick for natural language processing

## Key Relationships

1. **User → Server**: HTTP POST requests, SSE stream responses
2. **Orchestrator → Agents**: Central coordination, event broadcasting
3. **Agents → Handlers**: Delegation to specialized handlers
4. **Handlers → Database**: State persistence and retrieval
5. **Handlers → LLM**: AI-powered analysis and classification
6. **Cross-Agent**: Mediated messages through Action Executor
```
---

## How to Export to PNG

1. Save the above Mermaid code to:
   ```
   documentation/uml_diagrams/care_circle_logical_view_v1.md
   ```

2. Run the export script:
   ```bash
   python scripts/export_mermaid.py
   ```

3. The PNG will be generated at:
   ```
   figures/uml/care_circle_logical_view_v1.png
   ```

4. Use in Appendix F as **Figure F.3 (Logical View)**

---

## Alternative: Simpler Version

If the above is too complex, here's a simpler 3-tier version with external services:

```mermaid
graph TB
    subgraph external[External Services]
        USER[👤 Users<br/>Patients/Caregivers/Clinicians]
        LLM[☁️ LLM API<br/>Scout/Maverick]
    end

    subgraph layer3[Presentation Layer]
        SRVJS[server.js<br/>HTTP/SSE Port 3000]
    end

    subgraph layer2[Business Logic Layer]
        ORC[orchestrator.js<br/>Central Coordinator]
        AGENTS[PersonalAgent<br/>CareAgent]
        HANDLERS[AI Analysis<br/>Intent Handler<br/>Action Executor<br/>State Manager<br/>Privacy Guard<br/>Consent Manager]
    end

    subgraph layer1[Data Layer]
        DB[(SQLite DB<br/>users, facts, messages)]
    end

    USER <-->|HTTP/SSE| SRVJS
    SRVJS <--> ORC
    ORC <--> AGENTS
    AGENTS <--> HANDLERS
    HANDLERS <--> DB
    HANDLERS <-->|NLP requests| LLM
    
    style external fill:#e1f5ff
    style layer3 fill:#fff4e6
    style layer2 fill:#ffe599
    style layer1 fill:#d9d9d9
```

This shows the classic 3-tier architecture (Presentation → Business Logic → Data) with external services separated out

---

## For Your Thesis

**Use**: The first (detailed) component diagram for Appendix F.3 (Logical View)

**Caption**: 
```latex
\caption{Care Circle Logical View (v1 Original Design) - Component architecture showing the Node.js server layer with orchestration, agent, and handler components. PersonalAgent and CareAgent instances coordinate through the orchestrator, delegating to specialized handlers for AI analysis, intent classification, action execution, and consent management.}
```
