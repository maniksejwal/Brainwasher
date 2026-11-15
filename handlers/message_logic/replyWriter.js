/**
 * @fileoverview handlers/message_logic/replyWriter.js
 * Writes the reply after this turn's actions have run, and checks it before it is sent.
 *
 * Analysis produces a draft reply with ACTIONS_TAKEN set to "none". That draft is kept
 * when nothing was done. When an action ran, a handler returned a question, or a planned
 * follow-up is due, the reply is written again with the real ACTIONS_TAKEN. A reply that
 * still claims an action that did not happen is regenerated once, with the false sentence
 * pointed out; if that also fails, composeFinalReply uses the fixed fallback text.
 */

import { getRecentMessages, hasRecentHighMessage } from '../../db/index.js';
import { processPatientOptimization } from '../../companions/agents/patientOptimizer.js';
import { processEmpathyDecision } from '../../companions/handlers/empathyHandler.js';
import { hasActionsToReport, renderActionsTaken } from '../../prompts/action_contract.js';
import { findFalseClaims, composeFinalReply } from '../../utils/actionClaimGuard.js';
import { checkReplyAddressesAsks } from '../../companions/agents/askChecker.js';
import { markAsksAnswered } from '../../db/queries_asks.js';

// How long the emergency instruction stays on replies after the latest HIGH turn
export const EMERGENCY_CARRY_WINDOW_MS = 30 * 60 * 1000;

/**
 * Whether a lower-rated turn still falls within a recent emergency. A failed check must not
 * stop the reply.
 * @param {string} circleId - Care circle ID
 * @param {string} criticality - This turn's rating
 * @param {Function} [check] - The lookup, replaceable in tests
 * @returns {Promise<boolean>} Whether to carry the emergency instruction
 */
export async function isEmergencyActive(circleId, criticality, check = hasRecentHighMessage) {
    if (criticality === 'HIGH') return false;
    try {
        return await check(circleId, Date.now() - EMERGENCY_CARRY_WINDOW_MS);
    } catch (error) {
        console.error('[ReplyWriter] Could not check for a recent emergency:', error.message);
        return false;
    }
}

/**
 * Context for the reply prompts. The companion path keeps the context its handlers saw;
 * the unified path has none, so a minimal one is built from the analysis.
 */
async function getReplyContext(circleId, analysis) {
    if (analysis.replyContext) {
        return analysis.replyContext;
    }
    // DB returns newest-first; the reply prompts expect chronological order
    const history = (await getRecentMessages(circleId, 20)).reverse();
    return {
        history,
        clinicalAssessment: { criticality: analysis.criticality || 'NONE', assessment: analysis.clinicalAssessment || undefined }
    };
}

/**
 * Write the reply text with the given ACTIONS_TAKEN.
 * Patients get the patient optimizer; other roles get the empathy handler, as in analysis.
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.role
 * @param {string} params.message - The user's message
 * @param {string} params.circleId
 * @param {object} params.analysis - The turn's analysis
 * @param {string} params.actionsTaken - Rendered ACTIONS_TAKEN block
 * @returns {Promise<string|null>} Reply text, or null if no reply could be written
 */
export async function writeReply({ userId, role, message, circleId, analysis, actionsTaken, extraContext = {} }) {
    try {
        const context = { ...(await getReplyContext(circleId, analysis)), actionsTaken, ...extraContext };
        const result = role === 'patient'
            ? await processPatientOptimization(userId, role, message, circleId, context)
            : await processEmpathyDecision(userId, role, message, circleId, context);
        return result?.reply || null;
    } catch (error) {
        console.error('[ReplyWriter] Failed to write reply:', error.message);
        return null;
    }
}

/**
 * Build the one checked message for the user who wrote in.
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.role
 * @param {string} params.message - The user's message
 * @param {string} params.circleId
 * @param {object} params.analysis - The turn's analysis (draft reply, criticality, HIGH category)
 * @param {object|null} params.sharingResult - Result from handleSharingAndEscalation
 * @param {string[]} [params.notes] - Planned follow-ups due this turn
 * @param {string[]} [params.dueMessages] - Scheduled messages for this user due this turn
 * @returns {Promise<{message: string, violations: object[], draftViolations: object[], rewritten: boolean, regenerated: boolean}>}
 */
export async function buildCheckedReply({ userId, role, message, circleId, analysis, sharingResult, notes = [], dueMessages = [] }) {
    const actions = sharingResult?.actions || {};
    // A handler's question comes first; scheduled messages due now follow it
    const question = [sharingResult?.question, ...dueMessages].filter(Boolean).join(' ') || null;
    const write = (violations = [], extraContext = {}) => writeReply({
        userId, role, message, circleId, analysis, extraContext,
        actionsTaken: renderActionsTaken({ actions, question, notes, violations })
    });

    let modelText = analysis.reply;
    let rewritten = false;
    if (hasActionsToReport(actions) || question || notes.length > 0) {
        const text = await write();
        if (text) {
            modelText = text;
            rewritten = true;
        }
    }

    const draftViolations = findFalseClaims(modelText, actions);
    let regenerated = false;
    if (draftViolations.length > 0) {
        const retry = await write(draftViolations);
        if (retry && findFalseClaims(retry, actions).length === 0) {
            modelText = retry;
            regenerated = true;
        }
    }

    const asks = await ensureAsksAddressed({ userId, role, message, circleId, analysis, modelText, actions, write });
    modelText = asks.text;

    const { message: finalMessage, violations } = composeFinalReply({
        modelText,
        criticality: analysis.criticality,
        highCategory: analysis.high_category,
        emergencyActive: await isEmergencyActive(circleId, analysis.criticality),
        actions,
        question,
        notice: analysis.sharingNotice || null
    });
    return { message: finalMessage, violations, draftViolations, rewritten, regenerated, askCheck: asks.report };
}

/**
 * For a patient with open questions or requests, checks the reply addresses them. If it
 * misses some, the reply is written once more naming them; the new text is used only if it
 * passes the false claim check. Asks the final text addresses are marked answered.
 * Skipped for HIGH turns, so the emergency reply is not delayed. Never fails the turn.
 * @returns {Promise<{text: string, report: object|null}>}
 */
export async function ensureAsksAddressed({ userId, role, message, circleId, analysis, modelText, actions, write }) {
    const openAsks = analysis.replyContext?.openAsks || [];
    if (role !== 'patient' || analysis.criticality === 'HIGH' || !openAsks.length || !modelText) {
        return { text: modelText, report: null };
    }
    try {
        let text = modelText;
        let check = await checkReplyAddressesAsks(text, openAsks, message);
        if (!check) return { text, report: null };

        let retried = false;
        if (check.missed.length > 0) {
            const retry = await write([], { missedAsks: check.missed });
            if (retry && findFalseClaims(retry, actions).length === 0) {
                const recheck = await checkReplyAddressesAsks(retry, openAsks, message);
                // Keep the retry only if it addresses at least as much as the first reply
                if (recheck && recheck.addressed.length >= check.addressed.length) {
                    text = retry;
                    check = recheck;
                    retried = true;
                }
            }
        }
        const closed = await markAsksAnswered(circleId, userId, check.addressed);
        const report = { open: openAsks.length, addressed: check.addressed.length, missed: check.missed.length, retried, closed };
        if (process.env.DEBUG_COMPANION) console.log('[ReplyWriter] Ask check:', JSON.stringify(report));
        return { text, report };
    } catch (error) {
        console.error('[ReplyWriter] Ask check failed:', error.message);
        return { text: modelText, report: null };
    }
}
