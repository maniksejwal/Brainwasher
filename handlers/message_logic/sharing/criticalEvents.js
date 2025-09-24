/**
 * @fileoverview handlers/message_logic/sharing/criticalEvents.js
 * Handles critical health events and family notifications.
 */

import { addEscalation, getCircleMembers, findUserById, findCircleByPatientId } from '../../../db/index.js';
import { events } from '../../../orchestrator.js';
import { getAgentName } from '../../utils/agentIdentity.js';

/**
 * Handles HIGH criticality events and notifies family members
 * @param {string} userId - The user who reported the critical event
 * @param {string} role - The role of the user
 * @param {string} message - The original message
 * @param {string} circleId - The circle ID
 * @param {object} analysis - The AI analysis result
 * @returns {Promise<boolean>} - True if handled, false otherwise
 */
export async function handleCriticalEvent(userId, role, message, circleId, analysis) {
    if (analysis.criticality !== 'HIGH') {
        return false;
    }

    const currentCircle = await findCircleByPatientId(circleId);
    const patientUsername = (await findUserById(currentCircle.primary_patient_id)).username;

    const criticalDetails = `User '${userId}' (${role}) reported: "${message}"`;
    await addEscalation(circleId, 'CRITICAL', criticalDetails);
    events.emit('escalate', { circleId });
    
    // Notify family members about critical health issues
    const members = await getCircleMembers(circleId);
    const familyMembers = members.filter(m => m.role === 'caregiver' && m.user_id !== userId);
    if (familyMembers.length > 0) {
        const familyNotification = `Urgent health update: ${patientUsername} reported a critical health concern. Please check on them.`;
        const agentName = await getAgentName(familyMembers[0].user_id, circleId); // Use first family member for agent name
        events.emit('broadcast', { 
            targetUsers: familyMembers.map(m => m.user_id), 
            message: familyNotification, 
            from: agentName, 
            circleId, 
            patientUsername 
        });
    }
    
    const confirmationReply = `This sounds serious. I have escalated this to the doctor immediately. ${analysis.reply}`;
    const agentName = await getAgentName(userId, circleId);
    events.emit('broadcast', { targetUsers: [userId], reply: confirmationReply, from: agentName, circleId, patientUsername });
    
    return true;
}
