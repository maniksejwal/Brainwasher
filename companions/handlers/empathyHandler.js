/**
 * @fileoverview Empathy Handler
 * Decides between empathy and pragmatism based on user communication style, and on the
 * physiological stress state when context.physioState is supplied.
 *
 * With physioState, stress_index() sets the empathy level and a prompt hint tells the LLM
 * the patient's state; the LLM still writes the reply. Without it, the LLM decides the
 * level as before and the physio slots are empty.
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';
import { NO_ACTIONS_TAKEN } from '../../prompts/action_contract.js';
import { getCircleMembers } from '../../db/index.js';
import { describeWithheldFrom, withheldGuidance } from '../../services/sharingPolicy.js';
import { stress_index, stressLabel, gamma_from_state } from '../physio/state.js';

// Physio stress labels mapped to the empathy levels the rest of the system uses
const STRESS_TO_LEVEL = {
    calm: 'LOW',
    mild_stress: 'MEDIUM',
    moderate_stress: 'HIGH',
    high_stress: 'CRITICAL',
    critical_stress: 'CRITICAL'
};

/**
 * The physio-derived level, prompt slots and stress values, or empty values without physioState.
 * @param {object|undefined} physioState - PhysiologicalState from companions/physio/state.js
 * @returns {{level: string|null, label: string|null, stressIndex: number|null, gamma: number|null, physioContext: string, stressOverride: string}}
 */
export function physioInputs(physioState) {
    if (!physioState) {
        return { level: null, label: null, stressIndex: null, gamma: null, physioContext: '', stressOverride: '' };
    }
    const stressIndex = stress_index(physioState);
    const gamma = gamma_from_state(physioState);
    const { label, promptHint } = stressLabel(stressIndex);
    const level = STRESS_TO_LEVEL[label];
    if (process.env.DEBUG_COMPANION) {
        console.log(`[EmpathyHandler] Physio stress=${stressIndex.toFixed(3)} (${label}), gamma=${gamma.toFixed(4)}`);
    }
    return {
        level,
        label,
        stressIndex,
        gamma,
        physioContext: `\n\nPHYSIOLOGICAL CONTEXT (do not repeat this to the user): ${promptHint}`,
        stressOverride: level === 'CRITICAL'
            ? '\n\nIMPORTANT: Physiological stress is CRITICAL. Your reply must focus solely on calming the patient. Do NOT introduce any new clinical decisions or treatment changes.'
            : ''
    };
}

/**
 * Process empathy decision
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context. context.actionsTaken, when set, is the
 *   ACTIONS_TAKEN text for a reply written after this turn's actions ran. context.physioState
 *   is optional.
 * @returns {Promise<object>} { level, reply, stressIndex, stressLabel, gamma }
 */
export async function processEmpathyDecision(userId, role, message, circleId, context) {
    const physio = physioInputs(context.physioState);
    const members = context.members || await getCircleMembers(circleId).catch(() => []);
    const withheld = withheldGuidance(await describeWithheldFrom(circleId, userId, members));
    const prompt = loadPrompt('empathy', {
        MESSAGE: message,
        ROLE: role,
        CRITICALITY: context.clinicalAssessment?.criticality || 'NONE',
        ACTIONS_TAKEN: context.actionsTaken || NO_ACTIONS_TAKEN,
        PHYSIO_CONTEXT: physio.physioContext,
        STRESS_OVERRIDE: physio.stressOverride,
        WITHHELD_NOTE: withheld ? `
- ${withheld}` : ''
    });
    // The physio-derived level takes precedence over the LLM's when available
    const withPhysio = (level, reply) => ({
        level: physio.level || level,
        reply,
        stressIndex: physio.stressIndex,
        stressLabel: physio.label,
        gamma: physio.gamma
    });

    try {
        const result = await makeApiCall(prompt, [], true);

        // Debug: log what we received
        if (process.env.DEBUG_COMPANION) {
            console.log('[EmpathyHandler] Raw result:', JSON.stringify(result, null, 2));
        }

        const analysis = parseCompanionResponse(result, 'EmpathyHandler');

        if (!analysis) {
            // If parsing failed, check if result is a fallback response
            if (result && result.reply && typeof result.reply === 'string') {
                // This is a fallback - the API returned plain text
                console.warn('[EmpathyHandler] Received plain text response, using fallback');
                // Use the reply only if it is short enough
                return withPhysio('MEDIUM', result.reply.length > 200 ? null : result.reply);
            }
            throw new Error('Failed to parse JSON response');
        }

        return withPhysio(analysis.level || 'MEDIUM', analysis.reply || null);
    } catch (error) {
        console.error('[EmpathyHandler] Error:', error.message);
        return withPhysio('MEDIUM', null);
    }
}
