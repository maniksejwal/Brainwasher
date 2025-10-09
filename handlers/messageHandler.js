/**
 * @fileoverview handlers/messageHandler.js
 * The main dispatcher for handling all regular user messages (non-commands).
 * This module follows a clear "chain of thought" to process incoming messages.
 */

import { getMemberInfo, findUserById, findCircleByPatientId, getCircleMembers, addMessage } from '../db/index.js';
import { performAiAnalysis } from './message_logic/aiAnalysisHandler.js';
import { handleFactProcessing } from './message_logic/conflictHandler.js';
import { handleSharingAndEscalation } from './message_logic/sharing/index.js';
import { handlePendingActionResponse } from './message_logic/actionResponseHandler.js';
import { events } from '../orchestrator.js';
import { logger as trainingLogger, metrics as metricsCollector } from '../training/index.js';

export async function handleMessage(userId, circleId, message) {
    const startTime = Date.now();
    const memberInfo = await getMemberInfo(userId, circleId);
    if (!memberInfo) {
        console.error(`[MessageHandler] ERROR: User ${userId} is not a member of circle ${circleId}.`);
        return;
    }

    // A doctor's message follows a simple, direct broadcast path.
    if (memberInfo.role === 'doctor') {
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
        
        // Training log (fire-and-forget, non-blocking)
        metricsCollector.recordMessageLength(userId, message.length, message.length);
        return;
    }
    
    // For patients and caregivers, follow the full "chain of thought".
    
    // Step 1: Handle any pending user actions.
    const wasActionHandled = await handlePendingActionResponse(userId, circleId, message);
    if (wasActionHandled) { 
        metricsCollector.recordResponseTime('action_response', Date.now() - startTime, true);
        return; 
    }

    // Step 2: Perform the full AI analysis, including entity resolution.
    const analysis = await performAiAnalysis(userId, memberInfo.role, message, circleId);
    
    // Step 3: Handle the core logic for sharing, advice, and escalations.
    const sharingResult = await handleSharingAndEscalation(userId, memberInfo.role, message, circleId, analysis);
    
    // Step 4: Process facts and check for conflicts.
    await handleFactProcessing(userId, circleId, analysis);
    
    // Training log (fire-and-forget, non-blocking) - happens after main flow completes
    const latencyMs = Date.now() - startTime;
    trainingLogger.logInteraction({
        conversationId: `${circleId}_${userId}_${Date.now()}`,
        userId,
        message,
        agentResponse: analysis?.agent_response || '',
        orchestratorAction: sharingResult?.action || { type: 'NONE' },
        stateVector: analysis?.state_vector,
        promptVersion: 'unified_v1.0',
        latencyMs
    }).catch(err => {}); // Silently fail
    
    metricsCollector.recordResponseTime('full_analysis', latencyMs, true);
    metricsCollector.recordMessageLength(userId, message.length, analysis?.agent_response?.length || 0);
}

