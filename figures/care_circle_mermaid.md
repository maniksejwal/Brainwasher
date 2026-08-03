```mermaid
flowchart TD
    User[User: Patient/Caregiver/Doctor] -->|Message| Coordinator[CompanionCoordinator<br/>Message Router]
    
    Coordinator --> Intent[1. Intent Handler<br/>LLM Call #1<br/>Command Detection]
    
    Intent -->|Pass| Privacy[2. Privacy Guard<br/>Consent Filter]
    Intent -->|Handle| Execute[Execute Command]
    
    Privacy -->|Filtered Context| Analysis[3. AI Analysis<br/>LLM Call #2<br/>Sentiment + Criticality]
    
    Analysis -->|Analysis Object| ActionEx[4. Action Executor<br/>Select Action]
    
    ActionEx -->|Recommended Action| Response[5. Response Generator<br/>LLM Call #3<br/>Generate Reply]
    
    Response -->|Stream| UserOut[Response to User]
    Response --> Actions[System Actions]
    
    Actions --> Log[SQLite Logging]
    Actions --> Event[Event Bus]
    Actions --> Alert[Cross-Circle Alerts]
    Actions --> Escalate[Escalation Routing]
    
    Alert -.->|Notify| OtherUsers[Other Care Circle Members]
    Escalate -.->|Critical| Doctor[Doctor Alert]
    
    style Coordinator fill:#e1f5ff
    style Intent fill:#fff4e1
    style Privacy fill:#ffe1e1
    style Analysis fill:#fff4e1
    style ActionEx fill:#e1ffe1
    style Response fill:#fff4e1
    style Actions fill:#f0f0f0
    
    classDef llmCall fill:#fff4e1,stroke:#ffa500,stroke-width:2px
    class Intent,Analysis,Response llmCall
```

---

## Multi-User Coordination Flow

```mermaid
sequenceDiagram
    participant Patient
    participant Caregiver
    participant Coordinator as CompanionCoordinator
    participant Privacy as Privacy Guard
    participant Doctor
    
    Caregiver->>Coordinator: "How is Mom's therapy going?"
    Coordinator->>Privacy: Check consent tier
    Privacy-->>Coordinator: Limited consent<br/>(therapy BLOCKED)
    Coordinator->>Caregiver: "Therapy content requires<br/>patient consent"
    Coordinator->>Patient: Audit log: privacy<br/>violation attempt
    
    Note over Caregiver,Doctor: Caregiver can ask about medications
    
    Caregiver->>Coordinator: "Is she taking her meds?"
    Coordinator->>Privacy: Check consent tier
    Privacy-->>Coordinator: Limited consent<br/>(meds ALLOWED)
    Coordinator->>Caregiver: "87% adherence this month"
```

---

## Architecture Comparison: Exp 0 vs Exp 1-7

```mermaid
graph LR
    subgraph Exp0["Experiment 0 (JS - Care Circle)"]
        U1[User] --> C1[Coordinator]
        C1 --> I1[Intent]
        I1 --> P1[Privacy]
        P1 --> A1[Analysis]
        A1 --> Ac1[Action]
        Ac1 --> R1[Response]
        R1 --> SE1[System Actions:<br/>Multi-user alerts]
    end
    
    subgraph Exp1["Experiments 1-7 (Physiology-Aware)"]
        U2[User] --> M2[MCTS<br/>Planning]
        M2 --> L2[LLM<br/>Response]
        L2 --> U2b[User<br/>Single-user only]
    end
    
    style Exp0 fill:#e1f5ff
    style Exp1 fill:#ffe1f5
```

---

## Data Stores

```mermaid
graph TD
    Handlers[Handler Pipeline] -->|Read/Write| SQLite[(SQLite Database)]
    
    SQLite --> Circles[care_circles]
    SQLite --> Consent[consent_tiers]
    SQLite --> Turns[conversation_turns]
    SQLite --> Meds[patient_medications]
    SQLite --> Events[event_log]
    
    Handlers -->|LLM API| Bedrock[AWS Bedrock]
    
    Bedrock --> Scout[Llama 4 Scout 17B<br/>Response Gen]
    Bedrock --> Maverick[Llama 4 Maverick 70B<br/>Analysis]
    
    style SQLite fill:#e1ffe1
    style Bedrock fill:#fff4e1
```

---

## Usage

To render these diagrams:
1. Copy Mermaid code to https://mermaid.live/
2. Export as PNG/SVG
3. Include in thesis

Or use mermaid-cli:
```bash
npm install -g @mermaid-js/mermaid-cli
mmdc -i care_circle_architecture.md -o care_circle_flow.png
```
