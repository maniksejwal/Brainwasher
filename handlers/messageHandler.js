/**
 * @fileoverview handlers/messageHandler.js
 * The main dispatcher for handling all regular user messages (non-commands).
 * This module follows a clear "chain of thought" to process incoming messages,
 * including entity resolution and implied context switching.
 */

import { getMemberInfo, findUserById, findCircleByPatientId, getCircleMembers, addMessage } from '../db/index.js';
import { performAiAnalysis } from './message_logic/aiAnalysisHandler.js';
import { handleFactProcessing } from './message_logic/conflictHandler.js';
import { handleSharingAndEscalation } from './message_logic/sharingHandler.js';
import { handlePendingActionResponse } from './message_logic/actionResponseHandler.js';

export async function handleMessage(userId, circleId, message) {
    const memberInfo = await getMemberInfo(userId, circleId);
    if (!memberInfo) {
        console.error(`[MessageHandler] ERROR: User ${userId} is not a member of circle ${circleId}.`);
        return;
    }

    if (memberInfo.role === 'doctor') {
        // Doctors have a simple, direct communication path.
        console.log(`[MessageHandler] Doctor '${userId}' is broadcasting a message to circle '${circleId}'.`);
        const members = await getCircleMembers(circleId);
        const targetUserIds = members.map(m => m.user_id).filter(id => id !== userId);
        const circle = await findCircleByPatientId(circleId);
        const patient = await findUserById(circle.primary_patient_id);

        await addMessage(circleId, userId, memberInfo.role, message, 'PRIVATE', 'NONE');
        events.emit('broadcast', {
            targetUsers: targetUserIds,
            message: message,
            from: 'doctor',
            circleId,
            patientUsername: patient.username
        });
        return;
    }
    
    // ** RE-ARCHITECTED CHAIN OF THOUGHT FOR PATIENTS/CAREGIVERS **

    // Step 1: Handle any pending user actions (like responding to a consent request).
    const wasActionHandled = await handlePendingActionResponse(userId, circleId, message);
    if (wasActionHandled) {
        return;
    }

    // Step 2: Perform the full AI analysis, including entity resolution.
    const analysis = await performAiAnalysis(userId, memberInfo.role, message, circleId);

    // Step 3: Handle the core logic: facts, conflicts, escalations, and all forms of sharing.
    // This is now the primary function that embodies the agent-centric model.
    await handleSharingAndEscalation(userId, memberInfo.role, message, circleId, analysis);
    
    // Step 4: Process facts from the analysis and check for conflicts.
    // This runs after sharing to ensure critical escalations happen first.
    await handleFactProcessing(userId, circleId, analysis);
}

