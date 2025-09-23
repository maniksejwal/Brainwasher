/**
 * @fileoverview handlers/message_logic/sharingHandler.js
 * Handles all logic for sharing information, now driven by the AI's intent analysis.
 * This is a critical module that decides when to escalate, when to mediate advice,
 * and when to ask for consent.
 */

import { addEscalation, getImpliedConsent, getCircleMembers, findUserById, findCircleByPatientId } from '../../db/index.js';
import { generateSharingRequest, generateSharingSummaryOrProbe, generateMediatedClarification } from '../../agents/index.js';
import { createSharingConsentAction } from '../../state_manager.js';
import { events } from '../../orchestrator.js';

/**
 * Handles the case where a user reports facts about another person in the care circle.
 * This should trigger either escalation to doctor or consent request for sharing.
 * @returns {boolean} - True if the fact report was handled, otherwise false.
 */
async function handleFactReporting(userId, circleId, analysis, originalUserId = null) {
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
            console.log(`[SharingHandler] Fact about '${targetMember.username}' belongs in their personal care circle. Processing in target's circle.`);
            // Process this fact in the target's care circle, but keep track of original reporter
            return await handleFactReporting(targetMember.user_id, targetPersonalCircle.circle_id, analysis, reporterUserId);
        }
    }

    const patient = await findUserById((await findCircleByPatientId(circleId)).primary_patient_id);

    // For each fact about another person, decide on appropriate action
    for (const [factKey, fact] of factsAboutOthers) {
        const targetMember = members.find(m => m.username === fact.subject);
        if (!targetMember) continue;

        console.log(`[SharingHandler] Detected fact report from '${userId}' about '${targetMember.username}': ${factKey}`);

        // Check if this is medically significant enough to escalate to doctor
        if (analysis.criticality === 'MEDIUM' || analysis.criticality === 'HIGH') {
            const escalationDetails = `User '${reporterUser.username}' reported about '${targetMember.username}': "${factKey}" - ${fact.value}`;
            await addEscalation(circleId, 'FACT_REPORT', escalationDetails);
            events.emit('escalate', { circleId });
            
            const confirmationReply = `I've noted this information about ${targetMember.username} and will share it with the doctor. ${analysis.reply}`;
            events.emit('broadcast', { 
                targetUsers: [reporterUserId], 
                reply: confirmationReply, 
                from: 'personal-agent', 
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
            events.emit('broadcast', { 
                targetUsers: [targetMember.user_id], 
                message: contextualMessage, 
                from: 'personal-agent', 
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
            events.emit('broadcast', { 
                targetUsers: [reporterUserId], 
                reply: request, 
                from: 'personal-agent', 
                circleId, 
                patientUsername: patient.username 
            });
        }
    }

    return true; // The fact report was handled.
}

/**
 * Handles the case where a user requests mediation to communicate with another person.
 * This creates a mediated conversation where the AI helps facilitate communication.
 * @returns {boolean} - True if the mediation request was handled, otherwise false.
 */
async function handleMediationRequest(userId, circleId, analysis) {
    if (analysis.intent !== 'REQUESTING_MEDIATION' || !analysis.sharingSuggestion) {
        return false;
    }

    const members = await getCircleMembers(circleId);
    const currentUser = await findUserById(userId);
    const patient = await findUserById((await findCircleByPatientId(circleId)).primary_patient_id);
    
    const targetUsername = analysis.sharingSuggestion.target;
    const targetMember = members.find(m => m.username.toLowerCase() === targetUsername.toLowerCase());
    
    if (!targetMember) {
        console.log(`[SharingHandler] Mediation target '${targetUsername}' not found in circle ${circleId}`);
        return false;
    }

    console.log(`[SharingHandler] User '${currentUser.username}' requesting mediation with '${targetMember.username}'`);

    // Create a mediated message for the target person
    const mediatedMessage = await generateMediatedClarification(targetMember.username, analysis.sharingSuggestion.content_to_share);
    
    // Send the mediated message to the target person
    events.emit('broadcast', {
        targetUsers: [targetMember.user_id],
        message: mediatedMessage,
        from: 'personal-agent',
        circleId,
        patientUsername: patient.username
    });

    // Confirm to the requesting user that mediation was initiated
    const confirmationReply = `I've reached out to ${targetMember.username} to help facilitate the conversation. They should respond soon.`;
    events.emit('broadcast', {
        targetUsers: [userId],
        reply: confirmationReply,
        from: 'personal-agent',
        circleId,
        patientUsername: patient.username
    });

    return true;
}

/**
 * Handles the case where a user explicitly requests to talk to or consult with the doctor.
 * This should trigger immediate escalation to the doctor.
 * @returns {boolean} - True if the doctor request was handled, otherwise false.
 */
async function handleDoctorRequest(userId, circleId, analysis) {
    if (analysis.intent !== 'REQUESTING_DOCTOR') {
        return false;
    }

    const currentUser = await findUserById(userId);
    const patient = await findUserById((await findCircleByPatientId(circleId)).primary_patient_id);
    
    console.log(`[SharingHandler] User '${currentUser.username}' requesting doctor consultation`);

    // Create escalation for doctor request
    const escalationDetails = `User '${currentUser.username}' requested doctor consultation: "${analysis.sharingSuggestion?.content_to_share || 'Patient wants to speak with doctor'}"`;
    await addEscalation(circleId, 'DOCTOR_REQUEST', escalationDetails);
    events.emit('escalate', { circleId });

    // Confirm to the requesting user that doctor has been notified
    const confirmationReply = `I've notified the doctor that you'd like to speak with them. They should respond soon.`;
    events.emit('broadcast', {
        targetUsers: [userId],
        reply: confirmationReply,
        from: 'personal-agent',
        circleId,
        patientUsername: patient.username
    });

    return true;
}

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
        
        // Notify family members about critical health issues
        const members = await getCircleMembers(circleId);
        const familyMembers = members.filter(m => m.role === 'caregiver' && m.user_id !== userId);
        if (familyMembers.length > 0) {
            const familyNotification = `Urgent health update: ${patientUsername} reported a critical health concern. Please check on them.`;
            events.emit('broadcast', { 
                targetUsers: familyMembers.map(m => m.user_id), 
                message: familyNotification, 
                from: 'personal-agent', 
                circleId, 
                patientUsername 
            });
        }
        
        const confirmationReply = `This sounds serious. I have escalated this to the doctor immediately. ${analysis.reply}`;
        events.emit('broadcast', { targetUsers: [userId], reply: confirmationReply, from: 'personal-agent', circleId, patientUsername });
        return;
    }
    
    // 2. Handle REPORTING_FACT about another person in the care circle.
    const wasFactReportHandled = await handleFactReporting(userId, circleId, analysis);
    if (wasFactReportHandled) {
        return;
    }
    
    // 3. Handle the specific intent of REQUESTING_DOCTOR.
    const wasDoctorRequestHandled = await handleDoctorRequest(userId, circleId, analysis);
    if (wasDoctorRequestHandled) {
        return;
    }
    
    // 4. Handle the specific intent of REQUESTING_MEDIATION.
    const wasMediationHandled = await handleMediationRequest(userId, circleId, analysis);
    if (wasMediationHandled) {
        return;
    }
    
    // 5. Handle the specific intent of GIVING_ADVICE_FOR_OTHER.
    const wasAdviceHandled = await handleAdviceSharing(userId, circleId, analysis);
    if (wasAdviceHandled) {
        return;
    }

    const members = await getCircleMembers(circleId);

    // 4. Fall back to the standard proactive sharing suggestion flow.
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
            const request = await generateSharingRequest(targetMember.role, analysis.sharingSuggestion.reason, analysis.sharingSuggestion.content_to_share);
            // Store the full question text in the suggestion for better matching
            suggestion.full_question = request;
            await createSharingConsentAction(userId, circleId, suggestion);
            events.emit('broadcast', { targetUsers: [userId], reply: request, from: 'personal-agent', circleId, patientUsername });
        }
    }
}

