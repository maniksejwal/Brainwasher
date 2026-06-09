# Environment Diagram 1 — Physical Deployment

> **View:** 4+1 Physical View (Kruchten)  
> **Purpose:** Shows where processes run, how they communicate, and what
> stores data. This is the "machine map" of the system.

## Deployment Diagram

```mermaid
graph TD
    subgraph client [Client Layer]
        Browser["Browser / Mobile\n(SSE EventSource)"]
    end

    subgraph node_server [Node.js Process — port 8247]
        ServerJS["server.js\n(Express HTTP + SSE)"]
        OrchestratorJS["orchestrator.js\n(EventEmitter bus)"]
        Router["handlers/contextAwareCompanionRouter.js"]
        CC["companions/CompanionCoordinator.js\n(per-request brain)"]
        Handlers["Companion Handlers\ninputUnderstanding · historyAnalyzer\nempathyHandler · stateTracker\nprivacyGuard · patientOptimizer\ndoctorOptimizer · escalationManager\nfuturePlanningAgent"]
        ActionSelector["prompts/action_selector.js\n(MCTS action guidance)"]
        UnifiedAgent["agents/unifiedAgent.js\n(Scout / Maverick LLM calls)"]
        SSELib["lib/sse.js\n(client registry + broadcast)"]
    end

    subgraph python_server [Python FastAPI Process — port 8765]
        FastAPI["tensornets/server.py\n(FastAPI)"]
        MPS["physio/state.py\n(MPS encoder)"]
        Hysteresis["physio/hysteresis.py\n(HysteresisGate)"]
        PKPD["physio/pkpd.py\n(PK/PD drug model)"]
        MCTSCore["a3c/worker.py\n(A3C + MCTS)"]
        Arms["a3c/arms.py\n(8 training arms)"]
        TensorBridge["companions/physio/tensornetsBridge.js\n(JS→Python bridge)"]
    end

    subgraph bedrock [AWS Bedrock — external]
        Scout["meta.llama4-scout-17b-instruct-v1:0\n(primary inference)"]
        Maverick["meta.llama4-maverick-17b-instruct-v1:0\n(LLM-as-judge)"]
    end

    subgraph storage [Storage]
        SQLite["SQLite — care_circle_dev.db\nTables: users · circle_members\nmessages · facts_v2 · interventions\nescalations · companion_confidential_messages\ncompanion_intel_sharing"]
        Checkpoints["tensornets/runs/run_018/\narm_*/checkpoints/actor_N.json\narm_*/episodes/*.jsonl"]
    end

    Browser -- "POST /api/message\nGET /api/sse" --> ServerJS
    ServerJS --> OrchestratorJS
    ServerJS --> Router
    Router --> CC
    CC --> Handlers
    CC --> ActionSelector
    CC --> TensorBridge
    Handlers --> UnifiedAgent
    UnifiedAgent -- "Bedrock API (HTTPS)" --> Scout
    UnifiedAgent -- "Bedrock API (HTTPS)" --> Maverick
    OrchestratorJS -- "EventEmitter events\n(broadcast, escalate,\nfuture_plan_executed)" --> SSELib
    SSELib -- "SSE stream" --> Browser
    TensorBridge -- "HTTP POST\n/longitudinal_hint\n/mcts_action\n/score_candidates\n/tensor_rag" --> FastAPI
    FastAPI --> MPS
    FastAPI --> Hysteresis
    FastAPI --> PKPD
    FastAPI --> MCTSCore
    MCTSCore --> Arms
    CC --> SQLite
    Handlers --> SQLite
    MCTSCore --> Checkpoints
```

## Component Ownership

| Layer | Process | Port | Language |
|-------|---------|------|----------|
| Client | Browser / Mobile | — | HTML / JS |
| Application | `server.js` (Express + SSE) | 8247 | Node.js |
| Inference bridge | `tensornetsBridge.js` | — | Node.js (HTTP client) |
| ML server | `tensornets/server.py` (FastAPI) | 8765 | Python |
| LLM provider | AWS Bedrock | 443 (HTTPS) | External API |
| Persistence | SQLite `care_circle_dev.db` | — | SQLite |
| Training artefacts | `runs/run_018/` | — | JSON / JSONL |

## Known Gaps (see `documentation/DISCREPANCIES.md`)

- Escalation SSE broadcast does not currently fan out to all care circle members — it only sends to `payload.userId`. Family/caregiver notification requires a `getCircleMembers()` call on escalation, which is not yet wired.
- No production-grade process manager (PM2, Docker) in place; both Node.js and Python servers are started manually.
