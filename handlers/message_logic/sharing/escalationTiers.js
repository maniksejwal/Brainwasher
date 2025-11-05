/**
 * @fileoverview handlers/message_logic/sharing/escalationTiers.js
 * Implements 4-tier escalation system:
 * 1. Seek permission - ask patient if they want to escalate
 * 2. Notify caregiver - inform family members (lower cost)
 * 3. Anonymous consultation - consult doctor without patient identity (costs minimal money)
 * 4. Actual consultation - full doctor consultation (costs money)
 */

import { addEscalation, getCircleMembers, findUserById, findCircleByPatientId, addPendingAction } from '../../../db/index.js';
import { events } from '../../../orchestrator.js';
import { getAgentName } from '../../utils/agentIdentity.js';
import { randomUUID } from 'crypto';

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
 * @returns {Promise<boolean>} True if handled
 */
export async function handleTier1Permission(userId, circleId, analysis) {
    const currentCircle = await findCircleByPatientId(circleId);
    const patientUsername = (await findUserById(currentCircle.primary_patient_id)).username;
    const currentUser = await findUserById(userId);
    
    // Create pending action for permission request
    const actionId = randomUUID();
    const details = {
        action_type: 'escalation_permission',
        criticality: analysis.criticality,
        reason: analysis.sharingSuggestion?.reason || 'Health concern requires medical attention',
        content: analysis.sharingSuggestion?.content_to_share || analysis.message || 'Patient health concern'
    };
    
    await addPendingAction(actionId, circleId, userId, 'escalation_permission', details);
    
    // Ask patient for permission
    const permissionMessage = `I'm concerned about what you've shared. Would you like me to consult with a doctor about this? This will help ensure you get the right care.`;
    const agentName = await getAgentName(userId, circleId);
    
    events.emit('broadcast', {
        targetUsers: [userId],
        reply: permissionMessage,
        from: agentName,
        circleId,
        patientUsername
    });
    
    return true;
}

/**
 * Handle tier 2: Notify caregiver
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {object} analysis - AI analysis
 * @returns {Promise<boolean>} True if handled
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
    
    // Notify caregivers
    const caregiverNotification = `${patientUsername} has reported a health concern. You may want to check on them. Details: ${analysis.sharingSuggestion?.content_to_share || 'Health concern reported'}`;
    const agentName = await getAgentName(familyMembers[0].user_id, circleId);
    
    events.emit('broadcast', {
        targetUsers: familyMembers.map(m => m.user_id),
        message: caregiverNotification,
        from: agentName,
        circleId,
        patientUsername
    });
    
    // Log escalation for tracking
    await addEscalation(circleId, 'CAREGIVER_NOTIFICATION', `Caregiver notified about ${patientUsername}'s health concern`);
    
    // Inform patient
    const confirmationReply = `I've notified your family members about your concern so they can check on you.`;
    const patientAgentName = await getAgentName(userId, circleId);
    events.emit('broadcast', {
        targetUsers: [userId],
        reply: confirmationReply,
        from: patientAgentName,
        circleId,
        patientUsername
    });
    
    return true;
}

/**
 * Handle tier 3: Anonymous consultation (no patient identity, costs money)
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {object} analysis - AI analysis
 * @returns {Promise<boolean>} True if handled
 */
export async function handleTier3Anonymous(userId, circleId, analysis) {
    const currentCircle = await findCircleByPatientId(circleId);
    const patientUsername = (await findUserById(currentCircle.primary_patient_id)).username;
    
    // Create anonymous escalation (no patient identity)
    const anonymousDetails = `Anonymous consultation requested. Symptoms: ${analysis.sharingSuggestion?.content_to_share || 'Health concern'}. No patient identity shared.`;
    await addEscalation(circleId, 'ANONYMOUS_CONSULTATION', anonymousDetails);
    events.emit('escalate', { circleId, anonymous: true });
    
    // Inform patient
    const confirmationReply = `I've consulted with a doctor anonymously about your concern. They've provided guidance without knowing your identity. If you'd like a full consultation, I can arrange that.`;
    const agentName = await getAgentName(userId, circleId);
    events.emit('broadcast', {
        targetUsers: [userId],
        reply: confirmationReply,
        from: agentName,
        circleId,
        patientUsername
    });
    
    return true;
}

