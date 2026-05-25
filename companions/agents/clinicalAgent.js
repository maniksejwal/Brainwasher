/**
 * @fileoverview Clinical Agent Handler
 * Medical assessment and symptom evaluation
 *
 * DESIGN PRINCIPLE
 * ----------------
 * This agent makes exactly one LLM call. No regex, no keyword lists, no pre-filtering.
 *
 * Patients communicate in any language (Hindi, Arabic, Tamil, code-switching, informal
 * speech). Regex patterns built for English will silently fail on all others. The LLM
 * understands clinical meaning regardless of language — it is the only appropriate tool.
 *
 * CONTEXT VARIABLES
 * -----------------
 * HAS_SEVERE_INDICATORS  — derived from empathyHandler's stress level (not regex)
 * IS_SIMPLE_PAIN         — left as 'unknown' when context is insufficient; LLM decides
 * IS_FALL_FOR_ELDERLY    — derived from user age in context; true only if age >= 65
 * ANALOGY_PREFERENCE     — read from facts_v2 (RAG). The explainer (LLM) decides when
 *                          an analogy helps; this fact tells it whether the patient tends
 *                          to respond well to them based on past observed behaviour.
 *
 * FALLBACK POLICY
 * ---------------
 * On LLM failure the catch block returns a LOW-criticality safe default.
 * - llmFallback: true  → signals A3C scorer to penalise this turn's reward
 * - Logged with [SILENT_FALLBACK] prefix for monitoring and alerting
 * - System continues without crashing (graceful degradation)
 *
 * There are NO post-LLM regex overrides. If the LLM returns an incorrect criticality,
 * the correct fix is improving the prompt, not adding code that second-guesses it in a
 * language-dependent way.
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';
import { getCurrentFact } from '../../db/queries_facts.js';

/**
 * Process clinical analysis
 * @param {string} userId
 * @param {string} role
 * @param {string} message
 * @param {string} circleId
 * @param {object} context
 * @returns {Promise<object>} Clinical assessment
 */
export async function processClinicalAnalysis(userId, role, message, circleId, context) {
    // Use the full available history — older events carry clinical weight.
    // Example: a patient who had a seizure 15 turns ago is still high-risk.
    const conversationHistory = (context.history || []).slice(-20);
    const conversationHistoryText = conversationHistory
        .map(h => `${h.user_id}: ${h.message || ''}`)
        .join('\n') || 'No recent history';

    // ── Structural context hints (derived from non-message data, not regex) ──────
    // These are facts the clinical LLM cannot infer from message text alone.

    // Elevated stress from physio/empathy handler → higher prior for severe indicators
    const hasSevereIndicators = context.stressLevel === 'high' || context.stressLevel === 'critical'
        ? 'yes (elevated physiological stress detected)'
        : 'unknown — infer from message';

    // Simple pain heuristic: only asserted true if empathy handler classified it
    // as routine and no escalation was flagged by a prior turn.
    const isSimplePain = context.priorCriticality === 'LOW' && !context.escalationActive
        ? 'possibly — prior turn was LOW criticality, but verify from current message'
        : 'unknown — infer from message';

    // Fall risk: only meaningful if we know the patient is elderly.
    const userAge = parseInt(context.userAge, 10);
    const isFallForElderly = !isNaN(userAge) && userAge >= 65
        ? `yes — patient is ${userAge} years old (65+ threshold met)`
        : 'not applicable';

    // ── ANALOGY PREFERENCE from RAG (facts_v2) ───────────────────────────────────
    // The LLM (the explainer) decides *when* an analogy helps.
    // This fact tells it *whether* this patient has historically responded well to analogies
    // based on stored observations (e.g. "yes — uses analogies often in own messages").
    let analogyPreference = 'unknown — no stored preference';
    try {
        const analogyFact = await getCurrentFact(circleId, `communication_analogy_preference_${userId}`);
        if (analogyFact?.value) {
            analogyPreference = analogyFact.value;
        }
    } catch {
        // Non-fatal: preference remains unknown; LLM will infer from history
    }

    const prompt = loadPrompt('clinical', {
        MESSAGE:               message,
        ROLE:                  role,
        USER_AGE:              isNaN(userAge) ? (context.userAge || 'unknown') : String(userAge),
        HAS_SEVERE_INDICATORS: hasSevereIndicators,
        IS_SIMPLE_PAIN:        isSimplePain,
        IS_FALL_FOR_ELDERLY:   isFallForElderly,
        ANALOGY_PREFERENCE:    analogyPreference,
        CONVERSATION_HISTORY:  conversationHistoryText,
    });

    try {
        const result   = await makeApiCall(prompt, [], true);
        const analysis = parseCompanionResponse(result);

        if (!analysis) {
            throw new Error('LLM returned unparseable response');
        }

        return {
            assessment:            analysis.assessment || 'No immediate medical concerns',
            criticality:           analysis.criticality || 'NONE',
            privacyLevel:          analysis.privacyLevel || 'PRIVATE',
            hasMisconception:      analysis.has_misconception || false,
            misconceptionType:     analysis.misconception_type || 'none',
            educationalApproach:   analysis.educational_approach || null,
            escalateMisconception: analysis.escalate_misconception || false,
            llmFallback:           false,
            regexOverride:         null,
        };

    } catch (error) {
        // Silent fallback — LLM failed entirely. llmFallback: true penalises this turn in A3C.
        console.error(
            `[ClinicalAgent][SILENT_FALLBACK] LLM call failed — returning safe LOW default. ` +
            `userId=${userId} error="${error.message}" message="${message.substring(0, 80)}"`
        );
        return {
            assessment:            'Unable to complete clinical assessment',
            criticality:           'LOW',
            privacyLevel:          'PRIVATE',
            hasMisconception:      false,
            misconceptionType:     'none',
            educationalApproach:   null,
            escalateMisconception: false,
            llmFallback:           true,
            regexOverride:         null,
        };
    }
}
