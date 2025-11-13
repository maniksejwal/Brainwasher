/**
 * @fileoverview handlers/message_logic/doctorMessageHandler.js
 * Handles doctor messages - determines recipients, queries companions, and delegates questions
 */

import { getCircleMembers, findUserById, findCircleById, addMessage } from '../../db/index.js';
import { queryCompanionsForDoctor } from '../../companions/agents/doctorOptimizer.js';
import { handleQuestionDelegation, determineDoctorRecipients } from './questionDelegation.js';
import { getAgentName } from '../utils/agentIdentity.js';
import { events } from '../../orchestrator.js';

/**
 * Handle a doctor's message
 * @param {string} userId - Doctor's user ID
 * @param {string} circleId - Care circle ID
 * @param {string} message - Doctor's message
 * @param {object} memberInfo - Doctor's member info
 * @returns {Promise<object>} Result object
 */
export async function handleDoctorMessage(userId, circleId, message, memberInfo) {
    const members = await getCircleMembers(circleId);
    const circle = await findCircleById(circleId);
    if (!circle) {
        throw new Error(`Circle '${circleId}' not found when handling message for ${userId}`);
    }

    const patient = await findUserById(circle.primary_patient_id);
    const doctorRecord = members.find(m => m.user_id === userId);
    const doctorDisplayName = doctorRecord?.username || 'doctor';

    const { recipients, privacyLevel } = determineDoctorRecipients(
        message,
        members,
        userId,
        circle.primary_patient_id
    );

    if (!recipients || recipients.length === 0) {
        console.warn(`[DoctorMessageHandler] Doctor message from '${doctorDisplayName}' had no eligible recipients.`);
        return {
            reply: 'No eligible recipients identified; your message was not delivered.',
            intent: 'DOCTOR_NO_RECIPIENTS',
            criticality: 'NONE',
            privacyLevel: 'PRIVATE',
            facts: {}
        };
    }

    const recipientNames = recipients.map(r => r.username);
    await addMessage(circleId, userId, memberInfo.role, message, privacyLevel, 'NONE');

    console.log(`[DoctorMessageHandler] Doctor '${doctorDisplayName}' instruction targeting [${recipientNames.join(', ')}] with privacy=${privacyLevel}.`);

    // Check if this is a question - if so, query companions for immediate answer
    const isQuestion = /^(is|are|how|what|when|where|why|can|could|would|do|does|did|has|have|will|should)\s/i.test(message.trim()) || message.trim().endsWith('?');
    
    if (isQuestion) {
        try {
            // Query patient and caregiver companions for immediate answer
            const queryTargets = recipients.filter(r => r.role === 'patient' || r.role === 'caregiver');
            if (queryTargets.length > 0) {
                const companionQueryResult = await queryCompanionsForDoctor(userId, circleId, message, queryTargets);
                
                if (companionQueryResult && companionQueryResult.summary) {
                    // Send companion query results to doctor immediately
                    const agentName = await getAgentName(userId, circleId);
                    events.emit('broadcast', {
                        targetUsers: [userId],
                        reply: `Based on conversation history:\n\n${companionQueryResult.summary}`,
                        from: agentName,
                        circleId,
                        patientUsername: patient?.username ?? doctorDisplayName
                    });
                }
            }
        } catch (error) {
            console.error(`[DoctorMessageHandler] Error querying companions for doctor question:`, error);
            // Continue with delegation even if companion query fails
        }
    }

    // Delegate the question to recipients
    await handleQuestionDelegation(userId, circleId, message, recipients, memberInfo.role);

    return {
        reply: `Questions sent to ${recipients.map(r => r.username).join(', ')}.`,
        intent: 'DOCTOR_MESSAGE',
        criticality: 'NONE',
        privacyLevel,
        facts: {}
    };
}

