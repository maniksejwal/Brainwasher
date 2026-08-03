# Care Circle Architecture - Simple Flow Diagram

```
┌──────────────┐
│     USER     │
└──────┬───────┘
       │
       ↓
┌──────────────────────────┐
│  CompanionCoordinator    │
│  (Message Router)        │
└──────────┬───────────────┘
           │
           ↓
┌──────────────────────────┐
│  1. Intent Handler       │
│     LLM Call #1          │
│     (Command Detection)  │
└──────────┬───────────────┘
           │
           ↓
┌──────────────────────────┐
│  2. Privacy Guard        │
│     (Consent Filter)     │
└──────────┬───────────────┘
           │
           ↓
┌──────────────────────────┐
│  3. AI Analysis          │
│     LLM Call #2          │
│     (Semantic Extract)   │
└──────────┬───────────────┘
           │
           ↓
┌──────────────────────────┐
│  4. Action Executor      │
│     (Select Action)      │
└──────────┬───────────────┘
           │
           ↓
┌──────────────────────────┐
│  5. Response Generator   │
│     LLM Call #3          │
│     (Generate Reply)     │
└──────────┬───────────────┘
           │
           ├──→ User (SSE Stream)
           │
           └──→ Side Effects:
                • SQLite logging
                • Event bus
                • Cross-circle alerts
                • Escalation routing
```

---

## Multi-User Coordination

```
┌─────────┐         ┌──────────┐         ┌─────────┐
│ Patient │         │Caregiver │         │ Doctor  │
└────┬────┘         └────┬─────┘         └────┬────┘
     │                   │                     │
     │                   │ Message             │
     │                   ↓                     │
     │         ┌─────────────────┐            │
     │         │  Coordinator    │            │
     │         │  • Check consent│            │
     │         │  • Filter info  │            │
     │         └────────┬────────┘            │
     │                  │                     │
     │                  ├──→ Response         │
     │                  │                     │
     │    ┌─────────────┴──────────┐         │
     │    │ Optional:              │         │
     │    │ • Alert to Patient     │         │
     │    │ • Escalate to Doctor   │         │
     │    └────────────────────────┘         │
     │                                        │
```

---

## Key Differences

### Experiment 0 (Care Circle - JS)
- **Pipeline:** 5 handlers sequential
- **LLM calls:** 3 per turn (~1,200 tokens)
- **Multi-user:** ✓ Yes
- **Privacy:** ✓ Consent tiers
- **Focus:** Architectural richness

### Experiments 1-7 (HTN - Python)
- **Pipeline:** Direct MCTS → LLM
- **LLM calls:** 1-2 per turn (~550-1,200 tokens)
- **Multi-user:** ✗ Single user only
- **Privacy:** ✗ No guards
- **Focus:** Physiological optimization
