/**
 * @fileoverview training/simulation/personas/index.js
 *
 * Unified entry point for all persona collections.
 *
 * Persona taxonomy:
 *   PATIENT_PERSONAS           — standard clinical personas (personas.js)
 *   SYNTHETIC_USER_PERSONAS    — behavioural spectrum (intelligence/adversarial/buggy)
 *   BUSINESS_PERSONAS          — business/insurance/professional contexts
 *   THERAPY_PERSONAS           — deaddiction, flooding, negotiation (therapeutic MCTS)
 *   EDGE_CASE_PERSONAS         — bipolar, ASPD, NPD, game-theoretic
 *   RELIGION_PERSONAS          — multi-faith (6 religions)
 *   GAME_THEORY_PERSONAS       — strategic/BATNA-aware archetypes
 */

export { PATIENT_PERSONAS } from './personas.js';
export { SYNTHETIC_USER_PERSONAS, getPersonaByCharacteristics, getRandomPersonaByType } from './synthetic_user_personas.js';
export { THERAPY_PERSONAS, THERAPY_SCENARIOS, PROFESSIONAL_CRITIQUE_PERSONAS, PROFESSIONAL_CRITIQUE_SCENARIOS } from './therapy_personas.js';
export { EDGE_CASE_PERSONAS, RELIGION_PERSONAS, GAME_THEORY_PERSONAS, BIPOLAR_EXPERIMENT } from './edge_case_personas.js';

// Business personas re-export (check actual export name)
export * from './business_personas.js';

/**
 * Get all personas as a flat array for search/matching.
 */
export function getAllPersonas() {
    const collections = [];
    try {
        const { PATIENT_PERSONAS } = require('./personas.js');
        collections.push(...Object.values(PATIENT_PERSONAS));
    } catch {}
    return collections;
}

/**
 * Persona selector by domain and complexity.
 * @param {string} domain - 'deaddiction'|'flooding'|'negotiation'|'psychiatry'|'clinical_consultation'
 * @param {number} [complexity=3] - 1-5
 */
export function getPersonaByDomain(domain, complexity = 3) {
    // Therapy personas
    const therapyMap = {
        deaddiction:           ['alcohol_denial', 'opioid_intellectual'],
        flooding:              ['social_anxiety_flooding'],
        negotiation:           ['billing_dispute_stressed'],
        psychiatry:            ['bipolar_manic', 'bipolar_depressive'],
        clinical_consultation: ['npd_narcissistic', 'aspd_psychopathic'],
    };
    return therapyMap[domain] || [];
}
