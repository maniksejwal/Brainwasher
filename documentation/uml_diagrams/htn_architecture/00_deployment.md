# Deployment Diagram — HTN Framework

**Scale:** Physical / deployment
**One idea:** Where each component runs and how nodes connect

The framework spans three physical tiers: a user edge tier (mobile app + smartwatch), an application server tier (Node.js orchestration + companion logic), and a compute tier (Python tensor bridge + A3C workers). Heavy compute never runs on the user device. The LLM call is the only cloud dependency at inference time.

```mermaid
graph TB
    subgraph EDGE["Edge — User Device"]
        direction TB
        SW["⌚ Smartwatch\nBLE wearable\nHRV · EDA · activity"]
        MOB["📱 Mobile App\nWeb client\nSSE listener"]
        SW -- "BLE / Health API" --> MOB
    end

    subgraph APPSERVER["Application Server  (Node.js)"]
        direction TB
        SRVJS["server.js\nHTTP + SSE endpoint"]
        ORCH["orchestrator.js\nEvent bus"]
        CCR["contextAwareCompanionRouter"]
        CC["CompanionCoordinator\n5 parallel handlers"]
        PRVG["privacyGuard.js\nLLM classifier"]
        CONSM["consentManager.js\nDB-backed gate"]
        SRVJS --> ORCH --> CCR --> CC
        CC --> PRVG
        CC --> CONSM
    end

    subgraph TENSORSERVER["Tensor Compute Server  (Python / FastAPI)"]
        direction TB
        PHYSIO["POST /physio\nOU process · stress index\nMPS update"]
        MCTS_EP["POST /mcts/best-action\nMCTS · HPVOOT · A3C prior"]
        A3CW["A3C Workers\nPolicy training\n(offline / async)"]
        STS["SharedTensorBuffer\nVint propagation\nAlliance store"]
        PHYSIO --> STS
        MCTS_EP --> A3CW
        STS --> MCTS_EP
    end

    subgraph CLOUD["Cloud"]
        direction LR
        LLM["Primary Inference Model\nTactical agent\n(cloud API)"]
        JUDGE["LLM Judge\nEvaluation / scoring"]
    end

    DB[("SQLite DB\ncompanions · facts\ncircles · consent")]

    MOB -- "HTTPS / WebSocket" --> SRVJS
    CC -- "POST /physio\nPOST /mcts/best-action" --> PHYSIO
    CC -- "POST /mcts/best-action" --> MCTS_EP
    CC -- "system prompt + Mtrunc\n[MCTS GUIDANCE]" --> LLM
    LLM -- "SSE token stream" --> SRVJS
    SRVJS -- "SSE" --> MOB
    ORCH --> DB
    STS --> DB
    JUDGE -. "batch eval\n(offline)" .-> A3CW
```

## Node responsibilities

| Node | Tier | What runs there |
|---|---|---|
| Smartwatch | Edge | Raw sensor sampling (HRV, EDA). Sends to mobile via BLE. |
| Mobile app | Edge | UI, SSE stream display, health API bridge. No tensor compute. |
| server.js | App server | HTTP/SSE ingress, session management, response streaming. |
| orchestrator.js | App server | Event bus: escalation, future-plan routing, circle notifications. |
| CompanionCoordinator | App server | Per-request: 5 parallel handlers + role-specific optimizer. |
| privacyGuard.js | App server | Stateless LLM call classifying message as public/private/sensitive. |
| consentManager.js | App server | Stateful DB gate: emergency override → implied → explicit consent. |
| FastAPI /physio | Tensor server | OU process, stress index, MPS slot update, Vint propagation. |
| FastAPI /mcts | Tensor server | MCTS tree search (80–150 iter), action ranking, Mtrunc construction. |
| A3C workers | Tensor server | Async policy training. Offline or continuous background process. |
| SharedTensorBuffer | Tensor server | In-memory shared MPS slots + hysteretic alliance store per circle. |
| LLM (cloud) | Cloud | Tactical text generation guided by [MCTS GUIDANCE] system prompt. |
| SQLite | App server | Persistent store: companions, facts, circles, consent, alliances. |

## What runs on which tier

```mermaid
graph LR
    subgraph LIGHT["Lightweight  (edge / app server)"]
        A[HRV sampling]
        B[UI / SSE stream]
        C[Intent extraction]
        D[Consent gate]
        E[Privacy guard]
    end
    subgraph HEAVY["Compute-intensive  (tensor server)"]
        F[MPS contraction]
        G[MCTS tree search]
        H[A3C gradient update]
        I[Stress index calculation]
        J[Vint propagation]
    end
    subgraph CLOUDTIER["Cloud  (API call)"]
        K[LLM token generation]
        L[LLM judge scoring]
    end
```
