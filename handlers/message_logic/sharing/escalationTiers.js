/**
 * @fileoverview handlers/message_logic/sharing/escalationTiers.js
 * Implements 4-tier escalation system:
 * 1. Seek permission - ask patient if they want to escalate
 * 2. Notify caregiver - inform family members (lower cost)
 * 3. Anonymous consultation - consult doctor without patient identity (costs minimal money)
 * 4. Actual consultation - full doctor consultation (costs money)
 *
 * Tier handlers do not message the user who wrote in. Each returns a sharing result
 * ({ action, escalated, details, actions }); the reply states what was done.
 */

import { getCircleMembers, findUserById, findCircleByPatientId, addPendingAction, removePendingAction } from '../../../db/index.js';
import { randomUUID } from 'crypto';
import { escalate } from '../../../services/escalationService.js';
import { buildActionStatus } from '../../../utils/actionClaimGuard.js';

/**
 * Escalation tiers
 */
export const ESCALATION_TIERS = {
    PERMISSION: 1,        // Seek permission from patient
    CAREGIVER: 2,         // Notify caregiver (low cost)
    ANONYMOUS: 3,         // Anonymous doctor consultation (costs money)
    CONSULTATION: 4        // Full doctor consultation (costs money)
};

/**
 * Determine appropriate escalation tier based on criticality and confidence
 * @param {string} criticality - 'NONE', 'LOW', 'MEDIUM', 'HIGH'
 * @param {number} confidence - Confidence level (0-1) that escalation is needed
 * @returns {number} Escalation tier
 */
export function determineEscalationTier(criticality, confidence = 0.5) {
    // HIGH criticality always goes to tier 4 (actual consultation) or bypasses for safety
    if (criticality === 'HIGH') {
        return ESCALATION_TIERS.CONSULTATION;
    }

    // MEDIUM criticality: if high confidence, go to tier 3-4, else start at tier 1
    if (criticality === 'MEDIUM') {
        if (confidence >= 0.8) {
            return ESCALATION_TIERS.ANONYMOUS; // High confidence, use anonymous consultation
        } else if (confidence >= 0.6) {
            return ESCALATION_TIERS.CAREGIVER; // Medium confidence, notify caregiver
        } else {
            return ESCALATION_TIERS.PERMISSION; // Low confidence, seek permission first
        }
    }

    // LOW criticality: start at tier 1 (permission) or tier 2 (caregiver) if confidence is moderate
    if (criticality === 'LOW') {
        if (confidence >= 0.7) {
            return ESCALATION_TIERS.CAREGIVER;
        } else {
            return ESCALATION_TIERS.PERMISSION;
        }
    }

    // NONE: no escalation needed
    return null;
}

/**
 * Handle tier 1: Seek permission from patient
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {object} analysis - AI analysis
 * @returns {Promise<object>} Sharing result; the reply asks the permission question
 */
export async function handleTier1Permission(userId, circleId, analysis) {
    // Create pending action for permission request
    const actionId = randomUUID();
    const details = {
        action_type: 'escalation_permission',
        criticality: analysis.criticality,
        reason: analysis.sharingSuggestion?.reason || 'Health concern requires medical attention',
        content: analysis.sharingSuggestion?.content_to_share || analysis.message || 'Patient health concern'
    };

    await addPendingAction(actionId, circleId, userId, 'escalation_permission', details);

    return {
        action: 'REQUEST_CONSENT',
        escalated: false,
        details: { tier: ESCALATION_TIERS.PERMISSION },
        actions: {},
        question: 'Would you like me to consult with a doctor about this? This will help ensure you get the right care.'
    };
}

/**
 * Handle tier 2: Notify caregiver
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {object} analysis - AI analysis
 * @returns {Promise<object>} Sharing result with the caregivers alerted
 */
export async function handleTier2Caregiver(userId, circleId, analysis) {
    const currentCircle = await findCircleByPatientId(circleId);
    const patientUsername = (await findUserById(currentCircle.primary_patient_id)).username;
    const members = await getCircleMembers(circleId);
    const familyMembers = members.filter(m => m.role === 'caregiver' && m.user_id !== userId);

    if (familyMembers.length === 0) {
        // No caregivers available, escalate to tier 3
        return await handleTier3Anonymous(userId, circleId, analysis);
    }

    const result = await escalate({
        circleId,
        userId,
        type: 'CAREGIVER_NOTIFICATION',
        details: `Caregiver notified about ${patientUsername}'s health concern`,
        messageId: analysis.message_id ?? null,
        notifyDoctors: false,
        notifyCaregivers: true,
        caregiverMessage: `${patientUsername} has reported a health concern. You may want to check on them. Details: ${analysis.sharingSuggestion?.content_to_share || 'Health concern reported'}`,
        patientUsername
    });

    return {
        action: 'ESCALATE',
        escalated: true,
        details: { tier: ESCALATION_TIERS.CAREGIVER, escalation_type: 'CAREGIVER_NOTIFICATION', escalation_id: result.escalationId },
        actions: result.actions
    };
}

/**
 * Handle tier 3: Anonymous consultation (no patient identity, costs money)
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {object} analysis - AI analysis
 * @returns {Promise<object>} Sharing result with the request logged
 */
