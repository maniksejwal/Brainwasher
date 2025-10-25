/**
 * @fileoverview Centralized Scenario Categories
 * Provides consistent scenario categorization across all CLI tools
 */

import { SCENARIOS } from './scenarios.js';
import { PERSONAS } from './personas.js';

/**
 * Get all scenario categories with consistent naming and ordering
 */
export function getScenarioCategories() {
    return {
        '🎲 Basic Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'basic'),
        '🔺 Complex Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'complex'),
        '⚡ Conflict Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'conflict'),
        '🔒 Privacy Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'privacy'),
        '📈 Longitudinal Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'longitudinal'),
        '🧪 Stress Test Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'stress_test'),
        '🚭 Behavior Change Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'behavior_change'),
        '👥 Caregiver Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'caregiver'),
        '🚨 Escalation Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'escalation'),
        '🚫 Avoidance Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'avoidance'),
        '🎭 Deception Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'deception'),
        '👨‍👩‍👧‍👦 Multi-User Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'multi_user'),
        '🌍 Environmental Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'environmental'),
        '🏛️ Cultural Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'cultural'),
        '🔧 Practical Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'practical'),
        '🛡️ Preventative Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'preventative'),
        '❌ Misconception Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'misconception'),
        '👑 Family Dynamics Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'family_dynamics'),
        '💄 Psychology Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'psychology'),
        '🏊‍♀️ Lifestyle Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'lifestyle')
    };
}

/**
 * Display scenarios grouped by category
 */
export function displayScenariosByCategory(showNumbers = false) {
    const categories = getScenarioCategories();
    let optionNumber = 1;
    const options = [];

    for (const [categoryName, scenarios] of Object.entries(categories)) {
        if (scenarios.length > 0) {
            console.log(`\n${categoryName}:`);
            scenarios.forEach(([key, scenario]) => {
                const complexity = '★'.repeat(scenario.complexity);
                const multiUser = scenario.users.length > 1 ? '👥' : '👤';
                const multiSession = scenario.sessions ? '📅' : '';
                
                if (showNumbers) {
                    console.log(`  ${optionNumber.toString().padStart(2)}. ${scenario.name} ${multiUser}${multiSession} ${complexity}`);
                    options.push({ key, scenario });
                    optionNumber++;
                } else {
                    console.log(`  ${key.padEnd(25)} - ${scenario.name} ${multiUser}${multiSession} ${complexity}`);
                }
            });
        }
    }

    return options;
}

/**
 * Get persona categories with consistent naming
 */
export function getPersonaCategories() {
    return {
        'Patient Personas': Object.keys(PERSONAS).filter(k => 
            k.includes('patient') || ['medication_nonadherent', 'recently_diagnosed', 'complex_comorbid', 'terminal_acceptance'].includes(k)
        ),
        'Caregiver Personas': Object.keys(PERSONAS).filter(k => k.includes('caregiver')),
        'Doctor Personas': Object.keys(PERSONAS).filter(k => k.includes('doctor')),
        'Verbosity Variations': Object.keys(PERSONAS).filter(k => 
            ['minimal_words_patient', 'poor_grammar_patient', 'non_english_patient', 'verbose_patient', 'rambling_caregiver'].includes(k)
        )
    };
}

/**
 * Display personas grouped by category
 */
export function displayPersonasByCategory() {
    const categories = getPersonaCategories();
    
    for (const [categoryName, personas] of Object.entries(categories)) {
        if (personas.length > 0) {
            console.log(`\n${categoryName}:`);
            personas.forEach(persona => {
                const info = PERSONAS[persona];
                console.log(`  ${persona.padEnd(25)} - ${info?.name || 'Unknown'}`);
            });
        }
    }
}
