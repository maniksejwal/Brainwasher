# Safe Implementation Roadmap for RL & Simulation

This document provides a step-by-step implementation plan that **builds new functionality alongside existing systems** without breaking current operations.

## Core Principles

1. **Non-Breaking**: New components run in parallel, existing code unchanged
2. **Testable**: Each phase has clear success criteria
3. **Reversible**: Easy rollback if issues arise
4. **Observable**: Track impact of changes through metrics

---

## Phase 1: Observability Layer (Start Here)

**Goal**: Passively record conversations and metrics without changing behavior

### 1.1 Training Data Logger

**File**: `training/logger.js` (new)

**Functionality**:
- Intercept conversations via event listener (not code modification)
- Record to `training/training_log.jsonl`
- Include: message, response, orchestrator decision, state vector
- **No changes to existing handlers**

**Integration Point**:
```javascript
// In messageHandler.js - ADD at the end, don't modify existing code
const trainingLogger = require('../training/logger');
// After response is generated:
trainingLogger.logInteraction({...}); // Fire-and-forget, no await
```

**Safety**: If logger crashes, conversation continues unaffected

### 1.2 Metrics Collection

**File**: `training/metrics.js` (new)

**Track**:
- Response time per agent
- Escalation frequency
- Privacy violation attempts (detected)
- Conflict resolution success rate
- Average message length

**Storage**: `training/metrics.jsonl`

**Safety**: Async collection, doesn't block main flow

### 1.3 Testing Strategy

**New Test File**: `tests/test_training_logger.js`

**Tests**:
1. Logger doesn't interfere with message flow
2. Logger handles crashes gracefully
3. Metrics are accurately recorded
4. JSONL files are valid
5. Existing tests still pass (run full suite)

**Success Criteria**:
- ✅ All existing tests pass
- ✅ 100 simulated conversations logged successfully
- ✅ No performance degradation (< 5ms overhead)

---

## Phase 2: Human Feedback Collection

**Goal**: Enable users and developers to rate interactions

### 2.1 `/score` Command

**File**: `handlers/commands/scoreCommand.js` (new)

**Functionality**:
```javascript
// Usage: /score +1 "Great escalation timing"
// Usage: /score -1 "Too verbose"
// Usage: /score 0 "Neutral"
```

**Database**:
```sql
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT,
  message_id INTEGER,
  user_id TEXT,
  score INTEGER, -- -1, 0, or +1
  comment TEXT,
  timestamp INTEGER
);
```

**Integration**: Add to existing command router in `handlers/commandHandler.js`

**Safety**: Read-only command, doesn't affect agent behavior

### 2.2 Annotator Tool

**File**: `training/annotator.js` (new)

**Functionality**:
- CLI tool to review conversations from `training_log.jsonl`
- Display conversation context
- Accept human ratings
- Append to feedback database

**Usage**:
```bash
node training/annotator.js --conversation conv_123
```

**Safety**: Completely offline tool, no production impact

### 2.3 Testing Strategy

**Tests**:
1. `/score` command parses input correctly
2. Feedback stored in database
3. Annotator displays conversations accurately
4. Invalid scores rejected

**Success Criteria**:
- ✅ 50+ human ratings collected
- ✅ No crashes from malformed input
- ✅ Feedback correlates with expected quality

---

## Phase 3: Simulation Infrastructure

**Goal**: Generate synthetic training data in isolated environment

### 3.1 Synthetic User Personas

**File**: `training/personas.js` (new)

**Implementation**:
```javascript
class SyntheticUser {
  constructor(persona) {
    this.persona = persona; // 'anxious_patient', 'overprotective_spouse', etc.
    this.goals = []; // Conversation goals
    this.memory = []; // Conversation history
  }
  
  async generateMessage(context) {
    // Use LLM to generate realistic message
    // Prompt: "You are a {persona}. Your goal is {goal}. Respond to: {lastMessage}"
  }
}
```

**Personas** (from framework doc):
- Patient: medication_nonadherent, denial_prone, anxious, elderly_cognitive
- Caregiver: overprotective_spouse, distant_child, professional, conflicted
- Doctor: time_pressured, empathetic, evidence_based

### 3.2 Simulation Runner

**File**: `training/simulator.js` (new)

**Key Feature**: Uses **separate test database** (`care_circle_test.db`)

**Functionality**:
```javascript
class SimulationDriver {
  async runSimulation(scenario) {
    // 1. Create test database
    // 2. Initialize synthetic users
    // 3. Run conversation (users talk to agents)
    // 4. Log all interactions
    // 5. Calculate reward scores
    // 6. Clean up test database
  }
}
```

**Safety Mechanisms**:
- Environment variable: `NODE_ENV=simulation`
- Separate database connection
- No access to production data
- Automatic cleanup after run

### 3.3 Scenario Runner

**File**: `training/scenario_runner.js` (new)

**Functionality**:
- Read scenarios from `scenarios/` directory
- Execute multiple simulations per scenario
- Aggregate results
- Generate reports

**Usage**:
```bash
node training/scenario_runner.js --scenario scenarios/01_basic_interactions.md --runs 10
```

### 3.4 Testing Strategy

