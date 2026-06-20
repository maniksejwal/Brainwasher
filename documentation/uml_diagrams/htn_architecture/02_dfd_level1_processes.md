# DFD Level 1 — Main Processes

**Scale:** Architecture level
**One idea:** The five main processes and how data flows between them within one conversation turn

```mermaid
flowchart TD
    %% External inputs
    USER_MSG(["Patient utterance"])
    WEARABLE(["Wearable signals\nHRV · EDA · sleep\nglucose · reactivity"])
    CIRCLE_MSG(["Care circle messages"])

    %% Stores
    MPS_STORE[("MPS slot\nSharedTensorBuffer")]
    POLICY_STORE[("A3C policy\nactor + critic weights")]
    FACT_STORE[("Fact store\nSQLite + decay weights")]
    ALLIANCE_STORE[("Alliance store\nHystereticVInt\nper circle")]

    %% Processes
    P1["P1\nPhysiological\nEncoding\n/physio endpoint"]
    P2["P2\nDialogue State\nUpdate\nCompanionCoordinator"]
    P3["P3\nMCTS Planning\n/mcts/best-action\n80–150 iterations"]
    P4["P4\nResponse\nGeneration\nLLM tactical agent"]
    P5["P5\nCare Circle\nCoordination\norchestrator.js"]

    %% Flow
    WEARABLE --> P1
    P1 -- "stress index s\nzone Z\nMPS update" --> MPS_STORE
    P1 -- "Vint-attenuated\nHRV deltas" --> ALLIANCE_STORE

    USER_MSG --> P2
    MPS_STORE --> P2
    FACT_STORE --> P2
    P2 -- "intent · history\nempathy · privacy flags" --> P3

    MPS_STORE --> P3
    POLICY_STORE --> P3
    P3 -- "ranked action list\nMtrunc filter\n[MCTS GUIDANCE]" --> P4

    P4 -- "SSE token stream" --> USER_MSG
    P4 -- "completed response" --> P5

    CIRCLE_MSG --> P5
    ALLIANCE_STORE --> P5
    P5 -- "escalation events\nfuture-plan updates\ncircle notifications" --> CIRCLE_MSG
    P5 -- "alliance updates" --> ALLIANCE_STORE
    P5 -- "new facts" --> FACT_STORE
```

## Process descriptions

| Process | Input | Output | Key component |
|---|---|---|---|
| P1 Physiological Encoding | Raw wearable signals | Stress index s ∈ [0,1], zone Z ∈ {0..4}, updated MPS slot | `hrv.py`, `state.py`, `hysteresis_gate.py`, `mps.py` |
| P2 Dialogue State Update | Patient utterance, MPS, facts | Enriched context packet: intent, history, empathy signal, privacy class | `CompanionCoordinator.js` (5 parallel handlers) |
| P3 MCTS Planning | Enriched context, MPS, A3C policy | Top-3 action ranking, Mtrunc matrix, [MCTS GUIDANCE] prompt fragment | `worker.py`, HPVOOT in `arms.py` |
| P4 Response Generation | Action guidance, LLM context | SSE token stream (therapeutic response) | Primary inference model (cloud API), `privacyGuard.js` |
| P5 Care Circle Coordination | Completed response, circle state | Escalation alerts, future-plan triggers, Vint updates | `orchestrator.js`, `consentManager.js` |
