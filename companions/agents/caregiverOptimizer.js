/**
 * @fileoverview Caregiver Optimizer Handler
 *
 * Optimizes responses specifically for caregivers — family members, friends, or
 * professional support workers who are caring for a patient in the circle.
 *
 * Two LLM calls per activation:
 *   1. assessCaregiverBurden() — lightweight Scout call that reads the message
 *      and last 5 turns and returns a structured burden assessment.
 *      Runs in parallel with the main prompt construction.
 *   2. processCaregiverOptimization() main call — uses the burden assessment
 *      as the BURDEN_SIGNAL template variable.
 *
 * Using an LLM for burden assessment (not keywords) allows it to understand:
 *   - indirect or euphemistic language ("I'll manage", "it's fine" said repeatedly)
 *   - cultural understatement patterns
 *   - implicit burden from patient status updates ("she had another fall last night")
 *   - accumulated burden across the recent conversation arc, not just the current turn
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';
import { validateAndAdjustResponse } from '../utils/responseStyleValidator.js';

// ── Burden assessment prompt ──────────────────────────────────────────────────
// Kept short and schema-constrained so it runs fast as a pre-pass.
const BURDEN_ASSESSMENT_PROMPT = `You are a clinical screener assessing caregiver burden.

Read the caregiver's message and conversation history below.

Assess the following dimensions:
1. Burden level: LOW | MODERATE | HIGH
   - LOW: caregiver appears stable, no distress signals
   - MODERATE: indirect signs of strain (minimising language, logistical overwhelm, mentions of fatigue)
   - HIGH: explicit distress, breakdown signals, isolation, statements of inability to cope

2. Burden type (choose all that apply, or empty array if none):
   "physical" | "emotional" | "isolation" | "secondary_trauma" | "role_conflict" | "respite_deficit"

3. Understatement: true | false
   Whether the caregiver appears to be minimising or concealing their distress
   (e.g. "it's fine", "I'll manage" when context suggests otherwise).

4. One sentence: the most clinically significant thing to address this turn
   (or null if no specific concern).

Caregiver message: "{{MESSAGE}}"

Recent conversation:
{{CONVERSATION_HISTORY}}

Return ONLY valid JSON, no other text:
{
  "burden_level": "LOW" | "MODERATE" | "HIGH",
  "burden_types": [],
  "understatement": true | false,
  "priority_concern": "..." | null
}`;

/**
 * Assess caregiver burden via a lightweight LLM pre-pass.
 * Returns a structured object; falls back to a safe LOW-burden default on error.
 *
 * @param {string} message
 * @param {string} historyText  — pre-formatted history string
 * @returns {Promise<{burden_level: string, burden_types: string[], understatement: boolean, priority_concern: string|null, summary: string}>}
 */
async function assessCaregiverBurden(message, historyText) {
    const fallback = {
        burden_level:    'UNKNOWN',
        burden_types:    [],
        understatement:  false,
        priority_concern: null,
        summary:         'Burden assessment unavailable — treat with care.',
    };

    try {
        const prompt = BURDEN_ASSESSMENT_PROMPT
            .replace('{{MESSAGE}}', message)
            .replace('{{CONVERSATION_HISTORY}}', historyText);

        const result   = await makeApiCall(prompt, [], true);
        const analysis = parseCompanionResponse(result);

        if (!analysis?.burden_level) return fallback;

        const level    = analysis.burden_level;
        const types    = Array.isArray(analysis.burden_types) ? analysis.burden_types : [];
        const under    = Boolean(analysis.understatement);
        const concern  = analysis.priority_concern || null;

        const typeStr  = types.length > 0 ? ` (${types.join(', ')})` : '';
        const underStr = under ? ' — possible understatement detected' : '';
        const summary  = `${level}${typeStr}${underStr}${concern ? `. Priority: ${concern}` : ''}`;

        return { burden_level: level, burden_types: types, understatement: under, priority_concern: concern, summary };
    } catch {
        return fallback;
    }
}

/**
 * Process caregiver optimization.
 *
 * @param {string} userId
 * @param {string} role
 * @param {string} message
 * @param {string} circleId
 * @param {object} context
 * @returns {Promise<{ reply: string|null }>}
 */
export async function processCaregiverOptimization(userId, role, message, circleId, context) {
    if (role !== 'caregiver') {
        return { reply: null };
    }

    const historyAnalysis      = context.historyAnalyzer || {};
    const conversationHistory  = (context.history || []).slice(-5);
    const conversationHistoryText = conversationHistory
        .map(h => `${h.user_id}: ${h.message}`)
        .join('\n') || 'No recent history';

    const repetitionDetected = historyAnalysis.isRepetitive ? 'yes' : 'no';

    let repetitionGuidance  = '';
    let topicShiftGuidance  = '';
    if (historyAnalysis.isRepetitive) {
        repetitionGuidance = 'CRITICAL: Repetition detected. Shift from patient-status questions to caregiver self-care.';
        topicShiftGuidance = 'TOPIC SHIFT REQUIRED: Try "We\'ve talked a lot about [patient] — how are YOU doing with all of this?"';
    }

    // Run burden assessment in parallel with prompt construction (no extra wall-clock cost).
    const burdenAssessment = await assessCaregiverBurden(message, conversationHistoryText);

    if (process.env.DEBUG_COMPANION) {
        console.log('[CaregiverOptimizer] burden assessment:', burdenAssessment);
    }

    const prompt = loadPrompt('caregiver_optimizer', {
        MESSAGE:              message,
        CLINICAL_ASSESSMENT:  context.clinicalAssessment?.assessment || 'No immediate concerns',
        CRITICALITY:          context.clinicalAssessment?.criticality || 'NONE',
        BURDEN_SIGNAL:        burdenAssessment.summary,
        REPETITION_DETECTED:  repetitionDetected,
        REPETITION_GUIDANCE:  repetitionGuidance,
        TOPIC_SHIFT_GUIDANCE: topicShiftGuidance,
        CONVERSATION_HISTORY: conversationHistoryText,
    });

    try {
        const result   = await makeApiCall(prompt, [], true);
        const analysis = parseCompanionResponse(result);

        if (!analysis) {
            if (result?.reply && typeof result.reply === 'string') {
                console.warn('[CaregiverOptimizer] Received plain text fallback, using as reply');
                return { reply: result.reply };
            }
            throw new Error('Failed to parse JSON response');
        }

        const validation = validateAndAdjustResponse(
            analysis.reply,
            message,
            historyAnalysis,
            conversationHistory,
            { allowBlankTurns: false, allowRepetition: false, allowYesNo: false, requireProbing: true }
        );

        if (validation.needsRegeneration && process.env.DEBUG_COMPANION) {
            console.warn('[CaregiverOptimizer] Response style issues:', validation.adjustments);
        }

        return {
            reply:             validation.response || analysis.reply || null,
            burdenAssessment,  // surfaced for upstream context enrichment
        };
    } catch (error) {
        console.error('[CaregiverOptimizer] Error:', error.message);
        return { reply: null };
    }
}