**Tests**:
1. Personas generate realistic messages
2. Simulations use isolated database
3. No cross-contamination with production
4. Scenarios complete successfully
5. Reward scoring works correctly

**Success Criteria**:
- ✅ 1000+ simulated conversations generated
- ✅ All scenario types covered
- ✅ Production database never touched
- ✅ Reproducible results

---

## Phase 4: Meta-Learning & Optimization

**Goal**: Analyze feedback and improve prompts automatically

### 4.1 Feedback Analysis Agent

**File**: `training/feedback_analyzer.js` (new)

**Functionality**:
- Analyze `training_log.jsonl` + feedback database
- Identify patterns (verbosity, escalation timing, privacy)
- Generate analysis report

**Example Output**:
```
Analysis of unified_prompt_v3.1 (100 interactions):
- Average score: 0.3 / 1.0
- Common complaints: "too verbose" (40%), "missed escalation" (15%)
- High-scoring interactions: average 8 words, escalated within 2 messages
- Privacy violations: 5 instances
```

### 4.2 Prompt Optimization Agent

**File**: `training/prompt_optimizer.js` (new)

**Functionality**:
- Takes analysis report as input
- Generates improved prompt version
- Uses LLM meta-prompting
- Saves to `prompts/unified_prompt_v3.2.js`

**Safety**: Human reviews prompt before deployment

### 4.3 A/B Testing Framework

**File**: `training/ab_test.js` (new)

**Functionality**:
- Run simulations with both prompt versions
- Compare average rewards
- Statistical significance testing
- Generate comparison report

**Usage**:
```bash
node training/ab_test.js --baseline v3.1 --challenger v3.2 --runs 100
```

**Safety**: Testing in simulation only, not on real users initially

### 4.4 Testing Strategy

**Tests**:
1. Analyzer correctly identifies patterns
2. Optimizer generates valid prompts
3. A/B tests run fairly (same scenarios)
4. Statistical calculations accurate

**Success Criteria**:
- ✅ First optimized prompt shows improvement
- ✅ A/B tests are reproducible
- ✅ Clear documentation of changes

---

## Phase 5: RL Integration (Future)

**Goal**: Replace rule-based logic with learned policy

### 5.1 Shadow Mode

**File**: `training/rl_model.js` (new)

**Implementation**:
- RL model runs in parallel with rules
- Logs what it *would* have done
- Compare with actual actions taken
- No control over production responses

**Integration**:
```javascript
// In orchestrator.js
const rlAction = await rlModel.predict(stateVector); // Shadow
const ruleAction = await currentRules.decide(stateVector); // Production
trainingLogger.logShadowComparison(rlAction, ruleAction);
// Use ruleAction (existing behavior unchanged)
```

### 5.2 Gradual Rollout

**Strategy**:
1. Shadow mode: 0% traffic (observation only)
2. A/B test: 5% traffic to RL, 95% to rules
3. Increase: 25%, 50%, 75% based on metrics
4. Full deployment: 100% if RL outperforms

**Safety**: Circuit breaker - automatic rollback if metrics degrade

### 5.3 Testing Strategy

**Tests**:
1. RL model handles all state vector formats
2. Shadow mode doesn't affect latency
3. Rollback mechanism works
4. Metric comparison accurate

---

## Implementation Timeline

### Week 1
- [ ] Create `training/` directory structure
- [ ] Implement logger.js and metrics.js
- [ ] Add logging hooks (non-invasive)
- [ ] Test: Run existing test suite, verify no regression

### Week 2
- [ ] Implement `/score` command
- [ ] Create feedback database schema
- [ ] Build annotator.js tool
- [ ] Test: Collect 50+ human ratings

### Week 3
- [ ] Create personas.js
- [ ] Build simulator.js with test database
- [ ] Implement scenario_runner.js
- [ ] Test: Run 100+ simulations

### Week 4
- [ ] Build feedback_analyzer.js
- [ ] Create prompt_optimizer.js
- [ ] Implement ab_test.js
- [ ] Test: Generate first optimized prompt

### Week 5+
- [ ] Develop RL model
- [ ] Implement shadow mode
- [ ] Begin gradual rollout
- [ ] Monitor and iterate

---

## Safety Checklist (Every Phase)

Before deploying any change:

- [ ] All existing tests pass
- [ ] New tests cover new functionality
- [ ] Performance impact measured (< 10ms added latency)
- [ ] Error handling for edge cases
- [ ] Logging for debugging
- [ ] Documentation updated
- [ ] Rollback plan documented
- [ ] Code review completed

---

## Success Metrics

**Phase 1**: 1000+ logged interactions, 0 production issues
**Phase 2**: 100+ human ratings, clear quality signals
**Phase 3**: 10,000+ simulated conversations, diverse scenarios
**Phase 4**: First prompt optimization shows measurable improvement
**Phase 5**: RL matches or exceeds rule-based performance

---

## Next Immediate Steps

1. **Create directory structure**: `mkdir training/`
2. **Implement logger.js**: Start passive observation
3. **Run baseline tests**: Ensure current system is stable
4. **Begin logging**: Collect data for 1 week
5. **Review and iterate**: Assess data quality before Phase 2

This approach ensures you build a robust RL system without risking your working application.

