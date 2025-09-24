/**
 * @fileoverview handlers/message_logic/sharing/mediation.js
 * Handles the case where a user requests mediation to communicate with another person.
 * This creates a mediated conversation where the AI helps facilitate communication.
 */

import { getCircleMembers, findUserById, findCircleByPatientId } from '../../../db/index.js';
import { generateMediatedClarification } from '../../../agents/index.js';
import { events } from '../../../orchestrator.js';
import { getAgentName } from '../../utils/agentIdentity.js';

/**
 * Handles the case where a user requests mediation to communicate with another person.
 * This creates a mediated conversation where the AI helps facilitate communication.
 * @returns {boolean} - True if the mediation request was handled, otherwise false.
 */
export async function handleMediationRequest(userId, circleId, analysis) {
    if (analysis.intent !== 'REQUESTING_MEDIATION' || !analysis.sharingSuggestion) {
        return false;
    }

    const members = await getCircleMembers(circleId);
    const currentUser = await findUserById(userId);
    const patient = await findUserById((await findCircleByPatientId(circleId)).primary_patient_id);
    
    const targetUsername = analysis.sharingSuggestion.target;
    const targetMember = members.find(m => m.username.toLowerCase() === targetUsername.toLowerCase());
    
    if (!targetMember) {
        console.log(`[Mediation] Mediation target '${targetUsername}' not found in circle ${circleId}`);
        return false;
    }

    console.log(`[Mediation] User '${currentUser.username}' requesting mediation with '${targetMember.username}'`);

    // Create a mediated message for the target person
    const mediatedMessage = await generateMediatedClarification(targetMember.username, analysis.sharingSuggestion.content_to_share);
    
    // Send the mediated message to the target person
    const agentName = await getAgentName(targetMember.user_id, circleId);
    events.emit('broadcast', {
        targetUsers: [targetMember.user_id],
        message: mediatedMessage,
        from: agentName,
        circleId,
        patientUsername: patient.username
    });

    // Confirm to the requesting user that mediation was initiated
    const confirmationReply = `I've reached out to ${targetMember.username} to help facilitate the conversation. They should respond soon.`;
    const requestingAgentName = await getAgentName(userId, circleId);
    events.emit('broadcast', {
        targetUsers: [userId],
        reply: confirmationReply,
        from: requestingAgentName,
        circleId,
        patientUsername: patient.username
    });

    return true;
}
