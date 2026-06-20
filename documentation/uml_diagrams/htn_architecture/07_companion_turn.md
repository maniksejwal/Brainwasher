# Single Companion Conversation Turn

**Scale:** Component level
**One idea:** Every step that happens between a patient message arriving and the SSE response leaving

```mermaid
flowchart TD
    MSG(["Patient message arrives\n(HTTP POST)"])

    subgraph JS["Application Server  (Node.js)"]
        ROUTE["contextAwareCompanionRouter\nselect companion by userId + circleId"]

        subgraph COORD["CompanionCoordinator.js  (parallel)"]
            direction LR
            H1["intent\nextraction"]
            H2["history\nanalysis"]
            H3["empathy\ndetection"]
            H4["state\ntracking"]
            H5["privacy\nclassification\nprivacyGuard.js"]
        end

        ROLE["Role-specific optimizer\npatientOptimizer.js\nclinicalAgent.js …"]
        CONSENT["consentManager.js\nconsent tier check"]
    end

    subgraph PY["Tensor Server  (Python)"]
        PHYSIO_EP["POST /physio\nOU → stress index s\nzone Z → MPS update"]
        MCTS_EP["POST /mcts/best-action\nHPVOOT 80–150 iter\nMtrunc constructed"]
    end

    subgraph LLM_LAYER["Cloud LLM"]
        SYSTEM["System prompt assembly\n+ [MCTS GUIDANCE] tag"]
        GEN["Text generation\nSSE stream"]
    end

    SCREEN["privacyGuard.js\npre-send screen"]
    SSE_OUT(["SSE response\nto patient device"])
    ORCH(["orchestrator.js\npost-turn events\n(escalation · future plan)"])

    MSG --> ROUTE --> COORD
    H1 & H2 & H3 & H4 & H5 --> ROLE
    ROLE --> PHYSIO_EP
    ROLE --> MCTS_EP
    PHYSIO_EP --> MCTS_EP
    MCTS_EP --> SYSTEM --> GEN
    GEN --> SCREEN
    CONSENT --> SCREEN
    SCREEN --> SSE_OUT
    SSE_OUT --> ORCH
```

## Latency budget (approximate)

| Step | Typical latency |
|---|---|
| Router + coordinator fan-out | ~5 ms |
| POST /physio (OU + MPS update) | ~15–30 ms |
| POST /mcts/best-action (150 iter, HPVOOT) | ~200–400 ms |
| LLM system prompt assembly | ~5 ms |
| LLM first token (cloud API, TTFT) | ~200–500 ms |
| LLM stream to completion | ~1–3 s |
| privacyGuard pre-send screen | ~100–200 ms (LLM call) |
| **Total wall time** | **~1.5–4 s** |

The MCTS call and the LLM TTFT are the two dominant latencies. They can be parallelised: MCTS runs while the LLM context window is being assembled.
