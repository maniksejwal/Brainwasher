/**
 * @fileoverview Scenario Package - Central index for all scenario groups
 * Organizes scenarios into logical groups for easier management
 */

import { BASIC_SCENARIOS } from './basic_scenarios.js';
import { INCRETIN_SCENARIOS } from './incretin_scenarios.js';
import { AVOIDANCE_SCENARIOS } from './avoidance_scenarios.js';
import { FUTURE_PLANNING_SCENARIOS } from './future_planning_scenarios.js';
import { CAREGIVER_SCENARIOS } from './caregiver_scenarios.js';
import { PRIVACY_SCENARIOS } from './privacy_scenarios.js';
import { MULTI_USER_SCENARIOS } from './multi_user_scenarios.js';
import { DECEPTION_SCENARIOS } from './deception_scenarios.js';
import { CONFLICT_SCENARIOS } from './conflict_scenarios.js';
import { ESCALATION_SCENARIOS } from './escalation_scenarios.js';
import { LONGITUDINAL_SCENARIOS } from './longitudinal_scenarios.js';
import { COMPLEX_SCENARIOS } from './complex_scenarios.js';
import { STRESS_TEST_SCENARIOS } from './stress_test_scenarios.js';
import { ENVIRONMENTAL_SCENARIOS } from './environmental_scenarios.js';
import { CULTURAL_SCENARIOS } from './cultural_scenarios.js';
import { PRACTICAL_SCENARIOS } from './practical_scenarios.js';
import { PREVENTATIVE_SCENARIOS } from './preventative_scenarios.js';
import { MISCONCEPTION_SCENARIOS } from './misconception_scenarios.js';
import { CURATIVE_SCENARIOS } from './curative_scenarios.js';
import { PALLIATIVE_SCENARIOS } from './palliative_scenarios.js';
import { ETHICAL_SCENARIOS } from './ethical_scenarios.js';
import { FAMILY_DYNAMICS_SCENARIOS } from './family_dynamics_scenarios.js';
import { PSYCHOLOGY_SCENARIOS } from './psychology_scenarios.js';
import { LIFESTYLE_SCENARIOS } from './lifestyle_scenarios.js';
import { BEHAVIOR_CHANGE_SCENARIOS } from './behavior_change_scenarios.js';
import { HOSPITAL_SCENARIOS } from '../hospital_scenarios.js';
import { NOTIFICATION_SCENARIOS } from './notification_scenarios.js';
// Import world scenario definitions directly to avoid circular dependency
import { WORLD_SCENARIOS_DEFINITIONS } from '../../world_simulation/world_scenarios.js';
// Import Scenario Builder for combinatorial scenario generation
import { generateAllScenarios, getRandomGeneratedScenarios } from '../scenario_builder.js';

// Export all scenarios as a single merged object (regular + world scenarios)
// NOTE: Generated scenarios are NOT included by default to avoid overwhelming the scenario pool
// Use getScenarios({ includeGenerated: true }) to include them
export const SCENARIOS = {
    ...BASIC_SCENARIOS,
    ...INCRETIN_SCENARIOS,
    ...AVOIDANCE_SCENARIOS,
    ...FUTURE_PLANNING_SCENARIOS,
    ...CAREGIVER_SCENARIOS,
    ...PRIVACY_SCENARIOS,
    ...MULTI_USER_SCENARIOS,
    ...DECEPTION_SCENARIOS,
    ...CONFLICT_SCENARIOS,
    ...ESCALATION_SCENARIOS,
    ...LONGITUDINAL_SCENARIOS,
    ...COMPLEX_SCENARIOS,
    ...STRESS_TEST_SCENARIOS,
    ...ENVIRONMENTAL_SCENARIOS,
    ...CULTURAL_SCENARIOS,
    ...PRACTICAL_SCENARIOS,
    ...PREVENTATIVE_SCENARIOS,
    ...MISCONCEPTION_SCENARIOS,
    ...CURATIVE_SCENARIOS,
    ...PALLIATIVE_SCENARIOS,
    ...ETHICAL_SCENARIOS,
    ...FAMILY_DYNAMICS_SCENARIOS,
    ...PSYCHOLOGY_SCENARIOS,
    ...LIFESTYLE_SCENARIOS,
    ...BEHAVIOR_CHANGE_SCENARIOS,
    ...HOSPITAL_SCENARIOS,
    ...NOTIFICATION_SCENARIOS,
    // World scenarios (multi-care circle scenarios)
    ...WORLD_SCENARIOS_DEFINITIONS
};

