# Training System Architecture

This document provides visual overviews of the training and reinforcement learning infrastructure.

## System Overview

```mermaid
flowchart TB
    subgraph Production["🏭 Production System (Unchanged)"]
        User[User Message] --> MH[messageHandler.js]
        MH --> AI[AI Agent]
        AI --> Response[Response]
    end
    
    subgraph Observability["📊 Observability Layer (Non-Blocking)"]
        MH -.Fire & Forget.-> Logger[logger.js]
        MH -.Fire & Forget.-> Metrics[metrics.js]
        Logger --> TrainLog[(training_log.jsonl)]
        Metrics --> MetLog[(metrics.jsonl)]
    end
    
    subgraph Feedback["💬 Feedback Collection"]
        ScoreCmd[/score command] --> FeedbackDB[(feedback table)]
        Annotator[annotator.js] --> FeedbackDB
    end
    
    subgraph Simulation["🤖 Simulation Engine (Isolated)"]
        Personas[personas.js] --> SimUser[SyntheticUser]
        SimUser --> Simulator[simulator.js]
        Simulator --> SimDB[(simulation.db)]
        Simulator --> TrainLog
        ScenarioRunner[scenario_runner.js] --> Simulator
    end
    
    subgraph Analysis["🔬 Analysis & Optimization"]
        TrainLog --> Analyzer[feedback_analyzer.js]
        FeedbackDB --> Analyzer
        Analyzer --> Report[analysis_report.md]
        Report --> Optimizer[prompt_optimizer.js]
        Optimizer --> NewPrompt[unified_prompt_v1.1.js]
    end
    
    subgraph Testing["🧪 A/B Testing"]
        NewPrompt --> ABTest[ab_test.js]
        Simulator --> ABTest
        ABTest --> Decision{Winner?}
        Decision -->|Better| Deploy[Deploy v1.1]
        Decision -->|Worse| Keep[Keep v1.0]
    end
    
    Deploy -.Update Code.-> Production
    
    style Production fill:#e1f5e1
    style Observability fill:#fff4e1
    style Simulation fill:#e1f0ff
    style Analysis fill:#ffe1f5
    style Testing fill:#f5e1ff
```

## Component Architecture

```mermaid
graph LR
    subgraph Core["training/core"]
        Logger[logger.js<br/>Passive logging]
        Metrics[metrics.js<br/>Performance tracking]
    end
    
    subgraph Simulation["training/simulation"]
        Personas[personas.js<br/>11 synthetic personas]
        Simulator[simulator.js<br/>Conversation engine]
        ScenarioRunner[scenario_runner.js<br/>Batch execution]
    end
    
    subgraph Analysis["training/analysis"]
        FeedbackAnalyzer[feedback_analyzer.js<br/>AI-powered analysis]
        PromptOptimizer[prompt_optimizer.js<br/>Meta-prompting]
        ABTest[ab_test.js<br/>Statistical testing]
    end
    
    subgraph Feedback["training/feedback"]
        Annotator[annotator.js<br/>Offline review tool]
    end
    
    subgraph Config["training/config"]
        Prompts[analysis_prompts.js<br/>Centralized templates]
    end
    
    Core --> Simulation
    Simulation --> Analysis
    Analysis --> Config
    Feedback --> Analysis
```

## Data Flow Diagram

```mermaid
sequenceDiagram
    participant User
    participant System
    participant Logger
    participant DB as Database
    participant Analyzer as AI Analyzer
    participant Optimizer
    participant ABTest
    
    User->>System: Send Message
    System->>User: Response
    System-->>Logger: Log (async)
    Logger-->>DB: Store
    
    User->>System: /score +1
    System->>DB: Save Feedback
    
    Note over Analyzer: Weekly Analysis
    Analyzer->>DB: Load Logs + Feedback
    Analyzer->>Analyzer: Identify Patterns
    Analyzer->>Optimizer: Send Analysis
    
    Optimizer->>Optimizer: Generate New Prompt
    Optimizer->>ABTest: Test v1.0 vs v1.1
    
    ABTest->>ABTest: Run Simulations
    ABTest->>System: Deploy if Better
```

## Safety Architecture

```mermaid
graph TD
    Production[("🏭 Production<br/>care_circle.db")]
    
    subgraph SafetyLayer["🛡️ Safety Layer"]
        Logger["logger.js<br/>(try-catch, async)"]
        Metrics["metrics.js<br/>(buffered, non-blocking)"]
    end
    
    Simulation[("🧪 Simulation<br/>simulation.db<br/><b>ISOLATED</b>")]
    
    Analysis["📊 Analysis<br/>(read-only)"]
    
    Manual{"👤 Human<br/>Review"}
    
    Production -.Fire & Forget.-> SafetyLayer
    SafetyLayer --> Analysis
    Simulation --> Analysis
    Analysis --> Manual
    Manual -->|Approved| Production
    Manual -->|Rejected| Analysis
    
    style Production fill:#90EE90
    style Simulation fill:#87CEEB
    style SafetyLayer fill:#FFD700
    style Manual fill:#FFB6C1
```

