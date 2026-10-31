/**
 * @fileoverview handlers/message_logic/sharing/factReporting.js
 * Handles the case where a user reports facts about another person in the care circle.
 * This should trigger either escalation to doctor or consent request for sharing.
 */

import { getImpliedConsent, getCircleMembers, findUserById, findCircleByPatientId, findCircleById } from '../../../db/index.js';
import { generateSharingRequest, generateSharingSummaryOrProbe } from '../../../agents/index.js';
import { createSharingConsentAction } from '../../../state_manager.js';
import { shareWithMembers } from '../../../services/memberMessaging.js';
import { isHealthyMitraCircle } from '../../../lib/deliveryMode.js';
import { recordInboxEscalation } from '../../../services/escalationService.js';

/**
 * Handles the case where a user reports facts about another person in the care circle.
 * This should trigger either escalation to doctor or consent request for sharing.
 * The reporter is not messaged here: the result carries what was done, and any consent
 * question, for messageHandler's one reply.
 * @returns {Promise<object|false>} - Sharing result if the fact report was handled, otherwise false.
 */
export async function handleFactReporting(userId, circleId, analysis, originalUserId = null) {
    if (analysis.intent !== 'REPORTING_FACT' || !analysis.facts) {
        return false;
    }

    // Track the original user who reported the fact
    const reporterUserId = originalUserId || userId;

    // Check if any facts are about another person
    const factsAboutOthers = Object.entries(analysis.facts).filter(([key, fact]) =>
        fact?.subject && fact.subject !== reporterUserId
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

    const actions = { membersMessaged: [] };
    let question = null;
    let proposal = null;

    // For each fact about another person, decide on appropriate action
    for (const [factKey, fact] of factsAboutOthers) {
        const targetMember = members.find(m => m.username === fact.subject);
        if (!targetMember) continue;

        console.log(`[FactReporting] Detected fact report from '${userId}' about '${targetMember.username}': ${factKey}`);

        // Check if this is medically significant enough to escalate to doctor
        if (analysis.criticality === 'MEDIUM' || analysis.criticality === 'HIGH') {
            const escalationDetails = `User '${reporterUser.username}' reported about '${targetMember.username}': "${factKey}" - ${fact.value}`;
            const doctorMembers = members.filter(m => m.role === 'doctor');
            if (isHealthyMitraCircle(circleId)) {
                // Proposed to the reporter; HealthyMitra sends it to the doctors once accepted
                const shared = doctorMembers.length > 0
                    ? await shareWithMembers({ userId: reporterUserId, circleId, members: doctorMembers, message: escalationDetails, patientUsername: patient.username })
                    : { proposal: null, question: null };
                return {
                    action: 'FACT_REPORT',
                    escalated: false,
                    details: { escalation_type: 'FACT_REPORT', subject: targetMember.username },
                    actions: { noDoctorConnected: doctorMembers.length === 0 },
                    proposal: shared.proposal,
                    question: shared.question
                };
            }
            await recordInboxEscalation({ circleId, type: 'FACT_REPORT', details: escalationDetails, messageId: analysis.message_id ?? null });

            // Doctors see FACT_REPORT rows in their unread list
            const doctors = doctorMembers.map(m => m.username);
            return {
                action: 'FACT_REPORT',
                escalated: true,
                details: { escalation_type: 'FACT_REPORT', subject: targetMember.username },
                actions: { escalationCreated: true, doctors, noDoctorConnected: doctors.length === 0 }
            };
        }

        // For lower criticality, ask for consent to share with the target person or doctor
        const topic = factKey;
        const implied = await getImpliedConsent(reporterUserId, circleId, topic);

        // In a HealthyMitra circle the proposal card is the consent question
        if (implied || targetMember.consent_level === 'full' || isHealthyMitraCircle(circleId)) {
            // Share directly with the target person (proposed in a HealthyMitra circle)
            const contextualMessage = await generateSharingSummaryOrProbe(currentUser.username, targetMember.username, `Information about ${factKey}: ${fact.value}`);
            const shared = await shareWithMembers({ userId: reporterUserId, circleId, members: [targetMember], message: contextualMessage, patientUsername: patient.username });
            actions.membersMessaged.push(...(shared.actions.membersMessaged || []));
            // One card and question per reply
            if (shared.proposal && !proposal) {
                proposal = shared.proposal;
                question = question || shared.question;
            }
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
            // One question per reply; any further consent actions are still pending
            question = question || request;
        }
    }

    // The fact report was handled.
    return { action: 'FACT_REPORT', escalated: false, details: {}, actions, question, proposal };
}