// Export individual groups for selective import
export { BASIC_SCENARIOS };
export { INCRETIN_SCENARIOS };
export { AVOIDANCE_SCENARIOS };
export { FUTURE_PLANNING_SCENARIOS };
export { CAREGIVER_SCENARIOS };
export { PRIVACY_SCENARIOS };
export { MULTI_USER_SCENARIOS };
export { DECEPTION_SCENARIOS };
export { CONFLICT_SCENARIOS };
export { ESCALATION_SCENARIOS };
export { LONGITUDINAL_SCENARIOS };
export { COMPLEX_SCENARIOS };
export { STRESS_TEST_SCENARIOS };
export { ENVIRONMENTAL_SCENARIOS };
export { CULTURAL_SCENARIOS };
export { PRACTICAL_SCENARIOS };
export { PREVENTATIVE_SCENARIOS };
export { MISCONCEPTION_SCENARIOS };
export { CURATIVE_SCENARIOS };
export { PALLIATIVE_SCENARIOS };
export { ETHICAL_SCENARIOS };
export { FAMILY_DYNAMICS_SCENARIOS };
export { PSYCHOLOGY_SCENARIOS };
export { LIFESTYLE_SCENARIOS };
export { BEHAVIOR_CHANGE_SCENARIOS };
export { HOSPITAL_SCENARIOS };
export { NOTIFICATION_SCENARIOS };

// Helper function to check if a scenario is a world scenario (has circles field)
export function isWorldScenario(scenario) {
    return scenario.circles !== undefined && Array.isArray(scenario.circles);
}

// Helper functions for scenario management
export function getScenariosByCategory(category) {
    return Object.entries(SCENARIOS)
        .filter(([_, scenario]) => scenario.category === category)
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
}

// Get only world scenarios
export function getWorldScenarios() {
    return Object.fromEntries(
        Object.entries(SCENARIOS).filter(([_, scenario]) => isWorldScenario(scenario))
    );
}

// Get only regular scenarios (non-world)
export function getRegularScenarios() {
    return Object.fromEntries(
        Object.entries(SCENARIOS).filter(([_, scenario]) => !isWorldScenario(scenario))
    );
}

export function getScenariosByComplexity(minComplexity, maxComplexity) {
    return Object.entries(SCENARIOS)
        .filter(([_, scenario]) =>
            scenario.complexity >= minComplexity &&
            scenario.complexity <= maxComplexity
        )
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
}

export function getRandomScenario(category = null) {
    let pool = SCENARIOS;
    if (category) {
        pool = getScenariosByCategory(category);
    }
    const keys = Object.keys(pool);
    return keys[Math.floor(Math.random() * keys.length)];
}

export function getScenarioGroups() {
    return {
        basic: BASIC_SCENARIOS,
        incretin: INCRETIN_SCENARIOS,
        avoidance: AVOIDANCE_SCENARIOS,
        future_planning: FUTURE_PLANNING_SCENARIOS,
        caregiver: CAREGIVER_SCENARIOS,
        privacy: PRIVACY_SCENARIOS,
        multi_user: MULTI_USER_SCENARIOS,
        deception: DECEPTION_SCENARIOS,
        conflict: CONFLICT_SCENARIOS,
        escalation: ESCALATION_SCENARIOS,
        longitudinal: LONGITUDINAL_SCENARIOS,
        complex: COMPLEX_SCENARIOS,
        stress_test: STRESS_TEST_SCENARIOS,
        environmental: ENVIRONMENTAL_SCENARIOS,
        cultural: CULTURAL_SCENARIOS,
        practical: PRACTICAL_SCENARIOS,
        preventative: PREVENTATIVE_SCENARIOS,
        misconception: MISCONCEPTION_SCENARIOS,
        curative: CURATIVE_SCENARIOS,
        palliative: PALLIATIVE_SCENARIOS,
        ethical: ETHICAL_SCENARIOS,
        family_dynamics: FAMILY_DYNAMICS_SCENARIOS,
        psychology: PSYCHOLOGY_SCENARIOS,
        lifestyle: LIFESTYLE_SCENARIOS,
        behavior_change: BEHAVIOR_CHANGE_SCENARIOS,
        hospital: HOSPITAL_SCENARIOS,
        notification: NOTIFICATION_SCENARIOS
    };
}

/**
 * Get scenarios with optional generated scenarios
 * @param {Object} options - Configuration
 * @param {boolean} options.includeGenerated - Include combinatorial generated scenarios
 * @param {number} options.generatedCount - Number of generated scenarios to include (default: all)
 * @param {Array} options.personas - Personas to use for generation
 * @param {Array} options.situations - Situations to use for generation
 * @returns {Object} Scenario map
 */
export function getScenarios(options = {}) {
    if (!options.includeGenerated) {
        return SCENARIOS;
    }

    // Generate scenarios based on options
    let generatedScenarios;
    if (options.generatedCount) {
        generatedScenarios = getRandomGeneratedScenarios(options.generatedCount, {
            personas: options.personas,
            baseScenarios: SCENARIOS // Inject the definitions
        });
    } else {
        generatedScenarios = generateAllScenarios({
            personas: options.personas,
            baseScenarios: SCENARIOS // Inject the definitions
        });
    }

    return {
        ...SCENARIOS,
        ...generatedScenarios
    };
}