## Continuous Improvement Loop

```mermaid
flowchart LR
    A[Week 1:<br/>Collect Data] --> B[Week 2:<br/>Run Simulations]
    B --> C[Week 3:<br/>Analyze]
    C --> D{Issues<br/>Found?}
    D -->|Yes| E[Optimize Prompts]
    D -->|No| A
    E --> F[A/B Test]
    F --> G{Better?}
    G -->|Yes| H[Deploy]
    G -->|No| C
    H --> A
    
    style A fill:#e1f5e1
    style B fill:#e1f0ff
    style C fill:#ffe1f5
    style E fill:#fff4e1
    style F fill:#f5e1ff
    style H fill:#90EE90
```

## Package Structure

```mermaid
graph TD
    Root["training/"]
    
    Core["core/<br/>📦 Logging & Metrics"]
    Sim["simulation/<br/>🤖 Synthetic Users"]
    Ana["analysis/<br/>🔬 AI Analysis"]
    Feed["feedback/<br/>💬 Human Input"]
    Conf["config/<br/>⚙️ Templates"]
    
    Root --> Core
    Root --> Sim
    Root --> Ana
    Root --> Feed
    Root --> Conf
    
    Core --> CoreIdx["index.js<br/>logger, metrics"]
    Sim --> SimIdx["index.js<br/>personas, simulator"]
    Ana --> AnaIdx["index.js<br/>analyzer, optimizer"]
    Feed --> FeedIdx["index.js<br/>annotator"]
    
    style Root fill:#FFD700
    style Core fill:#90EE90
    style Sim fill:#87CEEB
    style Ana fill:#FFB6C1
    style Feed fill:#DDA0DD
    style Conf fill:#F0E68C
```

## Integration Points

```mermaid
graph LR
    subgraph ProductionCode["Production Code"]
        MH[messageHandler.js]
        CH[commandHandler.js]
        SC[scoreCommand.js]
    end
    
    subgraph TrainingSystem["Training System"]
        Logger[training/core/logger.js]
        Metrics[training/core/metrics.js]
        Config[training/config/analysis_prompts.js]
    end
    
    MH -->|import| Logger
    MH -->|import| Metrics
    CH -->|routes to| SC
    SC -->|import| Config
    
    style ProductionCode fill:#e1f5e1
    style TrainingSystem fill:#e1f0ff
```

## Deployment Pipeline

```mermaid
flowchart TB
    Dev[Development<br/>💻 Local Testing]
    Test[Testing<br/>🧪 A/B Test 50+ runs]
    Stage[Staging<br/>📊 Monitor Metrics]
    Prod[Production<br/>🚀 Deploy]
    
    Dev --> Test
    Test -->|Pass?| Stage
    Test -->|Fail| Dev
    Stage -->|Stable?| Prod
    Stage -->|Issues| Dev
    Prod -->|Monitor| CB{Circuit<br/>Breaker}
    CB -->|Degradation| Rollback[Rollback to v1.0]
    CB -->|Success| Cont[Continue]
    
    style Dev fill:#fff4e1
    style Test fill:#e1f0ff
    style Stage fill:#ffe1f5
    style Prod fill:#90EE90
    style Rollback fill:#FFB6C1
```

## Performance Impact

```mermaid
graph LR
    subgraph Before["Before Training System"]
        B1[messageHandler] -->|200ms| B2[Total: 200ms]
    end
    
    subgraph After["After Training System"]
        A1[messageHandler] -->|200ms| A2[Core Logic]
        A1 -.->|+1.3ms async| A3[Logging]
        A2 --> A4[Total: ~201ms]
        A3 -.Fire & Forget.-> A4
    end
    
    style Before fill:#FFB6C1
    style After fill:#90EE90
```

## Key Metrics

| Component | Performance | Safety |
|-----------|-------------|--------|
| Logger | < 2ms overhead | Try-catch, async |
| Metrics | Buffered writes | Non-blocking |
| Simulator | Separate DB | Isolated |
| Analysis | Read-only | No modifications |
| Deployment | Manual | Human-approved |

---

**Status**: 🟢 Production Ready  
**Overhead**: < 1% performance impact  
**Safety**: Multi-layer protection  
**Deployment**: Proven workflow  
