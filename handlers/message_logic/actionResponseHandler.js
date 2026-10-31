/**
 * @fileoverview handlers/message_logic/actionResponseHandler.js
 * This module checks if a user's natural language message is a reply to a
 * pending question from the AI, processes the response, and then uses the
 * actionExecutor to perform the resulting action.
 */

import { handleUserResponseToAction } from '../../state_manager.js';
import { executeResolvedAction } from './actionExecutor.js';
import { handleEscalationPermissionResponse, YES_PATTERN, NO_PATTERN } from './sharing/escalationTiers.js';
import { decideEscalationProposal, PROPOSAL_ACTION_TYPE } from '../../services/escalationService.js';
import { buildActionStatus } from '../../utils/actionClaimGuard.js';
import { getActivePendingActions, getPendingAction, findCircleById, findUserById } from '../../db/index.js';
import { events } from '../../orchestrator.js';
import { getAgentName } from '../utils/agentIdentity.js';

export async function handlePendingActionResponse(userId, circleId, message) {
    // This function now only handles natural language responses, not commands.
    if (message.startsWith('/')) return null;

    // Check for escalation permission responses first
    const pendingActions = await getActivePendingActions(userId, circleId);

    // A proposed emergency alert: "yes" sends it to the recipients shown, "no" drops it.
    // Anything else leaves it open and the message is handled as a normal turn.
    const proposalAction = pendingActions.find(a => a.action_type === PROPOSAL_ACTION_TYPE);
    if (proposalAction) {
        const answeredYes = YES_PATTERN.test(message);
        const answeredNo = NO_PATTERN.test(message);
        if (answeredYes !== answeredNo) {
            const decision = await decideEscalationProposal(proposalAction.action_id, userId, answeredYes);
            const handled = proposalReply(decision);
            if (handled) {
                await sendReply(userId, circleId, handled.reply);
                return handled;
            }
        }
    }

    const escalationAction = pendingActions.find(a => a.action_type === 'escalation_permission');

    if (escalationAction) {
        const handled = await handleEscalationPermissionResponse(userId, circleId, message, escalationAction);
        if (handled) {
            // One message to the user, built from what the tier handler did
            await sendReply(userId, circleId, handled.reply);
            return { reply: handled.reply, sharingResult: handled.sharingResult };
        }
    }

    const actionResult = await handleUserResponseToAction(userId, circleId, message);

    if (!actionResult) {
        return null; // Indicates no pending action was handled
    }

    // Ensure userResponse is set for delegated probe responses (fallback if not set in state_manager)
    if (actionResult.details?.action_type === 'delegated_probe_response') {
        actionResult.userResponse = actionResult.userResponse || message;
    }

    // An answer to a delegated question is forwarded, then the message is handled as a normal
    // turn: messageHandler analyzes it and sends the one reply, stating what was forwarded.
    if (actionResult.continueWithAnalysis) {
        const { forwardedTo } = await executeResolvedAction(actionResult, userId, circleId, { sendReply: false });
        return { continueWithAnalysis: true, actions: { membersMessaged: forwardedTo } };
    }

    // Delegate the execution of the action to the shared executor module.
    await executeResolvedAction(actionResult, userId, circleId);

    return actionResult; // Return the full result so messageHandler can use the reply
}

/**
 * Decide a proposed alert from an Accept/Reject card instead of a chat reply. The user
 * gets the same message in chat as if they had typed yes or no.
 * @param {string} userId - The signed-in user
 * @param {string} actionId - The proposal's action ID
 * @param {boolean} accept
 * @returns {Promise<{status: string, reply: string|null}>}
 */
export async function handleProposalDecision(userId, actionId, accept) {
    const pending = await getPendingAction(actionId);
    const decision = await decideEscalationProposal(actionId, userId, accept);
    const handled = proposalReply(decision);
    if (handled && pending) {
        await sendReply(userId, pending.circle_id, handled.reply);
    }
    return { status: decision.status, reply: handled?.reply ?? null };
}

/**
 * Send the one reply for a turn that a pending action answered.
 */
async function sendReply(userId, circleId, reply) {
    const circle = await findCircleById(circleId);
    const patient = circle ? await findUserById(circle.primary_patient_id) : null;
    events.emit('broadcast', {
        targetUsers: [userId],
        reply,
        from: await getAgentName(userId, circleId),
        circleId,
        patientUsername: patient?.username ?? userId
    });
}

/**
 * The reply to a decision on a proposed alert, stating only what was done.
 * @returns {{reply: string, sharingResult: object|null}|null} Null when the proposal
 *   was already decided elsewhere (the message is then handled as a normal turn)
 */
export function proposalReply(decision) {
    switch (decision.status) {
        case 'completed': {
            const status = buildActionStatus(decision.result.actions);
            return {
                reply: status || "I couldn't send the alert to anyone.",
                sharingResult: {
                    action: 'ESCALATE',
                    escalated: true,
                    details: { escalation_type: 'CRITICAL', escalation_id: decision.result.escalationId },
                    actions: decision.result.actions
                }
            };
        }
        case 'rejected':
            return { reply: "Okay, I haven't sent it. If anything changes, tell me and I can alert them then.", sharingResult: null };
        case 'expired':
            return { reply: "That alert was from a while ago, so I haven't sent it. If you still need help, tell me what's happening now.", sharingResult: null };
        default:
            return null;
    }
}
