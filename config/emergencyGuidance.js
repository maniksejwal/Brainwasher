/**
 * @fileoverview config/emergencyGuidance.js
 * Approved emergency sentences that open every HIGH-criticality reply.
 * The sentence is inserted by code, never written by the model, so the
 * wording and the numbers can be reviewed in advance.
 *
 * NOTE: The wording below is a placeholder pending clinical review.
 */

// Per-deployment emergency numbers. The model never supplies numbers.
export const EMERGENCY_NUMBERS = {
    emergency: process.env.EMERGENCY_NUMBER || '112',
    mentalHealth: process.env.MENTAL_HEALTH_HELPLINE || '14416',
    mentalHealthName: process.env.MENTAL_HEALTH_HELPLINE_NAME || 'Tele-MANAS'
};

export const HIGH_CATEGORIES = ['MEDICAL_EMERGENCY', 'SELF_HARM_RISK', 'IMMEDIATE_DANGER'];

const { emergency, mentalHealth, mentalHealthName } = EMERGENCY_NUMBERS;

const SENTENCES = {
    MEDICAL_EMERGENCY: `Please call ${emergency} or go to the nearest emergency department now.`,
    SELF_HARM_RISK: `Please call ${emergency}, or ${mentalHealthName} on ${mentalHealth} to talk to someone now.`,
    IMMEDIATE_DANGER: `Please get to a safe place and call ${emergency}.`,
    GENERAL: `If you are in danger or this feels like an emergency, call ${emergency} now.`
};

/**
 * Validate a model-supplied HIGH category against the allowed list.
 * @param {string} category - Raw category from the clinical agent
 * @returns {string|null} The category, or null if missing or not recognized
 */
export function normalizeHighCategory(category) {
    const value = String(category || '').trim().toUpperCase();
    return HIGH_CATEGORIES.includes(value) ? value : null;
}

/**
 * Get the approved emergency sentence for a HIGH category.
 * Falls back to the general sentence when the category is missing or unknown.
 * @param {string} category - One of HIGH_CATEGORIES
 * @returns {string} Approved sentence
 */
export function getEmergencySentence(category) {
    return SENTENCES[normalizeHighCategory(category)] || SENTENCES.GENERAL;
}