export async function handleTier3Anonymous(userId, circleId, analysis) {
    // Create anonymous escalation (no patient identity)
    const anonymousDetails = `Anonymous consultation requested. Symptoms: ${analysis.sharingSuggestion?.content_to_share || 'Health concern'}. No patient identity shared.`;
    const result = await escalate({
        circleId,
        userId,
        type: 'ANONYMOUS_CONSULTATION',
        details: anonymousDetails,
        messageId: analysis.message_id ?? null,
        anonymous: true,
        eventDetails: { userId, anonymous: true }
    });

    return {
        action: 'ESCALATE',
        escalated: true,
        details: { tier: ESCALATION_TIERS.ANONYMOUS, escalation_type: 'ANONYMOUS_CONSULTATION', escalation_id: result.escalationId },
        actions: result.actions
    };
}

/**
 * Handle tier 4: Actual consultation (full doctor consultation, costs money)
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {object} analysis - AI analysis
 * @returns {Promise<object>} Sharing result with the doctors reached
 */
export async function handleTier4Consultation(userId, circleId, analysis) {
    // Full escalation with patient identity
    const consultationDetails = `User '${userId}' consultation requested: ${analysis.sharingSuggestion?.content_to_share || 'Health concern'}`;
    const result = await escalate({
        circleId,
        userId,
        type: 'CONSULTATION',
        details: consultationDetails,
        messageId: analysis.message_id ?? null,
        eventDetails: { userId }
    });

    return {
        action: 'ESCALATE',
        escalated: true,
        details: { tier: ESCALATION_TIERS.CONSULTATION, escalation_type: 'CONSULTATION', escalation_id: result.escalationId },
        actions: result.actions
    };
}

/**
 * Main escalation handler with tier-based routing
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - Original message
 * @param {string} circleId - Circle ID
 * @param {object} analysis - AI analysis
 * @param {number} confidence - Confidence level (0-1) that escalation is needed
 * @returns {Promise<object|false>} Sharing result, or false if no escalation is needed
 */
export async function handleTieredEscalation(userId, role, message, circleId, analysis, confidence = 0.5) {
    // HIGH criticality always bypasses tiers and goes directly to consultation or override
    if (analysis.criticality === 'HIGH') {
        // For HIGH criticality, use the existing override system
        return await handleTier4Consultation(userId, circleId, analysis);
    }

    // Determine appropriate tier
    const tier = determineEscalationTier(analysis.criticality, confidence);

    if (!tier) {
        return false; // No escalation needed
    }

    // Route to appropriate tier handler
    switch (tier) {
        case ESCALATION_TIERS.PERMISSION:
            return await handleTier1Permission(userId, circleId, analysis);
        case ESCALATION_TIERS.CAREGIVER:
            return await handleTier2Caregiver(userId, circleId, analysis);
        case ESCALATION_TIERS.ANONYMOUS:
            return await handleTier3Anonymous(userId, circleId, analysis);
        case ESCALATION_TIERS.CONSULTATION:
            return await handleTier4Consultation(userId, circleId, analysis);
        default:
            return false;
    }
}

// Whole-word answers only: "I took my pills" is not an "ok", and "I don't know" is not a "no"
const YES_PATTERN = /\b(?:yes|yeah|yep|ok|okay|sure|please do|go ahead)\b/i;
const NO_PATTERN = /\b(?:no|nope|not now|rather not)\b|\b(?:don't|do not)\b(?!\s+know)/i;

/**
 * Handle user response to escalation permission request
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {string} response - User response ('yes' or 'no')
 * @param {object} pendingAction - The pending action details
 * @returns {Promise<{reply: string, sharingResult: object|null}|false>} The reply stating what
 *   was done, or false if the response was not recognized
 */
export async function handleEscalationPermissionResponse(userId, circleId, response, pendingAction) {
    const details = pendingAction.details;
    const answeredYes = YES_PATTERN.test(response);
    const answeredNo = NO_PATTERN.test(response);
    // A mixed answer ("yes, but not now") is taken as neither
    if (answeredYes === answeredNo) {
        return false; // Response not recognized
    }

    // The question is answered: it must not capture later messages
    await removePendingAction(pendingAction.action_id);

    const analysis = {
        criticality: details.criticality || 'MEDIUM',
        sharingSuggestion: {
            reason: details.reason,
            content_to_share: details.content
        }
    };

    if (answeredYes) {
        // Tier 2 (caregiver) first; it moves to tier 3 when there are no caregivers
        const sharingResult = await handleTier2Caregiver(userId, circleId, analysis);
        return { reply: buildActionStatus(sharingResult.actions), sharingResult };
    }

    // User denied permission. Only proceed if confidence is high enough - otherwise respect denial
    const confidence = 0.5; // Default confidence - could be improved
    if (confidence >= 0.8 && analysis.criticality === 'MEDIUM') {
        // High confidence + medium criticality = proceed with anonymous consultation
        const sharingResult = await handleTier3Anonymous(userId, circleId, analysis);
        return { reply: buildActionStatus(sharingResult.actions), sharingResult };
    }

    // Respect denial - don't escalate
    return {
        reply: 'I understand. If your symptoms change or worsen, please let me know and we can revisit this.',
        sharingResult: null
    };
}
