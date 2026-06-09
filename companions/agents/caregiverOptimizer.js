/**
 * @fileoverview Caregiver Optimizer Handler
 *
 * Optimizes responses specifically for caregivers — family members, friends, or
 * professional support workers who are caring for a patient in the circle.
 *
 * Distinct from patientOptimizer (patient-facing, empathy-first) and
 * doctorOptimizer (clinical-summary, evidence-first). This handler screens for
 * caregiver burden, secondary traumatic stress, and respite needs, which are
 * clinically significant but never addressed by the generic unifiedAgent prompt.
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';
import { validateAndAdjustResponse } from '../utils/responseStyleValidator.js';

/**
 * Detect caregiver burden signals in the message and conversation history.
 * Returns a plain-text hint injected into the prompt template.
 *
 * @param {string} message
 * @param {Array}  history
 * @returns {string}
 */
function detectBurdenSignal(message, history) {
    const burdenKeywords = [
        'tired', 'exhausted', 'burnout', 'burn out', 'overwhelmed', 'stressed',
        'can\'t cope', 'no time', 'no help', 'alone', 'nobody helps', 'by myself',
        'sacrifice', 'giving up', 'can\'t do this', 'too much', 'breaking down',
        'no break', 'no respite', 'no sleep', 'crying', 'frustrated', 'angry',
    ];
    const lowerMsg = message.toLowerCase();
    const matched = burdenKeywords.filter(k => lowerMsg.includes(k));

    // Also scan last 3 history turns for escalating burden language
    const recentBurden = (history || []).slice(-3).some(h =>
        burdenKeywords.some(k => (h.message || '').toLowerCase().includes(k))
    );

    if (matched.length > 0) {
        return `HIGH — current message contains burden signals: ${matched.slice(0, 3).join(', ')}`;
    }
    if (recentBurden) {
        return 'MODERATE — recent conversation history contains burden language';
    }
    return 'LOW — no explicit burden signals detected';
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
    const topicShift         = historyAnalysis.topicShift   ? 'yes' : 'no';

    let repetitionGuidance  = '';
    let topicShiftGuidance  = '';
    if (historyAnalysis.isRepetitive) {
        repetitionGuidance = 'CRITICAL: Repetition detected. Shift from patient-status questions to caregiver self-care.';
        topicShiftGuidance = 'TOPIC SHIFT REQUIRED: Try "We\'ve talked a lot about [patient] — how are YOU doing with all of this?"';
    }

    const burdenSignal = detectBurdenSignal(message, context.history);

    const prompt = loadPrompt('caregiver_optimizer', {
        MESSAGE:              message,
        CLINICAL_ASSESSMENT:  context.clinicalAssessment?.assessment || 'No immediate concerns',
        CRITICALITY:          context.clinicalAssessment?.criticality || 'NONE',
        BURDEN_SIGNAL:        burdenSignal,
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

        return { reply: validation.response || analysis.reply || null };
    } catch (error) {
        console.error('[CaregiverOptimizer] Error:', error.message);
        return { reply: null };
    }
}
