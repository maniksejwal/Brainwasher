/**
 * @fileoverview handlers/message_logic/actionResponseHandler.js
 * This module checks if a user's natural language message is a reply to a
 * pending question from the AI, processes the response, and then uses the
 * actionExecutor to perform the resulting action.
 */

import { handleUserResponseToAction } from '../../state_manager.js';
import { executeResolvedAction } from './actionExecutor.js';
import { handleEscalationPermissionResponse } from './sharing/escalationTiers.js';
import { getActivePendingActions, findCircleById, findUserById } from '../../db/index.js';
import { events } from '../../orchestrator.js';
import { getAgentName } from '../utils/agentIdentity.js';

export async function handlePendingActionResponse(userId, circleId, message) {
    // This function now only handles natural language responses, not commands.
    if (message.startsWith('/')) return null;

    // Check for escalation permission responses first
    const pendingActions = await getActivePendingActions(userId, circleId);
    const escalationAction = pendingActions.find(a => a.action_type === 'escalation_permission');

    if (escalationAction) {
        const handled = await handleEscalationPermissionResponse(userId, circleId, message, escalationAction);
        if (handled) {
            // One message to the user, built from what the tier handler did
            const circle = await findCircleById(circleId);
            const patient = circle ? await findUserById(circle.primary_patient_id) : null;
            events.emit('broadcast', {
                targetUsers: [userId],
                reply: handled.reply,
                from: await getAgentName(userId, circleId),
                circleId,
                patientUsername: patient?.username ?? userId
            });
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

    // Delegate the execution of the action to the shared executor module.
    await executeResolvedAction(actionResult, userId, circleId);

    return actionResult; // Return the full result so messageHandler can use the reply
}

