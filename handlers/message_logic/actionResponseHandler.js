/**
 * @fileoverview Handles a user's response to a pending action.
 * This module checks if a user's message is a reply to a question from the AI,
 * processes the response, and executes or cancels the pending action accordingly.
 */

import { handleUserResponseToAction } from '../../state_manager.js';
import { events } from '../../orchestrator.js';
import { addEscalation, findUserByUsername } from '../../db/index.js';
import { generateSharingSummaryOrProbe } from '../../agents/index.js';

export async function handlePendingActionResponse(userId, circleId, message) {
    const actionResult = await handleUserResponseToAction(userId, circleId, message);

    if (!actionResult) {
        return false; // Indicates no pending action was handled
    }

    if (actionResult.action === 'execute') {
        const { target, content_to_share, originatingUser } = actionResult.details;
        
        if (target === 'doctor') {
            await addEscalation(circleId, 'INFO', `User with ID '${originatingUser}' consented to share: "${content_to_share}"`);
            events.emit('escalate', { circleId });
        } else {
            const targetUserInfo = await findUserByUsername(target);
            if (targetUserInfo) {
                const contextualMessage = await generateSharingSummaryOrProbe(originatingUser, target, content_to_share);
                events.emit('broadcast', { targetUsers: [targetUserInfo.user_id], message: contextualMessage, from: 'personal-agent', circleId });
            }
        }
    }
    
    // Send the final confirmation/cancellation reply to the user who responded.
    events.emit('broadcast', { targetUsers: [userId], reply: actionResult.reply, from: 'personal-agent', circleId });
    
    return true; // Indicates a pending action was successfully handled
}
