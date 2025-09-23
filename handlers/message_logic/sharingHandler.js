/**
 * @fileoverview handlers/message_logic/sharingHandler.js
 * Handles all logic for sharing information, now driven by the AI's intent analysis.
 * This is a critical module that decides when to escalate, when to mediate advice,
 * and when to ask for consent.
 */

import { addEscalation, getImpliedConsent, getCircleMembers, findUserById, findCircleByPatientId } from '../../db/index.js';
import { generateSharingRequest, generateSharingSummaryOrProbe } from '../../agents/index.js';
import { createSharingConsentAction } from '../../state_manager.js';
import { events } from '../../orchestrator.js';

/**
 * Handles the specific case where one user gives advice for another.
 * Instead of escalating, it mediates the advice to the target user's agent.
 * @returns {boolean} - True if the advice was handled, otherwise false.
 */
async function handleAdviceSharing(userId, circleId, analysis) {
    if (analysis.intent !== 'GIVING_ADVICE_FOR_OTHER' || !analysis.facts || !analysis.sharingSuggestion) {
        return false;
    }

    const factKey = Object.keys(analysis.facts)[0];
    const fact = analysis.facts[factKey];
    if (!fact.subject) return false;

    const members = await getCircleMembers(circleId);
    const targetMember = members.find(m => m.username === fact.subject);
    if (!targetMember) return false;

    console.log(`[SharingHandler] Detected advice from '${userId}' for '${targetMember.username}'. Mediating.`);
    const currentUser = await findUserById(userId);
    const patient = await findUserById((await findCircleByPatientId(circleId)).primary_patient_id);

    // Generate a natural language message for the target user's agent to deliver.
    const contextualMessage = await generateSharingSummaryOrProbe(currentUser.username, targetMember.username, analysis.sharingSuggestion.content_to_share);
    
    events.emit('broadcast', {
        targetUsers: [targetMember.user_id],
        message: contextualMessage,
        from: 'personal-agent',
        circleId,
        patientUsername: patient.username
    });

    return true; // The advice was successfully mediated.
}

export async function handleSharingAndEscalation(userId, role, message, circleId, analysis) {
    const currentCircle = await findCircleByPatientId(circleId);
    const patientUsername = (await findUserById(currentCircle.primary_patient_id)).username;

    // 1. Handle HIGH criticality events first. This is a safety override.
    if (analysis.criticality === 'HIGH') {
        const criticalDetails = `User '${userId}' (${role}) reported: "${message}"`;
        await addEscalation(circleId, 'CRITICAL', criticalDetails);
        events.emit('escalate', { circleId });
        const confirmationReply = `This sounds serious. I have escalated this to the doctor immediately. ${analysis.reply}`;
        events.emit('broadcast', { targetUsers: [userId], reply: confirmationReply, from: 'personal-agent', circleId, patientUsername });
        return;
    }
    
    // 2. Handle the specific intent of GIVING_ADVICE_FOR_OTHER.
    const wasAdviceHandled = await handleAdviceSharing(userId, circleId, analysis);
    if (wasAdviceHandled) {
        return;
    }

    const members = await getCircleMembers(circleId);

    // 3. Fall back to the standard proactive sharing suggestion flow.
    if (analysis.sharingSuggestion && analysis.sharingSuggestion.target && analysis.sharingSuggestion.content_to_share) {
        const targetUsername = analysis.sharingSuggestion.target;
        const targetMember = members.find(m => m.username === targetUsername && m.user_id !== userId);

        if (!targetMember) {
            return;
        }

        const topic = Object.keys(analysis.facts || {})[0] || 'general';
        const implied = await getImpliedConsent(userId, circleId, topic);

        if (implied || targetMember.consent_level === 'full') {
            console.log(`[SharingHandler] Sharing with ${targetMember.username} based on implied or full consent.`);
            const contextualMessage = await generateSharingSummaryOrProbe(userId, targetMember.username, analysis.sharingSuggestion.content_to_share);
            events.emit('broadcast', { targetUsers: [targetMember.user_id], message: contextualMessage, from: 'personal-agent', circleId, patientUsername });
        } else {
            const currentUser = await findUserById(userId);
            const suggestion = { originatingUser: currentUser.username, ...analysis.sharingSuggestion };
            await createSharingConsentAction(userId, circleId, suggestion);
            const request = await generateSharingRequest(targetMember.role, analysis.sharingSuggestion.reason, analysis.sharingSuggestion.content_to_share);
            events.emit('broadcast', { targetUsers: [userId], reply: request, from: 'personal-agent', circleId, patientUsername });
        }
    }
}

