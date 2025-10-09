# Training & Reinforcement Learning System

This directory contains the complete infrastructure for training, simulating, and optimizing the multi-agent healthcare system through reinforcement learning and meta-learning.

## 📚 Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Components](#components)
4. [Workflows](#workflows)
5. [Usage Examples](#usage-examples)
6. [Safety Features](#safety-features)

---

## Overview

The training system implements a comprehensive approach to improving AI agent performance:

1. **Passive Observation** - Non-invasive logging of real interactions
2. **Human Feedback** - In-app `/score` command and offline annotation tool
3. **Simulation** - Synthetic user personas for generating training data
4. **Analysis** - AI-powered feedback pattern identification
5. **Optimization** - Automatic prompt improvement via meta-learning
6. **A/B Testing** - Statistical comparison of prompt versions

**Key Principle**: All components are designed to run **alongside** production without breaking existing functionality.

---

## Quick Start

### 1. Start Collecting Training Data

Training data collection happens automatically once integrated (already done in `messageHandler.js`). No additional setup needed!

```bash
# Check if logging is working
ls training/training_log.jsonl
ls training/metrics.jsonl
```

### 2. Provide Human Feedback (Optional)

Users can rate interactions in real-time:

```
/score +1 "Great response!"
/score -1 "Too verbose"
```

Or use the offline annotator:

```bash
node training/annotator.js
```

### 3. Run Simulations

Generate synthetic training data:

```bash
# Run example simulation
node training/simulator.js

# Run all scenarios
node training/scenario_runner.js --runs 10

# Run specific scenario
node training/scenario_runner.js --scenario "basic" --runs 5
```

### 4. Analyze Feedback

Generate performance analysis report:

```bash
node training/feedback_analyzer.js
```

This creates `training/analysis_report.md` with AI-powered insights.

### 5. Optimize Prompts

Automatically improve prompts based on feedback:

```bash
# Optimize main unified prompt
node training/prompt_optimizer.js

# Optimize specific prompt
node training/prompt_optimizer.js --prompt prompts/intent_prompt.js

# Optimize all prompts
node training/prompt_optimizer.js --all
```

### 6. A/B Test

Compare prompt versions:

```bash
node training/ab_test.js --baseline v1.0 --challenger v1.1 --runs 20
```

---

## Components

### Phase 1: Observability Layer

#### `logger.js`
**Purpose**: Passively records all conversations for training analysis.

**Features**:
- Non-blocking, fire-and-forget logging
- JSONL format for easy parsing
- Includes message, response, orchestrator action, state vector
- Fault-tolerant (crashes don't affect main flow)

**Data Format**:
```json
{
  "timestamp": 1726055220,
  "conversation_id": "conv_123",
  "user_id": "alice",
  "message": "I feel dizzy",
  "agent_response": "I'm concerned about dizziness...",
  "orchestrator_action": {"type": "ESCALATE"},
  "state_vector": {...},
  "prompt_version": "unified_v1.0",
  "latency_ms": 234
}
```

#### `metrics.js`
**Purpose**: Collects performance metrics in real-time.

**Tracked Metrics**:
- Response time per agent type
- Escalation frequency
- Privacy violation attempts (detected/blocked)
- Conflict resolution success rate
- Message/response length ratios

**Usage**:
```javascript
import metricsCollector from './training/metrics.js';
metricsCollector.recordResponseTime('unified_agent', 250, true);
metricsCollector.recordEscalation('alice', 'dizziness', true);
```

---

### Phase 2: Human Feedback Collection

#### `/score` Command
**Purpose**: Allow users to rate AI interactions in real-time.

**Usage**:
```
/score +1             # Good interaction
/score 0              # Neutral
/score -1             # Bad interaction
/score +1 "Perfect timing on that escalation"
```

**Database**:
```sql
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  conversation_id TEXT,
  message_id INTEGER,
  user_id TEXT,
  score INTEGER,        -- -1, 0, or +1
  comment TEXT,
  timestamp INTEGER
);
```

#### `annotator.js`
**Purpose**: Offline tool for reviewing and annotating training logs.

**Features**:
- Interactive CLI for reviewing conversations
- Filters already-annotated entries
- Supports multiple annotators
- Statistics dashboard

**Usage**:
```bash
# Start annotation session
node training/annotator.js

# Show statistics
node training/annotator.js --stats

# Annotate as specific reviewer
node training/annotator.js --id "reviewer_jane"

# Limit session
node training/annotator.js --max 20
```

---

### Phase 3: Simulation Infrastructure

#### `personas.js`
**Purpose**: Defines synthetic user personas for realistic simulations.

**Persona Categories**:

**Patients**:
- `medication_nonadherent` - Forgets/skips medications
- `denial_prone` - Minimizes symptoms
- `anxious_patient` - Catastrophizes health concerns
- `elderly_cognitive` - Memory issues, confusion

**Caregivers**:
- `overprotective_spouse` - Vigilant, reports everything
- `distant_child` - Limited availability, needs summaries
- `professional_caregiver` - Clinical, objective
- `conflicted_family` - Complicated relationship with patient

**Doctors**:
- `time_pressured` - Busy, efficient, terse
- `empathetic_gp` - Warm, relationship-focused
- `evidence_based` - Research-oriented, data-driven

**Usage**:
```javascript
import { getPersona, listPersonas } from './personas.js';

const persona = getPersona('patient', 'anxious_patient');
const allPatients = listPersonas('patient');
```

#### `simulator.js`
**Purpose**: Core simulation engine for generating synthetic conversations.

**Safety Features**:
- **Separate test database** (`care_circle_simulation.db`)
- Never touches production data
- Environment variable protection
- Automatic cleanup

**Usage**:
```javascript
import { SimulationDriver } from './simulator.js';

const scenario = {
  name: 'Medication Non-Adherence Test',
  users: [
    { userId: 'alice', role: 'patient', personaKey: 'medication_nonadherent' }
  ],
  circle: { patientId: 'alice', caregiverIds: [] },
  turns: 10
};

const sim = new SimulationDriver();
await sim.runScenario(scenario);
await sim.cleanup();
```

#### `scenario_runner.js`
**Purpose**: Batch execution of multiple simulation scenarios.

**Features**:
- Reads from `scenarios/` directory
- Generates variations with different personas
- Runs multiple iterations per scenario
- Comprehensive results summary

**Usage**:
```bash
# Run all scenarios (3 iterations each)
node training/scenario_runner.js

# Run with more iterations
node training/scenario_runner.js --runs 10

# Run specific scenario
node training/scenario_runner.js --scenario "conflict"

# List available personas
node training/scenario_runner.js --personas
```

---

### Phase 4: Meta-Learning & Optimization

#### `feedback_analyzer.js`
**Purpose**: AI-powered analysis of training logs and feedback.

**Analysis Output**:
- Overall quality scores
- Common failure patterns
- High-performing interaction characteristics
- AI-generated recommendations
- Prioritized improvement list

**Report Sections**:
1. Executive Summary
2. Detailed Statistics
3. Problem Pattern Analysis
4. High-Performing Interactions
5. AI-Powered Analysis
6. Priority Recommendations

**Usage**:
```bash
# Generate analysis report
node training/feedback_analyzer.js
# Output: training/analysis_report.md
```

#### `prompt_optimizer.js`
**Purpose**: Automatically improves prompts using AI meta-prompting.

**Process**:
1. Load current prompt
2. Load analysis report
3. Generate optimized version via LLM
4. Save as new version (e.g., `v1.0` → `v1.1`)
5. Show diff preview

**Features**:
- Preserves prompt structure
- Addresses specific identified issues
- Generates changelog
- Version numbering
- Diff preview

**Usage**:
```bash
# Optimize unified prompt
node training/prompt_optimizer.js

# Optimize specific prompt
node training/prompt_optimizer.js --prompt prompts/doctor_prompts.js

# Optimize all prompts in directory
node training/prompt_optimizer.js --all
```

**Output Example**:
```
prompts/
  unified_prompt.js      # Original
  unified_prompt_v1.1.js # Optimized version
```

#### `ab_test.js`
**Purpose**: Statistical comparison of prompt versions.

**Process**:
1. Run N simulations with baseline version
2. Run N simulations with challenger version
3. Compare performance metrics
4. Generate statistical report
5. Provide deployment recommendation

**Metrics Compared**:
- Success rate
- Average duration
- Error rate
- (Future: human feedback scores)

**Usage**:
```bash
# Compare two versions
node training/ab_test.js --baseline v1.0 --challenger v1.1 --runs 20

# Quick test (5 runs)
node training/ab_test.js --baseline v1.0 --challenger v1.1 --runs 5
```

**Report Output**:
```
training/ab_test_v1.0_vs_v1.1_1234567890.md
```

---

## Workflows

### Workflow 1: Continuous Improvement Cycle

```
┌─────────────────────────────────────────────────────────┐
│ 1. Real users interact with system                      │
│    └─> Auto-logged to training_log.jsonl                │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 2. Users provide feedback via /score                     │
│    └─> Stored in feedback database                      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 3. Run feedback analyzer (weekly)                        │
│    └─> Identifies patterns and issues                   │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 4. Run prompt optimizer                                  │
│    └─> Generates improved prompt version                │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 5. A/B test new version in simulations                   │
│    └─> Compare performance                              │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 6. Deploy if improved, otherwise iterate                │
└─────────────────────────────────────────────────────────┘
```

### Workflow 2: Pre-Launch Testing

Before deploying a new feature:

```bash
# 1. Generate synthetic training data
node training/scenario_runner.js --runs 50

# 2. Analyze performance
node training/feedback_analyzer.js

# 3. If issues found, optimize
node training/prompt_optimizer.js

# 4. A/B test
node training/ab_test.js --baseline current --challenger optimized --runs 30

# 5. Deploy winner
```

### Workflow 3: Manual Review Session

For quality assurance:

```bash
# 1. Start annotation session
node training/annotator.js --max 50

# 2. Review conversations and provide scores

# 3. Check statistics
node training/annotator.js --stats

# 4. Generate analysis
node training/feedback_analyzer.js
```

---

## Usage Examples

### Example 1: First-Time Setup

```bash
# Already done! Logging is integrated in messageHandler.js
# Just start using the system normally

# After some interactions, check logs
cat training/training_log.jsonl | wc -l  # Count interactions

# Rate some interactions
# (In app): /score +1 "Good job"

# Generate first analysis
node training/feedback_analyzer.js
```

### Example 2: Weekly Optimization

```bash
# Monday: Generate analysis
node training/feedback_analyzer.js

# Tuesday: If issues found, optimize
node training/prompt_optimizer.js

# Wednesday: Test optimized version
node training/ab_test.js --baseline v1.2 --challenger v1.3 --runs 30

# Thursday: If improved, deploy v1.3 to production
# (Manual step: update import in code to use new version)
```

### Example 3: Adding New Persona

```javascript
// 1. Edit training/personas.js
export const PATIENT_PERSONAS = {
  // ... existing personas ...
  
  new_persona_key: {
    name: 'New Persona Name',
    description: 'Description',
    traits: {
      forgetfulness: 0.5,
      denial: 0.3,
      honesty: 0.8,
      anxiety: 0.6
    },
    prompt_template: `You are a patient with...`
  }
};

// 2. Test in simulation
node training/simulator.js
// (Modify example to use new persona)

// 3. Add to scenario_runner.js scenarios
```

---

## Safety Features

### 1. Production Isolation

- **Separate Database**: Simulations use `care_circle_simulation.db`
- **Never touches production data**
- **Safety checks** prevent accidental production use

```javascript
// In simulator.js
if (this.dbPath.includes('care_circle.db') && !this.dbPath.includes('simulation')) {
    throw new Error('SAFETY: Attempted to use production database!');
}
```

### 2. Non-Invasive Logging

- Fire-and-forget: Logging failures don't crash main flow
- Minimal overhead (< 5ms per interaction)
- Async, non-blocking
- Can be disabled via env var

```javascript
// In logger.js
async logInteraction(data) {
    if (!this.enabled) return;
    try {
        // ... logging ...
    } catch (error) {
        // Fail silently - don't break conversation
        console.error('[Logger] Error:', error.message);
    }
}
```

### 3. Rollback Capability

- Prompts are versioned (v1.0, v1.1, v1.2...)
- Original prompts never overwritten
- Easy to revert if optimization degrades performance
- A/B testing validates before deployment

### 4. Human Oversight

- All optimizations are human-reviewable
- AI generates suggestions, humans decide
- Clear changelogs for each version
- Statistical validation required

---

## File Structure

```
training/
├── README.md                   # This file
├── logger.js                   # Passive conversation logging
├── metrics.js                  # Performance metrics collection
├── annotator.js                # Offline annotation tool
├── personas.js                 # Synthetic user personas
├── simulator.js                # Simulation engine
├── scenario_runner.js          # Batch simulation runner
├── feedback_analyzer.js        # AI-powered analysis
├── prompt_optimizer.js         # Automated prompt improvement
├── ab_test.js                  # A/B testing framework
├── training_log.jsonl          # Training data (auto-generated)
├── metrics.jsonl               # Metrics data (auto-generated)
├── analysis_report.md          # Analysis output (generated)
└── ab_test_*.md                # A/B test reports (generated)
```

---

## Environment Variables

```bash
# Disable training logging (if needed)
TRAINING_MODE=disabled

# Disable metrics collection
METRICS_COLLECTION=disabled

# Set annotator ID
ANNOTATOR_ID=reviewer_jane
```

---

## Next Steps

1. **Let data accumulate** - Run the system normally for a week
2. **Collect feedback** - Encourage users to use `/score`
3. **Run first analysis** - `node training/feedback_analyzer.js`
4. **Generate simulations** - `node training/scenario_runner.js --runs 20`
5. **Optimize prompts** - `node training/prompt_optimizer.js`
6. **A/B test** - `node training/ab_test.js --runs 30`
7. **Deploy if improved** - Update production to use optimized version
8. **Repeat** - Continuous improvement cycle

---

## Troubleshooting

### "No data available for analysis"
- **Cause**: No interactions logged yet
- **Solution**: Use the system for a few days, or run simulations

### "No AI API keys configured"
- **Cause**: Missing GEMINI_API_KEY or CHAT_GPT_KEY
- **Solution**: Add keys to `.env` file

### "Simulation database contamination"
- **Cause**: Shouldn't happen (safety checks in place)
- **Solution**: Delete `care_circle_simulation.db`, never `care_circle.db`

### "A/B test shows no difference"
- **Cause**: Not enough runs, or changes are subtle
- **Solution**: Increase `--runs` to 50-100

---

## Contributing

When adding new components:

1. Follow non-invasive design principles
2. Add comprehensive error handling
3. Include safety checks for production isolation
4. Document in this README
5. Add tests to verify functionality

---

## References

- [Reinforcement Learning Framework](../documentation/reinforcement_learning_framework.md)
- [Implementation Roadmap](../documentation/implementation_roadmap.md)
- [Agentic Framework](../documentation/agentic_framework.md)

---

**Built with safety, testing, and continuous improvement in mind** 🚀

