# Care Circle (JavaScript) - Information Flow Diagram

## Simple Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER (Patient/Caregiver/Doctor)                  │
│                              sends message ↓                             │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                        CompanionCoordinator.js                           │
│  (Main orchestrator - routes messages, manages circles)                  │
│                                                                           │
│  • Receives message from user                                            │
│  • Identifies care circle (patient + caregivers + doctors)               │
│  • Checks user role and consent tier                                     │
│  • Routes to appropriate handler pipeline                                │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                    HANDLER PIPELINE (Sequential)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  1. intentHandler.js                                              │  │
│  │     • Detects explicit commands ("call doctor", "share with mom") │  │
│  │     • LLM call #1: Intent classification (200-300 tokens)         │  │
│  │     • Returns: intent type OR passes to next handler             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              │                                            │
│                              ↓ (if intent = NONE)                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  2. privacyGuard.js                                               │  │
│  │     • Checks consent tier for requestor                           │  │
│  │     • Filters medical history based on role                       │  │
│  │     • Blocks therapy content if limited consent                   │  │
│  │     • Returns: filtered context OR blocks message                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              │                                            │
│                              ↓                                            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  3. aiAnalysisHandler.js                                          │  │
│  │     • Deep semantic understanding                                 │  │
│  │     • LLM call #2: AI Analysis (400-500 tokens)                   │  │
│  │     • Extracts: sentiment, criticality, medical keywords          │  │
│  │     • Entity resolution ("mom" → Jane Doe, caregiver ID)          │  │
│  │     • Returns: analysis object                                    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              │                                            │
│                              ↓                                            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  4. actionExecutor.js                                             │  │
│  │     • Uses analysis to pick action (validate, give_facts, etc.)   │  │
│  │     • Queries SQLite for conversation history (last 6 turns)      │  │
│  │     • Checks patient medication regimen                           │  │
│  │     • Returns: recommended action                                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              │                                            │
│                              ↓                                            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  5. responseGenerator.js                                          │  │
│  │     • Builds prompt with: action + analysis + history + context   │  │
│  │     • LLM call #3: Response generation (400-500 tokens)           │  │
│  │     • Returns: natural language response                          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                          SIDE EFFECTS                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  • eventBus.emit() → logs event to SQLite                                │
│  • circleBridge.notify() → sends alerts to other care circle members     │
│  • escalationRouter.trigger() → notifies doctor if critical              │
│  • sessionStore.update() → saves conversation turn                       │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                    RESPONSE SENT TO USER (SSE stream)                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Multi-User Scenario (Example: Caregiver Message)

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│  Patient    │         │  Caregiver   │         │   Doctor    │
│  (Jane)     │         │  (Daughter)  │         │  (Dr. Smith)│
└──────┬──────┘         └──────┬───────┘         └──────┬──────┘
       │                       │                        │
       │                       │ "How is Mom's therapy  │
       │                       │  going?"               │
       │                       │                        │
       │                       ↓                        │
       │         ┌─────────────────────────┐           │
       │         │ CompanionCoordinator    │           │
       │         │ • Checks consent tier   │           │
       │         │ • Daughter = LIMITED    │           │
       │         └─────────────────────────┘           │
       │                       │                        │
       │                       ↓                        │
       │         ┌─────────────────────────┐           │
       │         │ privacyGuard            │           │
       │         │ • Therapy = BLOCKED     │           │
       │         │ • Meds = ALLOWED        │           │
       │         └─────────────────────────┘           │
       │                       │                        │
       │                       ↓                        │
       │         ┌─────────────────────────┐           │
       │         │ responseGenerator       │           │
       │         │ "Therapy content        │           │
       │         │  requires consent"      │           │
       │         └─────────────────────────┘           │
       │                       │                        │
       │                       ↓                        │
       │                  [Response sent]               │
       │                       │                        │
       │    ┌──────────────────┴─────────────┐         │
       │    │ circleBridge.notify()          │         │
       │    │ • Logs privacy violation       │         │
       │    │   attempt to Jane's record     │         │
       │    │ • NO alert to Jane (too noisy) │         │
       │    │ • Audit log for doctor review  │         │
       │    └────────────────────────────────┘         │
       │                                                │
