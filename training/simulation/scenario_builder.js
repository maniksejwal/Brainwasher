/**
 * @fileoverview Scenario Builder - Generates combinatorial test scenarios
 * Combines existing personas and scenarios to create diverse test cases
 * Does NOT replace existing scenarios - adds to them
 */

import { PATIENT_PERSONAS } from './personas.js';

/**
 * Generate a combinatorial scenario from an existing persona and base scenario
 * @param {string} personaKey - Key from PATIENT_PERSONAS
 * @param {Object} baseScenario - The existing scenario object to use as context
 * @param {string} baseScenarioKey - The key of the base scenario
 * @returns {Object} Scenario object with overridden persona
 */
export function generateScenario(personaKey, baseScenario, baseScenarioKey) {
    const persona = PATIENT_PERSONAS[personaKey];

    if (!persona) {
        throw new Error(`Invalid persona key: ${personaKey}`);
    }
    if (!baseScenario) {
        throw new Error(`Invalid base scenario for key: ${baseScenarioKey}`);
    }

    // Clone the base scenario
    const newScenario = { ...baseScenario };

    // Override top-level metadata
    newScenario.name = `${persona.name} (Persona) in ${baseScenario.name}`;
    newScenario.description = `Generated: ${persona.name} (from ${personaKey}) facing ${baseScenario.name}`;
    newScenario.generated = true;
    newScenario.source = {
        persona: personaKey,
        base_scenario: baseScenarioKey
    };

    // Always set top-level persona for metadata/logging/compatibility
    const personaObj = {
        name: persona.name,
        description: persona.description,
        traits: persona.traits,
        medical_history: persona.medical_history,
        goals: persona.sample_goals || [],
        prompt_template: persona.prompt_template
    };
    newScenario.persona = personaObj;

    // Handle the 'users' array (standard way to define roles now)
    if (newScenario.users && newScenario.users.length > 0) {
        // Deep clone users array to avoid mutating base
        newScenario.users = JSON.parse(JSON.stringify(newScenario.users));

        // Assume the first user is the primary patient/user to override
        // (For single-user scenarios, this is always true)
        const primaryUser = newScenario.users[0];
        primaryUser.personaKey = personaKey;
        primaryUser.persona = personaObj; // Link/Copy
    }

    return newScenario;
}

/**
 * Filter base scenarios to find suitable ones for combination
 * @param {Object} allScenarios - The full map of scenarios
 * @returns {Object} Filtered simple scenarios
 */
function getSuitableBaseScenarios(allScenarios) {
    return Object.entries(allScenarios)
        .filter(([key, s]) =>
            !s.generated &&
            !s.circles &&
            // Allow scenarios with exactly 1 user OR no users defined (legacy)
            (!s.users || s.users.length === 1) &&
            s.complexity <= 4 // Relaxed complexity check
        )
        .reduce((acc, [key, s]) => {
            acc[key] = s;
            return acc;
        }, {});
}

/**
 * Generate all possible combinations of personas and situations
 * @param {Object} options - Configuration options
 * @param {Array} options.personas - Subset of persona keys to use (default: all)
 * @param {Object} options.baseScenarios - Map of scenarios to use as contexts (REQUIRED)
 * @returns {Object} Map of scenario names to scenario objects
 */
export function generateAllScenarios(options = {}) {
    // We expect baseScenarios to be passed in to avoid circular dependencies
    if (!options.baseScenarios) {
        console.warn('[ScenarioBuilder] No baseScenarios provided. Returning empty set.');
        return {};
    }

    const personaKeys = options.personas || Object.keys(PATIENT_PERSONAS);
    const suitableScenarios = getSuitableBaseScenarios(options.baseScenarios);
    const scenarioKeys = Object.keys(suitableScenarios);

    const generated = {};

    for (const pKey of personaKeys) {
        for (const sKey of scenarioKeys) {
            try {
                const s = suitableScenarios[sKey];
                const scenario = generateScenario(pKey, s, sKey);
                // Use a consistent naming convention
                const key = `generated_${pKey}_${sKey}`;
                generated[key] = scenario;
            } catch (err) {
                console.warn(`Skipping generation for ${pKey} + ${sKey}: ${err.message}`);
                // console.error(err); // debug
            }
        }
    }

    console.log(`[ScenarioBuilder] Generated ${Object.keys(generated).length} combinatorial scenarios`);
    console.log(`[ScenarioBuilder] Personas: ${personaKeys.length}, Base Scenarios: ${scenarioKeys.length}`);

    return generated;
}

/**
 * Get a subset of generated scenarios for testing
 * @param {number} count - Number of scenarios to return
 * @param {Object} options - Same as generateAllScenarios
 * @returns {Object} Random subset of generated scenarios
 */
export function getRandomGeneratedScenarios(count, options = {}) {
    const allScenarios = generateAllScenarios(options);
    const keys = Object.keys(allScenarios);

    // Shuffle
    const shuffled = keys.sort(() => Math.random() - 0.5);
    const selectedKeys = shuffled.slice(0, count);

    return selectedKeys.reduce((acc, key) => {
        acc[key] = allScenarios[key];
        return acc;
    }, {});
}
