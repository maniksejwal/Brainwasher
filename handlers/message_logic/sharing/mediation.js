/**
 * @fileoverview handlers/message_logic/sharing/mediation.js
 * Handles the case where a user requests mediation to communicate with another person.
 * This creates a mediated conversation where the AI helps facilitate communication.
 */

import { getCircleMembers, findUserById, findCircleByPatientId, findCircleById } from '../../../db/index.js';
import { generateMediatedClarification } from '../../../agents/index.js';
import { shareWithMembers } from '../../../services/memberMessaging.js';

/**
 * Handles the case where a user requests mediation to communicate with another person.
 * This creates a mediated conversation where the AI helps facilitate communication.
 * @returns {Promise<object|false>} - Sharing result with the member messaged, or false if not handled.
 */
export async function handleMediationRequest(userId, circleId, analysis) {
    if (analysis.intent !== 'REQUESTING_MEDIATION' || !analysis.sharingSuggestion) {
        return false;
    }

    const members = await getCircleMembers(circleId);
    const currentUser = await findUserById(userId);
    const circle = await findCircleById(circleId);
    if (!circle) return null;
    const patient = await findUserById(circle.primary_patient_id);
    
    const targetUsername = analysis.sharingSuggestion.target;
    const targetMember = members.find(m => m.username.toLowerCase() === targetUsername.toLowerCase());
    
    if (!targetMember) {
        console.log(`[Mediation] Mediation target '${targetUsername}' not found in circle ${circleId}`);
        return false;
    }
    // The model sometimes names the speaker as the target; there is no one to mediate with
    if (targetMember.user_id === userId) {
        console.log(`[Mediation] Mediation target is the speaker '${targetMember.username}'; skipping`);
        return false;
    }

    console.log(`[Mediation] User '${currentUser.username}' requesting mediation with '${targetMember.username}'`);

    // Create a mediated message for the target person
    const mediatedMessage = await generateMediatedClarification(targetMember.username, analysis.sharingSuggestion.content_to_share);
    
    // Send the mediated message to the target person (proposed in a HealthyMitra circle)
    const { actions, proposal, question } = await shareWithMembers({
        userId,
        circleId,
        members: [targetMember],
        message: mediatedMessage,
        patientUsername: patient.username
    });

    // The requesting user is not messaged here: messageHandler states what was done in its one reply.
    return {
        action: 'MEDIATION',
        shared: !proposal,
        details: { target: targetMember.username },
        actions,
        proposal,
        question
    };
}
