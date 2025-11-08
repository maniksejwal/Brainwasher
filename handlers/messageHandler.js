/**
 * @fileoverview handlers/messageHandler.js
 * The main dispatcher for handling all regular user messages (non-commands).
 * This module follows a clear "chain of thought" to process incoming messages.
 */

import { getMemberInfo, findUserById, findCircleByPatientId, findCircleById, getCircleMembers, addMessage, getRecentMessages, updateUserState } from '../db/index.js';
import { performAiAnalysis } from './message_logic/aiAnalysisHandler.js';
import { handleFactProcessing } from './message_logic/conflictHandler.js';
import { handleSharingAndEscalation } from './message_logic/sharing/index.js';
import { handlePendingActionResponse } from './message_logic/actionResponseHandler.js';
import { initializeTopicShiftHandler } from './message_logic/topicShiftHandler.js';
import { handleFuturePlanning } from './message_logic/futurePlanningHandler.js';
import { checkIfShouldReschedule, rescheduleAffectedPlans } from './message_logic/rescheduleHandler.js';
import { events } from '../orchestrator.js';
import { logger as trainingLogger, metrics as metricsCollector } from '../training/index.js';

// Lazy initialization of topic shift handler
let topicShiftHandler = null;

export async function handleMessage(userId, circleId, message) {
    // Lazy initialize topic shift handler to avoid circular dependency
    if (!topicShiftHandler) {
        topicShiftHandler = initializeTopicShiftHandler(events);
    }
    
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
        const circle = await findCircleById(circleId);
        if (!circle) {
            throw new Error(`Circle '${circleId}' not found when handling message for ${userId}`);
        }
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
        
        // Return a proper response object for doctor messages
        return {
            reply: `Doctor message broadcasted: "${message}"`,
            intent: 'DOCTOR_BROADCAST',
            criticality: 'NONE',
            privacyLevel: 'PRIVATE',
            facts: {}
        };
    }
    
    // For patients and caregivers, follow the full "chain of thought".
    
    // Step 1: Handle any pending user actions.
    const wasActionHandled = await handlePendingActionResponse(userId, circleId, message);
    if (wasActionHandled) { 
        metricsCollector.recordResponseTime('action_response', Date.now() - startTime, true);
        return {
            reply: "Action handled successfully",
            intent: 'ACTION_RESPONSE',
            criticality: 'NONE',
            privacyLevel: 'PRIVATE',
            facts: {}
        }; 
    }

    // Step 2: Perform the full AI analysis, including entity resolution.
    // This will use Companion system or unified agent based on config
    const analysis = await performAiAnalysis(userId, memberInfo.role, message, circleId);
    
    // Step 3: Process pending future plans and scheduled messages for current turn (PRODUCTION)
    // Get current turn from conversation history (used for both future planning and execution)
    const conversationHistory = await getRecentMessages(circleId, 100);
    const currentTurn = conversationHistory.filter(m => m.user_id === userId).length;
    
    // Prepare conversation context for progress triggers
    const conversationContext = {
        analysis,
        userMessage: message,
        consentGranted: false, // Will be set by sharing handler if consent is granted
        currentTurn
    };
    
    // Execute any due future plans and scheduled messages (including conversation progress triggers)
    const { processPendingFutureItems, executePlan, sendScheduledMessage } = await import('./message_logic/futurePlanningHandler.js');
    const pendingItems = await processPendingFutureItems(userId, circleId, currentTurn, conversationContext);
    
    // Execute due future plans
    for (const plan of pendingItems.plans) {
        await executePlan(plan);
    }
    
    // Send due scheduled messages
    for (const scheduledMsg of pendingItems.messages) {
        await sendScheduledMessage(scheduledMsg);
    }
    
    // Step 3.5: Handle future planning (if present in analysis) - creates NEW plans
    if (analysis.future_plan) {
        await handleFuturePlanning(userId, circleId, analysis, currentTurn);
    }
    
    // Step 4: Handle the core logic for sharing, advice, and escalations.
    const sharingResult = await handleSharingAndEscalation(userId, memberInfo.role, message, circleId, analysis);
    
    // Update conversation context with consent status if sharing was handled
    if (sharingResult?.consentGranted) {
        conversationContext.consentGranted = true;
    }
    
    // Step 4.5: Handle care circle probing questions (caregiver/patient cross-questioning)
    // This doesn't interfere with doctor commands - checks for active doctor delegations first
    const { handleCaregiverProbing, handlePatientProbingFromCaregiver } = await import('./message_logic/sharing/caregiverProbing.js');
    await handleCaregiverProbing(userId, memberInfo.role, message, circleId, analysis, currentTurn);
    await handlePatientProbingFromCaregiver(userId, memberInfo.role, message, circleId, analysis, currentTurn);
    
    // Step 4.6: Reschedule future plans if conversation doesn't make sense or commands were run
    // Check if conversation context changed significantly (e.g., /clear, topic shift, user backtracking)
    const shouldReschedule = await checkIfShouldReschedule(userId, circleId, analysis, message);
    if (shouldReschedule.shouldReschedule) {
        await rescheduleAffectedPlans(userId, circleId, shouldReschedule.reason);
    }
    
    // Step 5: Process facts and check for conflicts.
    await handleFactProcessing(userId, circleId, analysis);
    
    // Step 5.5: Update behavioral state if state_update is present
    if (analysis.state_update) {
        await updateUserState(userId, circleId, analysis.state_update);
    }
    
    // Training log (fire-and-forget, non-blocking) - happens after main flow completes
    const latencyMs = Date.now() - startTime;
    trainingLogger.logInteraction({
        conversationId: `${circleId}_${userId}_${Date.now()}`,
        userId,
        message,
        agentResponse: analysis?.reply || analysis?.agent_response || '',
        orchestratorAction: sharingResult?.action || { type: 'NONE' },
        stateVector: analysis?.state_vector,
        promptVersion: 'unified_v1.0',
        systemUsed: analysis?.system_used || 'unified', // Track Companion vs unified
        latencyMs
    }).catch(err => {}); // Silently fail
    
    metricsCollector.recordResponseTime('full_analysis', latencyMs, true);
    metricsCollector.recordMessageLength(userId, message.length, analysis?.agent_response?.length || 0);
    
    // Return the analysis for simulations to use
    return analysis;
}

