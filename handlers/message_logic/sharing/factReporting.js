/**
 * @fileoverview handlers/message_logic/sharing/factReporting.js
 * Handles the case where a user reports facts about another person in the care circle.
 * This should trigger either escalation to doctor or consent request for sharing.
 */

import { addEscalation, getImpliedConsent, getCircleMembers, findUserById, findCircleByPatientId, findCircleById } from '../../../db/index.js';
import { generateSharingRequest, generateSharingSummaryOrProbe } from '../../../agents/index.js';
import { createSharingConsentAction } from '../../../state_manager.js';
import { events } from '../../../orchestrator.js';
import { getAgentName } from '../../utils/agentIdentity.js';

/**
 * Handles the case where a user reports facts about another person in the care circle.
 * This should trigger either escalation to doctor or consent request for sharing.
 * @returns {boolean} - True if the fact report was handled, otherwise false.
 */
export async function handleFactReporting(userId, circleId, analysis, originalUserId = null) {
    if (analysis.intent !== 'REPORTING_FACT' || !analysis.facts) {
        return false;
    }

    // Track the original user who reported the fact
    const reporterUserId = originalUserId || userId;

    // Check if any facts are about another person
    const factsAboutOthers = Object.entries(analysis.facts).filter(([key, fact]) => 
        fact.subject && fact.subject !== reporterUserId
    );

    if (factsAboutOthers.length === 0) {
        return false;
    }

    const members = await getCircleMembers(circleId);
    const currentUser = await findUserById(userId);
    const reporterUser = await findUserById(reporterUserId);
    
    // Check if the fact is about someone who has their own care circle
    for (const [factKey, fact] of factsAboutOthers) {
        const targetMember = members.find(m => m.username.toLowerCase() === fact.subject.toLowerCase());
        if (!targetMember) continue;

        // Try to find the target's personal care circle (where they are the patient)
        const targetPersonalCircle = await findCircleByPatientId(targetMember.user_id);
        if (targetPersonalCircle && targetPersonalCircle.circle_id !== circleId) {
            console.log(`[FactReporting] Fact about '${targetMember.username}' belongs in their personal care circle. Processing in target's circle.`);
            // Process this fact in the target's care circle, but keep track of original reporter
            return await handleFactReporting(targetMember.user_id, targetPersonalCircle.circle_id, analysis, reporterUserId);
        }
    }

    const circle = await findCircleById(circleId);
    if (!circle) return null;
    const patient = await findUserById(circle.primary_patient_id);

    // For each fact about another person, decide on appropriate action
    for (const [factKey, fact] of factsAboutOthers) {
        const targetMember = members.find(m => m.username === fact.subject);
        if (!targetMember) continue;

        console.log(`[FactReporting] Detected fact report from '${userId}' about '${targetMember.username}': ${factKey}`);

        // Check if this is medically significant enough to escalate to doctor
        if (analysis.criticality === 'MEDIUM' || analysis.criticality === 'HIGH') {
            const escalationDetails = `User '${reporterUser.username}' reported about '${targetMember.username}': "${factKey}" - ${fact.value}`;
            await addEscalation(circleId, 'FACT_REPORT', escalationDetails);
            events.emit('escalate', { circleId });
            
            const confirmationReply = `I've noted this information about ${targetMember.username} and will share it with the doctor. ${analysis.reply}`;
            const agentName = await getAgentName(reporterUserId, circleId);
            events.emit('broadcast', { 
                targetUsers: [reporterUserId], 
                reply: confirmationReply, 
                from: agentName, 
                circleId, 
                patientUsername: patient.username 
            });
            return true;
        }

        // For lower criticality, ask for consent to share with the target person or doctor
        const topic = factKey;
        const implied = await getImpliedConsent(reporterUserId, circleId, topic);

        if (implied || targetMember.consent_level === 'full') {
            // Share directly with the target person
            const contextualMessage = await generateSharingSummaryOrProbe(currentUser.username, targetMember.username, `Information about ${factKey}: ${fact.value}`);
            const agentName = await getAgentName(targetMember.user_id, circleId);
            events.emit('broadcast', { 
                targetUsers: [targetMember.user_id], 
                message: contextualMessage, 
                from: agentName, 
                circleId, 
                patientUsername: patient.username 
            });
        } else {
            // Ask for consent to share - ALWAYS ask the original reporter, not the current user
            const suggestion = {
                originatingUser: reporterUser.username,
                target: targetMember.username,
                reason: `Share information about ${factKey}`,
                content_to_share: `${factKey}: ${fact.value}`
            };
            const request = await generateSharingRequest(targetMember.role, suggestion.reason, suggestion.content_to_share);
            // Store the full question text in the suggestion for better matching
            suggestion.full_question = request;
            await createSharingConsentAction(reporterUserId, circleId, suggestion);
            const agentName = await getAgentName(reporterUserId, circleId);
            events.emit('broadcast', { 
                targetUsers: [reporterUserId], 
                reply: request, 
                from: agentName, 
                circleId, 
                patientUsername: patient.username 
            });
        }
    }

    return true; // The fact report was handled.
}
