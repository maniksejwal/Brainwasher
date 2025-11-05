/**
 * @fileoverview handlers/message_logic/sharing/fallbackSharing.js
 * Handles the fallback sharing suggestion flow when other handlers don't match.
 * Uses tiered escalation for doctor escalations.
 */

import { getCircleMembers, findUserById, findCircleByPatientId, getImpliedConsent } from '../../../db/index.js';
import { generateSharingRequest, generateSharingSummaryOrProbe } from '../../../agents/index.js';
import { createSharingConsentAction } from '../../../state_manager.js';
import { events } from '../../../orchestrator.js';
import { getAgentName } from '../../utils/agentIdentity.js';
import { handleTieredEscalation } from './escalationTiers.js';

/**
 * Handles the fallback sharing suggestion flow
 * @param {string} userId - The user ID
 * @param {string} circleId - The circle ID
 * @param {object} analysis - The AI analysis result
 * @returns {Promise<boolean>} - True if handled, false otherwise
 */
export async function handleFallbackSharing(userId, circleId, analysis) {
    if (!analysis.sharingSuggestion || !analysis.sharingSuggestion.target || !analysis.sharingSuggestion.content_to_share) {
        return false;
    }

    // If target is doctor, use tiered escalation system
    if (analysis.sharingSuggestion.target === 'doctor' && analysis.criticality !== 'HIGH') {
        // HIGH criticality is handled by criticalEvents.js
        // For MEDIUM/LOW, use tiered escalation
        const confidence = 0.6; // Default confidence - could be improved based on analysis
        return await handleTieredEscalation(userId, 'patient', analysis.message || '', circleId, analysis, confidence);
    }

    const members = await getCircleMembers(circleId);
    const targetUsername = analysis.sharingSuggestion.target;
    const targetMember = members.find(m => m.username === targetUsername && m.user_id !== userId);

    if (!targetMember) {
        return false;
    }

    const currentCircle = await findCircleByPatientId(circleId);
    const patientUsername = (await findUserById(currentCircle.primary_patient_id)).username;

    const topic = Object.keys(analysis.facts || {})[0] || 'general';
    const implied = await getImpliedConsent(userId, circleId, topic);

    if (implied || targetMember.consent_level === 'full') {
        console.log(`[FallbackSharing] Sharing with ${targetMember.username} based on implied or full consent.`);
        const contextualMessage = await generateSharingSummaryOrProbe(userId, targetMember.username, analysis.sharingSuggestion.content_to_share);
        const agentName = await getAgentName(targetMember.user_id, circleId);
        events.emit('broadcast', { targetUsers: [targetMember.user_id], message: contextualMessage, from: agentName, circleId, patientUsername });
    } else {
        const currentUser = await findUserById(userId);
        const suggestion = { originatingUser: currentUser.username, ...analysis.sharingSuggestion };
        const request = await generateSharingRequest(targetMember.role, analysis.sharingSuggestion.reason, analysis.sharingSuggestion.content_to_share);
        // Store the full question text in the suggestion for better matching
        suggestion.full_question = request;
        await createSharingConsentAction(userId, circleId, suggestion);
        const agentName = await getAgentName(userId, circleId);
        events.emit('broadcast', { targetUsers: [userId], reply: request, from: agentName, circleId, patientUsername });
    }

    return true;
}
