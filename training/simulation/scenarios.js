/**
 * @fileoverview training/simulation/scenarios.js
 * Re-exports all scenarios from the scenarios package.
 * This file is now a thin wrapper around the scenarios package.
 */

// Import from scenario package
import { SCENARIOS } from './scenarios/index.js';

// Re-export scenarios
export { SCENARIOS };
export { SCENARIOS as default };

// Import helper functions
import { 
    getScenariosByCategory, 
    getScenariosByComplexity, 
    getRandomScenario,
    getScenarioGroups 
} from './scenarios/index.js';

// Re-export helper functions
export { getScenariosByCategory, getScenariosByComplexity, getRandomScenario, getScenarioGroups };
