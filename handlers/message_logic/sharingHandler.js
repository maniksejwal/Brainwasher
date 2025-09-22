/**
 * @fileoverview Handles the logic for sharing information with other members
 * of a care circle, including checking for criticality, consent levels,
 * and initiating new consent requests.
 */

import { addEscalation, getImpliedConsent, getCircleMembers } from '../../db/index.js';
import { generateSharingRequest, generateSharingSummaryOrProbe } from '../../agents/index.js';
import { createSharingConsentAction } from '../../state_manager.js';
import { events } from '../../orchestrator.js';

export async function handleSharingAndEscalation(userId, role, message, circleId, analysis) {
    // 1. Prioritize HIGH criticality above all else for safety
    if (analysis.criticality === 'HIGH') {
        const criticalDetails = `User '${userId}' (${role}) reported: "${message}"`;
        await addEscalation(circleId, 'CRITICAL', criticalDetails);
        events.emit('escalate', { circleId });
        const confirmationReply = `This sounds serious. I have escalated this to the doctor immediately. ${analysis.reply}`;
        events.emit('broadcast', { targetUsers: [userId], reply: confirmationReply, from: 'personal-agent', circleId });
        return; // Stop further sharing logic in an emergency
    }

    const members = await getCircleMembers(circleId);

    // 2. Handle AI's proactive sharing suggestions
    if (analysis.sharingSuggestion && analysis.sharingSuggestion.target && analysis.sharingSuggestion.content_to_share) {
        const targetUsername = analysis.sharingSuggestion.target;
        const targetMember = members.find(m => m.username === targetUsername && m.user_id !== userId);

        if (!targetMember) {
            console.log(`[SharingHandler] AI suggested sharing with user '${targetUsername}' but they are not in this circle.`);
            return;
        }

        const topic = Object.keys(analysis.facts || {})[0] || 'general';
        const implied = await getImpliedConsent(userId, circleId, topic);

        // Share automatically if implied consent exists or the target has 'full' consent from the patient
        if (implied || targetMember.consent_level === 'full') {
            console.log(`[SharingHandler] Sharing with ${targetMember.username} based on implied or full consent.`);
            const contextualMessage = await generateSharingSummaryOrProbe(userId, targetMember.username, analysis.sharingSuggestion.content_to_share);
            events.emit('broadcast', { targetUsers: [targetMember.user_id], message: contextualMessage, from: 'personal-agent', circleId });
        } else {
            // Otherwise, ask for per-message consent
            const suggestion = { originatingUser: userId, ...analysis.sharingSuggestion };
            await createSharingConsentAction(userId, circleId, suggestion);
            const request = await generateSharingRequest(targetMember.role, analysis.sharingSuggestion.reason, analysis.sharingSuggestion.content_to_share);
            events.emit('broadcast', { targetUsers: [userId], reply: request, from: 'personal-agent', circleId });
        }
    }
}
