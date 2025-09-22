/**
 * @fileoverview The main dispatcher for handling all regular user messages (non-commands).
 * This module follows a clear "chain of thought" to process incoming messages,
 * including entity resolution and implied context switching.
 */

import { getMemberInfo, findUserById, findCircleByPatientId, findCircleByPatientUsername } from '../db/index.js';
import { performAiAnalysis } from './message_logic/aiAnalysisHandler.js';
import { handleFactProcessing } from './message_logic/conflictHandler.js';
import { handleSharingAndEscalation } from './message_logic/sharingHandler.js';
import { handlePendingActionResponse } from './message_logic/actionResponseHandler.js';
import { createSharingConsentAction } from '../state_manager.js';
import { events } from '../orchestrator.js';

// This function checks if a message is about another user and initiates the context switch flow.
async function handleImpliedContextSwitch(userId, circleId, message, analysis) {
    if (!analysis.mentioned_usernames || analysis.mentioned_usernames.length === 0) {
        return false;
    }

    const currentUser = await findUserById(userId);
    const currentCircle = await findCircleByPatientId(circleId);
    if (!currentCircle || !currentUser) return false;
    const currentPatient = await findUserById(currentCircle.primary_patient_id);

    for (const username of analysis.mentioned_usernames) {
        if (username === currentUser.username || username === currentPatient.username) {
            continue;
        }

        const targetCircle = await findCircleByPatientUsername(username);
        if (targetCircle) {
            const memberInfo = await getMemberInfo(userId, targetCircle.circle_id);
            if (memberInfo) {
                const suggestion = {
                    originatingUser: userId,
                    originalMessage: message,
                    targetCircleId: targetCircle.circle_id,
                    targetPatientUsername: username
                };
                await createSharingConsentAction(userId, circleId, suggestion, 'implied_switch_consent');
                const request = `This message seems to be about ${username}. Is it okay if I log it in their care circle for context? You can reply with /yes or /no.`;
                events.emit('broadcast', { targetUsers: [userId], reply: request, from: 'personal-agent', circleId, patientUsername: currentPatient.username });
                return true;
            }
        }
    }
    return false;
}

export async function handleMessage(userId, circleId, message) {
    const memberInfo = await getMemberInfo(userId, circleId);
    if (!memberInfo) {
        console.error(`[MessageHandler] ERROR: User ${userId} is not a member of circle ${circleId}.`);
        return;
    }

    // ** FIX: Re-architected Chain of Thought **

    // Step 1: Handle any pending user actions (like responding to a consent request).
    const wasActionHandled = await handlePendingActionResponse(userId, circleId, message);
    if (wasActionHandled) {
        return; // If the user's message was a response, our work is done.
    }

    // Step 2: If it's a new message, perform the full AI analysis.
    const analysis = await performAiAnalysis(userId, memberInfo.role, message, circleId);

    // Step 3: Check for Implied Context Switching. This must happen BEFORE escalation.
    const wasImpliedSwitchHandled = await handleImpliedContextSwitch(userId, circleId, message, analysis);
    if (wasImpliedSwitchHandled) {
        return; // Stop processing in the current circle if we've asked for a context switch.
    }
    
    // Step 4: If no context switch, proceed with fact processing and conflict detection.
    await handleFactProcessing(userId, circleId, analysis);

    // Step 5: Finally, handle escalations and proactive sharing suggestions.
    await handleSharingAndEscalation(userId, memberInfo.role, message, circleId, analysis);
}

