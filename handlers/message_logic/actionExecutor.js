/**
 * @fileoverview handlers/message_logic/actionExecutor.js
 * This module is responsible for executing the outcome of a resolved pending action.
 * It takes the details from a completed action (e.g., a granted consent request)
 * and performs the necessary follow-up, such as escalating to a doctor or
 * broadcasting a message to another user.
 */

import { events } from '../../orchestrator.js';
import { addEscalation, findUserByUsername, findUserById, findCircleByPatientId, addMessage } from '../../db/index.js';
import { generateSharingSummaryOrProbe } from '../../agents/index.js';

export async function executeResolvedAction(actionResult, userId, circleId) {
    const currentCircle = await findCircleByPatientId(circleId);
    if (!currentCircle) return; // Should not happen
    const patientUsername = (await findUserById(currentCircle.primary_patient_id)).username;

    if (actionResult.action === 'execute') {
        const { details } = actionResult;
        
        if (details.action_type === 'implied_switch_consent') {
            const { originatingUser, originalMessage, targetCircleId, targetPatientUsername } = details;
            const originatingUserInfo = await findUserById(originatingUser);
            // Log the original message into the TARGET circle.
            await addMessage(targetCircleId, originatingUser, 'contextual_note', `(Regarding ${targetPatientUsername}): ${originalMessage}`, 'PRIVATE', 'NONE');
            console.log(`[ActionExecutor] Logged message from ${originatingUserInfo.username} into circle ${targetCircleId}`);
        }
        else if (details.action_type === 'share_consent') {
            const { target, content_to_share, originatingUser } = details;
            if (target === 'doctor') {
                await addEscalation(circleId, 'INFO', `User with ID '${originatingUser}' consented to share: "${content_to_share}"`);
                events.emit('escalate', { circleId });
            } else {
                const targetUserInfo = await findUserByUsername(target);
                if (targetUserInfo) {
                    const contextualMessage = await generateSharingSummaryOrProbe(originatingUser, target, content_to_share);
                    events.emit('broadcast', { targetUsers: [targetUserInfo.user_id], message: contextualMessage, from: 'personal-agent', circleId, patientUsername });
                }
            }
        }
    }
    
    // Send the final confirmation/cancellation reply to the user who responded.
    events.emit('broadcast', { targetUsers: [userId], reply: actionResult.reply, from: 'personal-agent', circleId, patientUsername });
}
