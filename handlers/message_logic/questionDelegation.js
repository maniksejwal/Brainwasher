/**
 * @fileoverview handlers/message_logic/questionDelegation.js
 * Handles question delegation for any role (doctor, patient, caregiver)
 */

import { findCircleById, findUserById, addPendingAction } from '../../db/index.js';
import { generateDelegatedProbe } from '../../agents/index.js';
import { getAgentName } from '../utils/agentIdentity.js';
import { events } from '../../orchestrator.js';
import { randomUUID } from 'crypto';

/**
 * Determine recipients for a question based on message content
 * @param {string} message - The question/message
 * @param {array} members - All circle members
 * @param {string} askerId - User ID of person asking
 * @param {string} patientId - Patient's user ID
 * @returns {object} { recipients: array, privacyLevel: string }
 */
export function determineQuestionRecipients(message = '', members = [], askerId, patientId) {
    return determineDoctorRecipients(message, members, askerId, patientId);
}

/**
 * Determine doctor recipients (also used for other roles)
 * @param {string} message - The message
 * @param {array} members - All circle members
 * @param {string} askerId - User ID of person asking
 * @param {string} patientId - Patient's user ID
 * @returns {object} { recipients: array, privacyLevel: string }
 */
export function determineDoctorRecipients(message = '', members = [], askerId, patientId) {
    const normalizedMessage = String(message || '');
    const otherMembers = members.filter(member => member.user_id !== askerId);
    const normalizedMap = new Map();
    otherMembers.forEach(member => {
        const key = (member.username || '').trim().toLowerCase();
        if (key) {
            normalizedMap.set(key, member);
        }
    });

    const recipientsMap = new Map();
    const mentionRegex = /@([a-z0-9._-]+)/gi;
    let match;
    let explicitGlobalMention = false;
    while ((match = mentionRegex.exec(normalizedMessage)) !== null) {
        const token = match[1].toLowerCase();
        if (token === 'all' || token === 'everyone' || token === 'team' || token === 'careteam') {
            explicitGlobalMention = true;
            break;
        }
        const member = normalizedMap.get(token);
        if (member) {
            recipientsMap.set(member.user_id, member);
        }
    }

    if (explicitGlobalMention) {
        return {
            recipients: otherMembers,
            privacyLevel: 'PUBLIC'
        };
    }

    const lowerMessage = normalizedMessage.toLowerCase();
    const addMembersByRole = (role) => {
        otherMembers
            .filter(member => member.role === role)
            .forEach(member => recipientsMap.set(member.user_id, member));
    };

    if (/\bcaregivers?\b/.test(lowerMessage) || /\bfamily\b/.test(lowerMessage) || /\bparents?\b/.test(lowerMessage)) {
        addMembersByRole('caregiver');
    }

    if (/\bpatients?\b/.test(lowerMessage) || /\bpatient\b/.test(lowerMessage)) {
        const patientMember = otherMembers.find(member => member.user_id === patientId);
        if (patientMember) {
            recipientsMap.set(patientMember.user_id, patientMember);
        }
    }

    // Always prefer explicit mentions over keyword defaults.
    if (recipientsMap.size === 0) {
        const patientMember = otherMembers.find(member => member.user_id === patientId);
        if (patientMember) {
            recipientsMap.set(patientMember.user_id, patientMember);
        }
    }

    const recipients = Array.from(recipientsMap.values());
    if (recipients.length === 0) {
        return {
            recipients,
            privacyLevel: 'PRIVATE'
        };
    }

    const allOthersCount = otherMembers.length;
    let privacyLevel = 'PRIVATE';
    if (recipients.length === allOthersCount && allOthersCount > 1) {
        privacyLevel = 'PUBLIC';
    } else if (recipients.length > 1) {
        privacyLevel = 'LIMITED';
    } else if (recipients[0].user_id !== patientId) {
        privacyLevel = 'LIMITED';
    }

    return {
        recipients,
        privacyLevel
    };
}

/**
 * Sanitize instruction by removing mentions and extra whitespace
 */
function sanitizeInstruction(text = '') {
    return text.replace(/@\w+/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Build fallback probe if generation fails
 */
function buildFallbackProbe(username, instruction) {
    const trimmed = instruction?.trim();
    if (!trimmed) {
        return `Hi ${username}, could you share how you're feeling right now?`;
    }
    return `Hi ${username}, ${trimmed}. Could you tell me more?`;
}

/**
 * Handle question delegation for any role (doctor, patient, caregiver)
 * @param {string} askerUserId - User ID of the person asking
 * @param {string} circleId - Care circle ID
 * @param {string} message - The question/instruction
 * @param {array} recipients - Array of recipient member objects
 * @param {string} askerRole - Role of the person asking
 */
export async function handleQuestionDelegation(askerUserId, circleId, message, recipients, askerRole) {
    const circle = await findCircleById(circleId);
    if (!circle) return;
    
    const patient = await findUserById(circle.primary_patient_id);
    const askerInfo = await findUserById(askerUserId);
    const askerDisplayName = askerInfo?.username || askerRole;
    
    const sanitizedInstruction = sanitizeInstruction(message);
    const askTopic = sanitizedInstruction || message;
    const successfulRecipients = [];
    const failedRecipients = [];
    
    // Determine privacy level based on number of recipients
    const allOthersCount = recipients.length;
    let privacyLevel = 'PRIVATE';
    if (allOthersCount > 1) {
        privacyLevel = 'LIMITED';
    }
    
    for (const recipient of recipients) {
        let probe = null;
        try {
            probe = await generateDelegatedProbe(recipient.username, askTopic);
        } catch (error) {
            console.error(`[QuestionDelegation] Failed to generate delegated probe for ${recipient.username}:`, error);
            probe = buildFallbackProbe(recipient.username, askTopic);
            failedRecipients.push(recipient.username);
        }

        if (!probe) {
            continue;
        }

        const pendingDetails = {
            topic: askTopic,
            original_instruction: message,
            target_user_id: recipient.user_id,
            target_username: recipient.username,
            full_question: probe,
            requested_by: askerUserId
        };

        const pendingActionId = randomUUID();
        await addPendingAction(
            pendingActionId,
            circleId,
            recipient.user_id,
            'delegated_probe_response',
            { ...pendingDetails, action_type: 'delegated_probe_response' }
        );

        const agentName = await getAgentName(recipient.user_id, circleId);
        events.emit('broadcast', {
            targetUsers: [recipient.user_id],
            message: probe,
            from: agentName,
            circleId,
            patientUsername: patient?.username ?? askerDisplayName,
            visibility: privacyLevel,
            recipients: [recipient.username]
        });

        successfulRecipients.push({ username: recipient.username, question: probe });
    }

    // Send summary to asker
    const summaryParts = [];
    if (successfulRecipients.length > 0) {
        const detail = successfulRecipients
            .map(({ username, question }) => `${username}: "${question}"`)
            .join('; ');
        summaryParts.push(`Questions sent → ${detail}`);
    }
    if (failedRecipients.length > 0) {
        summaryParts.push(`⚠️ Could not reach: ${failedRecipients.join(', ')}`);
    }

    const summaryReply = summaryParts.length > 0
        ? summaryParts.join(' | ')
        : 'No eligible recipients identified for your question.';

    events.emit('broadcast', {
        targetUsers: [askerUserId],
        reply: summaryReply,
        from: 'system',
        circleId,
        patientUsername: patient?.username ?? askerDisplayName
    });
}