/**
 * Handle tier 4: Actual consultation (full doctor consultation, costs money)
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {object} analysis - AI analysis
 * @returns {Promise<boolean>} True if handled
 */
export async function handleTier4Consultation(userId, circleId, analysis) {
    const currentCircle = await findCircleByPatientId(circleId);
    const patientUsername = (await findUserById(currentCircle.primary_patient_id)).username;
    
    // Full escalation with patient identity
    const consultationDetails = `User '${userId}' consultation requested: ${analysis.sharingSuggestion?.content_to_share || 'Health concern'}`;
    await addEscalation(circleId, 'CONSULTATION', consultationDetails);
    events.emit('escalate', { circleId });
    
    // Inform patient
    const confirmationReply = `I've arranged a consultation with your doctor. They will review your concern and get back to you.`;
    const agentName = await getAgentName(userId, circleId);
    events.emit('broadcast', {
        targetUsers: [userId],
        reply: confirmationReply,
        from: agentName,
        circleId,
        patientUsername
    });
    
    return true;
}

/**
 * Main escalation handler with tier-based routing
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - Original message
 * @param {string} circleId - Circle ID
 * @param {object} analysis - AI analysis
 * @param {number} confidence - Confidence level (0-1) that escalation is needed
 * @returns {Promise<boolean>} True if handled
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

/**
 * Handle user response to escalation permission request
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {string} response - User response ('yes' or 'no')
 * @param {object} pendingAction - The pending action details
 * @returns {Promise<boolean>} True if handled
 */
export async function handleEscalationPermissionResponse(userId, circleId, response, pendingAction) {
    const details = pendingAction.details;
    const userResponse = response.toLowerCase().trim();
    
    if (userResponse === 'yes' || userResponse.includes('yes') || userResponse.includes('ok') || userResponse.includes('sure')) {
        // User granted permission, escalate to next tier
        const criticality = details.criticality || 'MEDIUM';
        
        // Determine next tier based on criticality
        if (criticality === 'MEDIUM') {
            // Try tier 2 (caregiver) first, then tier 3 if no caregivers
            const handled = await handleTier2Caregiver(userId, circleId, {
                criticality: criticality,
                sharingSuggestion: {
                    reason: details.reason,
                    content_to_share: details.content
                }
            });
            
            if (!handled) {
                // No caregivers, go to tier 3
                await handleTier3Anonymous(userId, circleId, {
                    criticality: criticality,
                    sharingSuggestion: {
                        reason: details.reason,
                        content_to_share: details.content
                    }
                });
            }
        } else if (criticality === 'LOW') {
            // For LOW, just notify caregiver
            await handleTier2Caregiver(userId, circleId, {
                criticality: criticality,
                sharingSuggestion: {
                    reason: details.reason,
                    content_to_share: details.content
                }
            });
        }
        
        return true;
    } else if (userResponse === 'no' || userResponse.includes('no') || userResponse.includes('don\'t') || userResponse.includes('not')) {
        // User denied permission
        // Only proceed if confidence is high enough - otherwise respect denial
        const confidence = 0.5; // Default confidence - could be improved
        
        if (confidence >= 0.8 && details.criticality === 'MEDIUM') {
            // High confidence + medium criticality = proceed with anonymous consultation
            await handleTier3Anonymous(userId, circleId, {
                criticality: details.criticality,
                sharingSuggestion: {
                    reason: details.reason,
                    content_to_share: details.content
                }
            });
        } else {
            // Respect denial - don't escalate
            const currentCircle = await findCircleByPatientId(circleId);
            const patientUsername = (await findUserById(currentCircle.primary_patient_id)).username;
            const agentName = await getAgentName(userId, circleId);
            
            events.emit('broadcast', {
                targetUsers: [userId],
                reply: `I understand. If your symptoms change or worsen, please let me know and we can revisit this.`,
                from: agentName,
                circleId,
                patientUsername
            });
        }
        
        return true;
    }
    
    return false; // Response not recognized
}

