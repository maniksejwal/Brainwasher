/**
 * @fileoverview Clinical Agent Handler
 * Medical assessment and symptom evaluation.
 *
 * The LLM is the only classifier: there are no keyword pre-checks or post-LLM overrides,
 * so messages in any language are assessed the same way. A wrong criticality is fixed in
 * the prompt, not with code that second-guesses it.
 *
 * Context hints come from non-message data (stress level, the speaker's previous
 * criticality, age, the stored analogy preference).
 *
 * If the LLM fails, the call is retried once. If it fails again the result is MEDIUM with
 * llmFallback set, so an unassessed message is never treated as minor.
 */

import { normalizeCriticality } from '../../utils/criticality.js';
import { normalizeHighCategory } from '../../config/emergencyGuidance.js';
import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';
import { getCurrentFact } from '../../db/queries_facts.js';

const MAX_ATTEMPTS = 2;
// A classifier, not a writer: the same message should get the same rating
export const CLINICAL_TEMPERATURE = 0;
// Selects BEDROCK_CLINICAL_MODEL_ID when set (agents/api/selector.js)
export const CLINICAL_USE_CASE = 'clinical_assessment';
export const FALLBACK_CRITICALITY = 'MEDIUM';

/**
 * Builds the context hints for the clinical prompt from non-message data.
 * @param {object} context - Conversation context
 * @returns {{hasSevereIndicators: string, isSimplePain: string, isFallForElderly: string, userAge: string}}
 */
export function buildClinicalHints(context = {}) {
    const hasSevereIndicators = context.stressLevel === 'high' || context.stressLevel === 'critical'
        ? 'yes (elevated physiological stress detected)'
        : 'unknown — infer from message';

    const isSimplePain = context.priorCriticality === 'LOW' && !context.escalationActive
        ? 'possibly — prior turn was LOW criticality, but verify from current message'
        : 'unknown — infer from message';

    const age = parseInt(context.userAge, 10);
    const isFallForElderly = !isNaN(age) && age >= 65
        ? `yes — patient is ${age} years old (65+ threshold met)`
        : 'not applicable';

    return {
        hasSevereIndicators,
        isSimplePain,
        isFallForElderly,
        userAge: isNaN(age) ? String(context.userAge || 'unknown') : String(age)
    };
}

/**
 * The speaker's stored analogy preference, or an unknown marker. Never fails the turn.
 * @param {string} circleId - Care circle ID
 * @param {string} userId - The speaker
 * @returns {Promise<string>}
 */
async function loadAnalogyPreference(circleId, userId) {
    try {
        const fact = await getCurrentFact(circleId, `communication_analogy_preference_${userId}`, userId);
        if (fact?.value) return fact.value;
    } catch (error) {
        console.warn('[ClinicalAgent] Could not read analogy preference:', error.message);
    }
    return 'unknown — no stored preference';
}

/**
 * One LLM assessment, or null when the call failed or its answer could not be used.
 * @param {string} prompt
 * @returns {Promise<object|null>}
 */
async function assessOnce(prompt) {
    try {
        const result = await makeApiCall(prompt, [], true, CLINICAL_TEMPERATURE, undefined, CLINICAL_USE_CASE);
        if (result?.isFallback) return null;
        const analysis = parseCompanionResponse(result, 'ClinicalAgent');
        if (!analysis?.criticality) return null;
        return analysis;
    } catch (error) {
        console.error('[ClinicalAgent] LLM call failed:', error.message);
        return null;
    }
}

/**
 * Process clinical analysis
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context
 * @returns {Promise<object>} Clinical assessment
 */
export async function processClinicalAnalysis(userId, role, message, circleId, context = {}) {
    // Older events carry clinical weight, so a longer window than the reply prompts use
    const conversationHistoryText = (context.history || []).slice(-20)
        .map(h => `${h.user_id}: ${h.message || ''}`)
        .join('\n') || 'No recent history';

    const hints = buildClinicalHints(context);
    const prompt = loadPrompt('clinical', {
        MESSAGE: message,
        ROLE: role,
        USER_AGE: hints.userAge,
        HAS_SEVERE_INDICATORS: hints.hasSevereIndicators,
        IS_SIMPLE_PAIN: hints.isSimplePain,
        IS_FALL_FOR_ELDERLY: hints.isFallForElderly,
        ANALOGY_PREFERENCE: await loadAnalogyPreference(circleId, userId),
        CONVERSATION_HISTORY: conversationHistoryText
    });

    let analysis = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !analysis; attempt++) {
        analysis = await assessOnce(prompt);
    }

    if (!analysis) {
        console.error(`[ClinicalAgent][LLM_FALLBACK] No assessment after ${MAX_ATTEMPTS} attempts; using ${FALLBACK_CRITICALITY}. userId=${userId}`);
        return {
            assessment: 'Unable to complete clinical assessment',
            criticality: FALLBACK_CRITICALITY,
            highCategory: null,
            privacyLevel: 'PRIVATE',
            hasMisconception: false,
            misconceptionType: 'none',
            educationalApproach: null,
            escalateMisconception: false,
            llmFallback: true
        };
    }

    const criticality = normalizeCriticality(analysis.criticality);
    return {
        assessment: analysis.assessment || 'No immediate medical concerns',
        criticality,
        // Only meaningful on HIGH; unknown values become null so the general sentence is used
        highCategory: criticality === 'HIGH' ? normalizeHighCategory(analysis.high_category) : null,
        privacyLevel: analysis.privacyLevel || 'PRIVATE',
        hasMisconception: analysis.has_misconception || false,
        misconceptionType: analysis.misconception_type || 'none',
        educationalApproach: analysis.educational_approach || null,
        escalateMisconception: analysis.escalate_misconception || false,
        llmFallback: false
    };
}
