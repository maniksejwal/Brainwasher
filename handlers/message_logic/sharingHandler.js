/**
 * @fileoverview handlers/message_logic/sharingHandler.js
 * Handles all logic for sharing information, including criticality checks,
 * inter-agent communication based on implied consent, and explicit consent requests.
 */

import { addEscalation, getImpliedConsent, getCircleMembers, findUserById, findCircleByPatientId, getMemberInfo } from '../../db/index.js';
import { generateSharingRequest, generateSharingSummaryOrProbe } from '../../agents/index.js';
import { createSharingConsentAction } from '../../state_manager.js';
import { events } from '../../orchestrator.js';

// This is the new agent-centric sharing logic
async function handleInterAgentSharing(userId, circleId, analysis) {
    // Check if the message was about another user in a shared circle.
    if (!analysis.facts || Object.keys(analysis.facts).length === 0) return false;

    const factKey = Object.keys(analysis.facts)[0];
    const fact = analysis.facts[factKey];

    if (!fact.subject || fact.subject === (await findUserById(userId)).username) {
        return false; // Fact is about the speaker, not another user.
    }

    const members = await getCircleMembers(circleId);
    const subjectMember = members.find(m => m.username === fact.subject);
    if (!subjectMember) return false; // Subject is not in the current circle.

    // We've confirmed the speaker is talking about another member in the same circle.
    // Now, check consent and privacy.
    console.log(`[SharingHandler] User '${userId}' mentioned '${fact.subject}'. Checking consent.`);

    if (analysis.privacyLevel !== 'SENSITIVE' && subjectMember.consent_level === 'full') {
        console.log(`[SharingHandler] Sharing with '${fact.subject}' based on full consent.`);
        const contextualMessage = await generateSharingSummaryOrProbe(userId, fact.subject, analysis.sharingSuggestion.content_to_share);
        const patient = await findUserById((await findCircleByPatientId(circleId)).primary_patient_id);

        events.emit('broadcast', {
            targetUsers: [subjectMember.user_id],
            message: contextualMessage,
            from: 'personal-agent',
            circleId,
            patientUsername: patient.username
        });
        return true; // Information was shared.
    }
    return false; // Conditions for automatic sharing not met.
}


export async function handleSharingAndEscalation(userId, role, message, circleId, analysis) {
    const currentCircle = await findCircleByPatientId(circleId);
    const patientUsername = (await findUserById(currentCircle.primary_patient_id)).username;

    if (analysis.criticality === 'HIGH') {
        const criticalDetails = `User '${userId}' (${role}) reported: "${message}"`;
        await addEscalation(circleId, 'CRITICAL', criticalDetails);
        events.emit('escalate', { circleId });
        const confirmationReply = `This sounds serious. I have escalated this to the doctor immediately. ${analysis.reply}`;
        events.emit('broadcast', { targetUsers: [userId], reply: confirmationReply, from: 'personal-agent', circleId, patientUsername });
        return;
    }

    // Attempt inter-agent sharing first for non-sensitive info.
    const wasShared = await handleInterAgentSharing(userId, circleId, analysis);
    if (wasShared) return;

    const members = await getCircleMembers(circleId);

    // If not shared automatically, fall back to explicit consent suggestion.
    if (analysis.sharingSuggestion && analysis.sharingSuggestion.target && analysis.sharingSuggestion.content_to_share) {
        const targetUsername = analysis.sharingSuggestion.target;
        const targetMember = members.find(m => m.username === targetUsername && m.user_id !== userId);

        if (!targetMember) {
            return;
        }

        const topic = Object.keys(analysis.facts || {})[0] || 'general';
        const implied = await getImpliedConsent(userId, circleId, topic);

        if (implied) {
            console.log(`[SharingHandler] Sharing with ${targetMember.username} based on implied consent.`);
            const contextualMessage = await generateSharingSummaryOrProbe(userId, targetMember.username, analysis.sharingSuggestion.content_to_share);
            events.emit('broadcast', { targetUsers: [targetMember.user_id], message: contextualMessage, from: 'personal-agent', circleId, patientUsername });
        } else {
            const suggestion = { originatingUser: userId, ...analysis.sharingSuggestion };
            await createSharingConsentAction(userId, circleId, suggestion);
            const request = await generateSharingRequest(targetMember.role, analysis.sharingSuggestion.reason, analysis.sharingSuggestion.content_to_share);
            events.emit('broadcast', { targetUsers: [userId], reply: request, from: 'personal-agent', circleId, patientUsername });
        }
    }
}

