/**
 * @fileoverview handlers/message_logic/actionExecutor.js
 * This module is responsible for executing the outcome of a resolved pending action.
 * It takes the details from a completed action (e.g., a granted consent request)
 * and performs the necessary follow-up, such as escalating to a doctor or
 * broadcasting a message to another user.
 */

import { events } from '../../orchestrator.js';
import { addEscalation, findUserByUsername, findUserById, findCircleByPatientId, addMessage, findCircleById } from '../../db/index.js';
import { generateSharingSummaryOrProbe } from '../../agents/index.js';
import { summarizeReplyForDoctor } from '../../agents/doctorAgent.js';
import { getAgentName } from '../utils/agentIdentity.js';
import { checkSharingPermission, prioritizeContent } from '../utils/sensitiveContentFilter.js';
import { getMemberInfo } from '../../db/index.js';

export async function executeResolvedAction(actionResult, userId, circleId) {
    const currentCircle = await findCircleById(circleId);
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
                const originatingUserInfo = await findUserById(originatingUser);
                
                if (targetUserInfo && originatingUserInfo) {
                    // FIX #1: Use username instead of UUID for template replacement
                    const contextualMessage = await generateSharingSummaryOrProbe(
                        originatingUserInfo.username,  // ✅ Now passes username, not UUID
                        target, 
                        content_to_share
                    );
                    
                    // FIX #2: Use TARGET's agent to maintain proper agent-user boundaries
                    // The target user's own agent should deliver the message, not the originating user's agent
                    const agentName = await getAgentName(targetUserInfo.user_id, circleId);
                    
                    events.emit('broadcast', { 
                        targetUsers: [targetUserInfo.user_id], 
                        message: contextualMessage, 
                        from: agentName,  // ✅ Target's agent, respecting architectural boundaries
                        circleId, 
                        patientUsername 
                    });
                }
            }
        }
        else if (details.action_type === 'delegated_probe_response') {
            // Handle response to delegated probe - send notification to requester
            const { requested_by, topic, target_username, original_instruction } = details;
            const requesterInfo = await findUserById(requested_by);
            const responderInfo = await findUserById(userId);
            
            if (requesterInfo && responderInfo) {
                // Get the user's response from the action result
                const userResponse = actionResult.userResponse || actionResult.reply || 'No response provided';
                
                // Check consent level - get the consent that the responder has set for the requester
                // The responder (userId) is sharing their own information with the requester (requested_by)
                // We need to check what consent level the responder has granted to the requester
                // This is stored in the requester's member record in the responder's personal circle
                const { findCircleByPatientId } = await import('../../db/index.js');
                const responderCircle = await findCircleByPatientId(userId);
                let consentLevel = 'NONE';
                
                if (responderCircle) {
                    // Check what consent the responder has granted to the requester in their own circle
                    const requesterInResponderCircle = await getMemberInfo(requested_by, responderCircle.circle_id);
                    const rawConsent = requesterInResponderCircle?.consent_level || 'none';
                    // Normalize to uppercase for checkSharingPermission
                    consentLevel = rawConsent.toUpperCase();
                }
                
                // Check if we can share this content based on sensitivity and consent
                const sharingCheck = await checkSharingPermission(userResponse, consentLevel);
                
                if (!sharingCheck.canShare) {
                    // Cannot share due to consent - send filtered/prioritized content only
                    const prioritized = await prioritizeContent(userResponse);
                    const filteredSummary = await summarizeReplyForDoctor(topic || original_instruction, prioritized, circleId, userId);
                    
                    const agentName = await getAgentName(requested_by, circleId);
                    events.emit('broadcast', {
                        targetUsers: [requested_by],
                        reply: `Response from ${responderInfo.username} regarding "${topic || original_instruction}": ${filteredSummary} [Note: Some sensitive content was filtered due to privacy settings]`,
                        from: agentName,
                        circleId,
                        patientUsername
                    });
                } else {
                    // Can share - use filtered content if available, otherwise original
                    const contentToSummarize = sharingCheck.filteredContent || userResponse;
                    const summary = await summarizeReplyForDoctor(topic || original_instruction, contentToSummarize, circleId, userId);
                    
                    const agentName = await getAgentName(requested_by, circleId);
                    events.emit('broadcast', {
                        targetUsers: [requested_by],
                        reply: `Response from ${responderInfo.username} regarding "${topic || original_instruction}": ${summary}`,
                        from: agentName,
                        circleId,
                        patientUsername
                    });
                }
            }
        }
    }
    
    // Send the final confirmation/cancellation reply to the user who responded.
    const agentName = await getAgentName(userId, circleId);
    events.emit('broadcast', { targetUsers: [userId], reply: actionResult.reply, from: agentName, circleId, patientUsername });
}