```

---

## Key Data Flows

### 1. SQLite Database
```
┌─────────────────────────────────────────┐
│         SQLite Database                 │
├─────────────────────────────────────────┤
│                                         │
│  • care_circles                         │
│    - patient_id, caregiver_ids, etc.   │
│                                         │
│  • consent_tiers                        │
│    - user_id, circle_id, tier (0/1/2)  │
│                                         │
│  • conversation_turns                   │
│    - turn_id, circle_id, speaker,      │
│      message, response, timestamp       │
│                                         │
│  • patient_medications                  │
│    - patient_id, drug, dose, schedule   │
│                                         │
│  • event_log                            │
│    - event_type, user_id, metadata     │
│                                         │
└─────────────────────────────────────────┘
         ↑              ↑              ↑
         │              │              │
    handlers    actionExecutor   circleBridge
```

### 2. AWS Bedrock LLM API
```
┌───────────────────────────────────────────────┐
│           AWS Bedrock (us-east-1)             │
├───────────────────────────────────────────────┤
│                                               │
│  Llama 4 Scout (17B) - Response generation   │
│  • Used by: responseGenerator.js             │
│  • Tokens: ~500 per call                     │
│  • Rate limit: 50 req/min                    │
│                                               │
│  Llama 4 Maverick (70B) - Analysis           │
│  • Used by: aiAnalysisHandler.js             │
│  • Tokens: ~500 per call                     │
│  • Rate limit: 20 req/min                    │
│                                               │
└───────────────────────────────────────────────┘
         ↑                        ↑
         │                        │
  intentHandler          aiAnalysisHandler
```

---

## Component Responsibilities

### CompanionCoordinator.js (Orchestrator)
- **Input:** User message (from HTTP POST /message)
- **Does:** 
  - Identifies care circle
  - Checks user role
  - Routes to handler pipeline
  - Manages async coordination
- **Output:** Streams response via SSE

### intentHandler.js
- **Input:** Raw user message
- **Does:** 
  - Detects explicit commands ("call doctor", "share with X")
  - LLM classification
- **Output:** Intent type OR passes to next handler

### privacyGuard.js
- **Input:** User message + user role + consent tier
- **Does:**
  - Filters medical history
  - Blocks unauthorized content
- **Output:** Filtered context OR blocks message

### aiAnalysisHandler.js
- **Input:** User message + filtered context
- **Does:**
  - Sentiment analysis
  - Criticality assessment (LOW/MEDIUM/HIGH/CRITICAL)
  - Entity resolution
  - Medical keyword extraction
- **Output:** Analysis object (JSON)

### actionExecutor.js
- **Input:** Analysis object + conversation history
- **Does:**
  - Maps criticality → action cluster
  - Queries patient medications
  - Selects action (validate, give_facts, escalate, etc.)
- **Output:** Recommended action (string)

### responseGenerator.js
- **Input:** Action + analysis + history + patient context
- **Does:**
  - Builds prompt for LLM
  - Calls Scout for generation
  - Post-processes response
- **Output:** Natural language response (2-3 sentences)

### eventBus.js (Side Effects)
- **Triggers:** After response generation
- **Does:**
  - Logs conversation turn to SQLite
  - Emits events for monitoring
  - Triggers escalation if critical
  - Updates session state

### circleBridge.js (Multi-User Coordination)
- **Triggers:** When cross-circle notification needed
- **Does:**
  - Privacy-filtered summaries to caregivers
  - Critical alerts to doctors
  - Asynchronous message routing
- **Output:** Notifications to other care circle members

---

## Information Flow Summary

1. **User → Orchestrator:** Message arrives
2. **Orchestrator → Intent Handler:** Check for explicit commands
3. **Intent Handler → Privacy Guard:** Filter context by consent tier
4. **Privacy Guard → AI Analysis:** Deep semantic understanding
5. **AI Analysis → Action Executor:** Map analysis to action
6. **Action Executor → Response Generator:** Build LLM prompt
7. **Response Generator → User:** Stream response via SSE
8. **Response Generator → Side Effects:** Log, notify, escalate

**Total LLM calls per turn:** 3 (Intent: 200-300 tokens, Analysis: 400-500, Response: 400-500)  
**Total latency:** ~2-4 seconds (dominated by LLM API calls)  
**Total tokens:** ~1,000-1,300 per turn

---

## This is Experiment 0 (Baseline)

Experiments 1-7 (Chapter 4) **bypass this entire pipeline** and use Python-only:
- No multi-user coordination
- No privacy guards
- No intent handler
- Direct MCTS → LLM call (1-2 calls per turn vs 3)

That's why Exp 0 demonstrates **architectural richness** (multi-agent, privacy, coordination) while Exp 1-7 demonstrate **algorithmic sophistication** (MCTS planning, physiological optimization).
