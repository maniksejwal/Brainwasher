/**
 * @fileoverview handlers/message_logic/nonDoctorQuestionHandler.js
 * Handles question delegation for non-doctor roles (patient, caregiver)
 */

import { getCircleMembers, findCircleById } from '../../db/index.js';
import { determineQuestionRecipients } from './questionDelegation.js';

/**
 * Check if a non-doctor message is a question directed at other members and handle it
 * @param {string} userId - User ID
 * @param {string} circleId - Care circle ID
 * @param {string} message - User's message
 * @param {string} role - User's role
 * @returns {Promise<object|null>} Result if question was delegated, null otherwise
 */
export async function handleNonDoctorQuestion(userId, circleId, message, role) {
    const members = await getCircleMembers(circleId);
    const circle = await findCircleById(circleId);
    if (!circle) {
        return null;
    }

    const { recipients } = determineQuestionRecipients(message, members, userId, circle.primary_patient_id);
    
    if (recipients && recipients.length > 0) {
        // This is a question directed at other members - delegate it
        const isQuestion = /^(is|are|how|what|when|where|why|can|could|would|do|does|did|has|have|will|should)\s/i.test(message.trim()) || message.trim().endsWith('?');
        
        if (isQuestion) {
            const { handleQuestionDelegation } = await import('./questionDelegation.js');
            await handleQuestionDelegation(userId, circleId, message, recipients, role);
            return {
                reply: `Questions sent to ${recipients.map(r => r.username).join(', ')}.`,
                intent: 'QUESTION_DELEGATED',
                criticality: 'NONE',
                privacyLevel: 'PRIVATE',
                facts: {}
            };
        }
    }
    
    return null;
}

