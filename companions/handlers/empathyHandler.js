/**
 * @fileoverview Empathy Handler
 * Decides between empathy and pragmatism based on user communication style
 * AND physiological stress state when available.
 *
 * Physio integration
 * ------------------
 * If context.physioState is present (a PhysiologicalState object from
 * companions/physio/state.js), the stress_index() drives the empathy level
 * directly — no LLM call needed for the level decision. The LLM is still used
 * to generate the actual response text, but the stress-informed promptHint is
 * injected so the LLM is aware of the patient's physiological state.
 *
 * If context.physioState is absent, falls back to the original LLM-based
 * level assessment (backward compatible).
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';
import { findCircleById } from '../../db/index.js';
import { stress_index, stressLabel, gamma_from_state } from '../physio/state.js';

// Map physio stress labels → empathy levels the rest of the system understands
const STRESS_TO_LEVEL = {
    calm:           'LOW',
    mild_stress:    'MEDIUM',
    moderate_stress:'HIGH',
    high_stress:    'CRITICAL',
    critical_stress:'CRITICAL',
};

/**
 * Process empathy decision with context-aware prompts and physio integration.
 *
 * @param {string} userId
 * @param {string} role
 * @param {string} message
 * @param {string} circleId
 * @param {object} context
 * @param {object} [context.physioState]  — PhysiologicalState object (optional)
 * @returns {Promise<object>} { level, reply, stressIndex?, stressLabel?, gamma? }
 */
export async function processEmpathyDecision(userId, role, message, circleId, context) {
    let promptType = 'empathy';
    try {
        const circle = await findCircleById(circleId);
        if (circle?.circle_type === 'professional') {
            promptType = 'business_empathy';
        }
    } catch {
        // non-fatal: fall back to default prompt type
    }

    // ── Physio-informed empathy level ─────────────────────────────────────────
    let physioLevel = null;
    let physioHint  = '';
    let physioIdx   = null;
    let physioGamma = null;

    if (context.physioState) {
        physioIdx   = stress_index(context.physioState);
        physioGamma = gamma_from_state(context.physioState);
        const label = stressLabel(physioIdx);
        physioLevel = STRESS_TO_LEVEL[label.label];
        physioHint  = label.promptHint;

        if (process.env.DEBUG_COMPANION) {
            const halfLife = Math.log(2) / (-Math.log(Math.exp(-physioGamma)));
            console.log(
                `[EmpathyHandler] Physio stress=${physioIdx.toFixed(3)} (${label.label}), ` +
                `gamma=${physioGamma.toFixed(4)}, half-life=${isFinite(halfLife) ? halfLife.toFixed(1) : 'inf'} turns`
            );
        }
    }

    // ── Build prompt ──────────────────────────────────────────────────────────
    const prompt = loadPrompt(promptType, {
        MESSAGE:       message,
        ROLE:          role,
        CRITICALITY:   context.clinicalAssessment?.criticality
                    || context.businessAssessment?.criticality
                    || 'NONE',
        // Inject physio hint so the LLM tailors its response appropriately.
        // Empty string when no physio data → backward compatible.
        PHYSIO_CONTEXT: physioHint
            ? `\n\nPHYSIOLOGICAL CONTEXT (do not repeat this to the user): ${physioHint}`
            : '',
        // Hard block: if stress is critical, override the reply instruction
        STRESS_OVERRIDE: physioLevel === 'CRITICAL'
            ? '\n\nIMPORTANT: Physiological stress is CRITICAL. Your reply must focus solely on calming the patient. Do NOT introduce any new clinical decisions, billing information, or treatment changes.'
            : '',
    });

    try {
        const result = await makeApiCall(prompt, [], true);

        if (process.env.DEBUG_COMPANION) {
            console.log('[EmpathyHandler] Raw result:', JSON.stringify(result, null, 2));
        }

        const analysis = parseCompanionResponse(result);

        if (!analysis) {
            if (result?.reply && typeof result.reply === 'string') {
                console.warn('[EmpathyHandler] Received plain text response, using fallback');
                return {
                    level:       physioLevel || 'MEDIUM',
                    reply:       result.reply.length > 200 ? null : result.reply,
                    stressIndex: physioIdx,
                    stressLabel: physioLevel ? stressLabel(physioIdx).label : null,
                    gamma:       physioGamma,
                };
            }
            throw new Error('Failed to parse JSON response');
        }

        return {
            // Physio-derived level takes precedence over LLM text analysis
            // when available — it is more reliable and deterministic.
            level:       physioLevel || analysis.level || 'MEDIUM',
            reply:       analysis.reply || null,
            stressIndex: physioIdx,
            stressLabel: physioLevel ? stressLabel(physioIdx).label : null,
            gamma:       physioGamma,
        };
    } catch (error) {
        console.error('[EmpathyHandler] Error:', error.message);
        return {
            level:       physioLevel || 'MEDIUM',
            reply:       null,
            stressIndex: physioIdx,
            stressLabel: null,
            gamma:       physioGamma,
        };
    }
}
