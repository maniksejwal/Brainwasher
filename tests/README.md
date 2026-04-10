# Test Suite Organization

This directory contains a comprehensive test suite organized by test type and scope.

## Directory Structure

```
tests/
├── unit/           # Unit Tests - Individual component testing
├── integration/    # Integration Tests - Component interaction testing  
├── e2e/           # End-to-End Tests - Full workflow testing
├── simulation/    # Simulation Tests - Scenario execution testing
├── verification/  # Verification Scripts - System state checking
├── cli/          # CLI Command Tests - Command-line interface testing
└── run_all_tests.js # Comprehensive test orchestrator
```

## Test Categories

### Unit Tests (`unit/`)
Test individual functions and components in isolation:
- `test_basic.js` - Basic functionality tests
- `test_circles.js` - Care circle management tests  
- `test_consent.js` - Consent handling tests
- `test_doctor.js` - Doctor workflow tests
- `test_fact_reporting.js` - Fact reporting tests

### Integration Tests (`integration/`)
Test component interactions and system integration:
- `test_enhanced_routing_system.js` - Message routing system tests
- `test_professional_circles.js` - Professional circle integration tests
- `test_conflict.js` - Conflict resolution system tests
- `test_escalation.js` - Escalation workflow tests
- `test_multi_role_companion.js` - Multi-role companion tests

### End-to-End Tests (`e2e/`)
Test complete workflows from user perspective:
- `test_simulation_api.js` - Simulation API workflow tests
- `test_document_collaboration.js` - Document collaboration workflow tests
- `test_business_forms.js` - Business form handling tests
- `test_autonomous_document_core.js` - Autonomous document features tests

### Simulation Tests (`simulation/`)
Test scenario execution and training systems:
- `run_simulation_llama.js` - LLaMA simulation runner
- `run_test_scenario.js` - Scenario execution tests
- `test_training_logger.js` - Training system tests

### Verification Scripts (`verification/`)
Diagnostic scripts for system state checking:
- `verify_storage.js` - Storage layer verification
- `verify_db_config.js` - Database configuration verification
- `verify_llama_api.js` - LLaMA API connectivity verification
- `verify_contextual_bandit.js` - Contextual bandit system verification

### CLI Tests (`cli/`)
Test command-line interface functionality:
- `batch_tester.js` - Non-interactive CLI command testing

## Running Tests

### Individual Test Suites
```bash
npm run test:unit        # Run unit tests
npm run test:integration # Run integration tests  
npm run test:e2e         # Run end-to-end tests
npm run test:cli         # Run CLI tests
npm run test:simulation  # Run simulation tests
npm run test:verify      # Run verification scripts
```

### Combined Test Runs
```bash
npm test                 # Run core test suite (unit + integration + CLI)
npm run test:all         # Run comprehensive test suite with reporting
```

### Individual Test Files
```bash
node tests/unit/test_basic.js                    # Single unit test
node tests/integration/test_conflict.js          # Single integration test
node tests/e2e/test_simulation_api.js           # Single E2E test
```

## Test Framework

We use a **custom test framework** (`TestRunner` class) with:
- Custom assertions (`assert.ok()`, etc.)
- Database setup/teardown
- Event-driven testing for CLI commands
- Simulation-based persona testing

## Adding New Tests

1. **Unit Tests**: Add to `unit/` for testing individual functions
2. **Integration Tests**: Add to `integration/` for testing component interactions
3. **E2E Tests**: Add to `e2e/` for testing complete user workflows  
4. **CLI Tests**: Add to `cli/` for testing command-line functionality
5. **Simulation Tests**: Add to `simulation/` for testing scenario execution

Update the appropriate npm script in `package.json` when adding new tests.