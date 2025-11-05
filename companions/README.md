# Companion System Architecture

## Terminology

- **Agent**: A coordination/decision-making AI that orchestrates multiple handlers (e.g., `CompanionCoordinationAgent`)
- **Companion**: A group of specialized handlers that work together for a specific user
- **Handler**: A specialized component within a Companion that handles one aspect (e.g., input understanding, escalation)

## Structure

```
companions/
├── CompanionCoordinator.js       # Coordinator - coordinates all Companion components
├── handlers/                      # Handlers (processors)
│   ├── inputUnderstanding.js     # Intent, entity extraction, parsing
│   ├── historyAnalyzer.js        # Context analysis, pattern detection
│   ├── empathyHandler.js         # Empathy vs pragmatism decision
│   └── privacyGuard.js           # Consent, privacy, sharing decisions
├── agents/                        # Agents (decision-makers)
│   ├── clinicalAgent.js          # Medical assessment, symptom evaluation
│   ├── escalationManager.js      # Criticality, escalation logic
│   ├── patientOptimizer.js       # Patient-focused responses
│   └── doctorOptimizer.js        # Doctor-focused responses
└── utils/
    ├── responseAggregator.js     # Combines handler outputs
    └── conflictResolver.js       # Resolves conflicts between handlers
```

## How It Works

1. User message arrives
2. `CompanionCoordinator` activates all relevant handlers and agents in parallel
3. Each handler/agent returns its analysis/recommendation
4. `CompanionCoordinator` aggregates and decides on final response
5. Response sent to user

## Structure

A **Companion** = Coordinators + Agents + Handlers (all together serve a user)

## Configuration

Control via `config.js`:
- `USE_COMPANIONS`: Toggle between Companion system and unified agent
- `COMPANION_AB_TEST_ENABLED`: Enable A/B testing
- `COMPANION_AB_TEST_RATIO`: Percentage to use Companion (0.0 - 1.0)

## Training & Simulation

- Uses config to determine which system to use
- Tracks which system (Companion vs unified) was used in feedback
- A/B tests can compare performance

