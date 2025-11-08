/**
 * @fileoverview handlers/message_logic/sharing/adviceSharing.js
 * Handles the specific case where one user gives advice for another.
 * Instead of escalating, it mediates the advice to the target user's agent.
 */

import { getCircleMembers, findUserById, findCircleByPatientId, findCircleById } from '../../../db/index.js';
import { generateSharingSummaryOrProbe } from '../../../agents/index.js';
import { events } from '../../../orchestrator.js';
import { getAgentName } from '../../utils/agentIdentity.js';

/**
 * Handles the specific case where one user gives advice for another.
 * Instead of escalating, it mediates the advice to the target user's agent.
 * @returns {boolean} - True if the advice was handled, otherwise false.
 */
export async function handleAdviceSharing(userId, circleId, analysis) {
    if (analysis.intent !== 'GIVING_ADVICE_FOR_OTHER' || !analysis.facts || !analysis.sharingSuggestion) {
        return false;
    }

    const factKey = Object.keys(analysis.facts)[0];
    const fact = analysis.facts[factKey];
    if (!fact.subject) return false;

    const members = await getCircleMembers(circleId);
    const targetMember = members.find(m => m.username === fact.subject);
    if (!targetMember) return false;

    console.log(`[AdviceSharing] Detected advice from '${userId}' for '${targetMember.username}'. Mediating.`);
    const currentUser = await findUserById(userId);
    const circle = await findCircleById(circleId);
    if (!circle) return null;
    const patient = await findUserById(circle.primary_patient_id);

    // Generate a natural language message for the target user's agent to deliver.
    const contextualMessage = await generateSharingSummaryOrProbe(currentUser.username, targetMember.username, analysis.sharingSuggestion.content_to_share);
    
    const agentName = await getAgentName(targetMember.user_id, circleId);
    events.emit('broadcast', {
        targetUsers: [targetMember.user_id],
        message: contextualMessage,
        from: agentName,
        circleId,
        patientUsername: patient.username
    });

    return true; // The advice was successfully mediated.
}
