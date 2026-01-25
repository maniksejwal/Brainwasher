/**
 * @fileoverview handlers/messageHandler.js
 * The main dispatcher for handling all regular user messages (non-commands).
 * This module follows a clear "chain of thought" to process incoming messages.
 */

import { getMemberInfo, findUserById, findCircleByPatientId, findCircleById, getCircleMembers, addMessage, getRecentMessages, updateUserState, addPendingAction } from '../db/index.js';
import { performAiAnalysis } from './message_logic/aiAnalysisHandler.js';
import { handleFactProcessing } from './message_logic/conflictHandler.js';
import { handleSharingAndEscalation } from './message_logic/sharing/index.js';
import { handlePendingActionResponse } from './message_logic/actionResponseHandler.js';
import { initializeTopicShiftHandler } from './message_logic/topicShiftHandler.js';
import { handleFuturePlanning } from './message_logic/futurePlanningHandler.js';
import { checkIfShouldReschedule, rescheduleAffectedPlans } from './message_logic/rescheduleHandler.js';
import { events } from '../orchestrator.js';
import { logger as trainingLogger, metrics as metricsCollector } from '../training/index.js';
import { handleDoctorMessage } from './message_logic/doctorMessageHandler.js';
import { handleNonDoctorQuestion } from './message_logic/nonDoctorQuestionHandler.js';
import { broadcastErrorReply, formatAnalysisErrorMessage } from './utils/errorHandling.js';
import { getAgentName } from './utils/agentIdentity.js';

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

    // A doctor's message requires targeted delivery that respects privacy.
    if (memberInfo.role === 'doctor') {
        const result = await handleDoctorMessage(userId, circleId, message, memberInfo);
        // Training log (fire-and-forget, non-blocking)
        metricsCollector.recordMessageLength(userId, message.length, message.length);
        return result;
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

    // Step 1.5: Check if this is a question directed at another member (for non-doctors)
    if (memberInfo.role !== 'doctor') {
        const questionResult = await handleNonDoctorQuestion(userId, circleId, message, memberInfo.role);
        if (questionResult) {
            return questionResult;
        }
    }

    // Step 2: Perform the full AI analysis, including entity resolution.
    // This will use Companion system or unified agent based on config
    let analysis;
    try {
        analysis = await performAiAnalysis(userId, memberInfo.role, message, circleId);
    } catch (error) {
        const errorReply = formatAnalysisErrorMessage(error);
        await broadcastErrorReply(userId, circleId, errorReply);
        console.error(`[MessageHandler] AI analysis failed for user ${userId} in circle ${circleId}:`, error);
        return {
            reply: errorReply,
            intent: 'ERROR',
            criticality: 'NONE',
            privacyLevel: 'PRIVATE',
            facts: {},
            system_used: 'error'
        };
    }

    if (!analysis) {
        console.error(`[MessageHandler] Critical Error: performAiAnalysis returned null/undefined for ${userId} in ${circleId}`);
        const errorReply = "I encountered an internal error while analyzing your message.";
        await broadcastErrorReply(userId, circleId, errorReply);
        return {
            reply: errorReply,
            intent: 'ERROR',
            criticality: 'NONE',
            privacyLevel: 'PRIVATE',
            facts: {},
            system_used: 'error'
        };
    }
    if (process.env.DEBUG_CLI) {
        console.log('[MessageHandler] Analysis summary:', {
            system_used: analysis?.system_used,
            intent: analysis?.intent,
            hasReply: Boolean(analysis?.reply),
            replyPreview: analysis?.reply ? analysis.reply.slice(0, 80) : null,
            hasSharingSuggestion: Boolean(analysis?.sharingSuggestion),
            sharingSuggestion: analysis?.sharingSuggestion || null
        });
    }

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

    // Ensure the originating user receives the conversational reply.
    if (analysis?.reply) {
        const circle = await findCircleById(circleId);
        const patient = circle ? await findUserById(circle.primary_patient_id) : null;
        const agentName = await getAgentName(userId, circleId);
        events.emit('broadcast', {
            targetUsers: [userId],
            reply: analysis.reply,
            from: agentName,
            circleId,
            patientUsername: patient?.username ?? userId
        });
    } else {
        if (process.env.DEBUG_CLI) {
            console.warn('[MessageHandler] Analysis produced no reply text; user may not receive feedback.');
        }
    }

    // Training log (fire-and-forget, non-blocking) - happens after main flow completes
    const latencyMs = Date.now() - startTime;

    // Training log: Capture full agentic state (Intent, Plans, Actions)
    // We log everything, including errors, to have a complete dataset.

    // Detect implicit rewards (Gratitude/Positive Sentiment) early for RL
    let outcomeLabel = null;
    if (analysis?.intent === 'GRATITUDE' || analysis?.sentiment === 'POSITIVE' || message.match(/\b(thanks|thank you|helpful|good job)\b/i)) {
        outcomeLabel = 'positive';
        trainingLogger.logReward({
            conversationId: `${circleId}_${userId}`,
            actionId: 'previous_turn',
            rewardType: 'user_feedback',
            rewardValue: 1.0,
            context: { trigger: 'implicit_gratitude', message: message }
        }).catch(err => console.error('[MessageHandler] Failed to log valid reward:', err));
    }

    // Poison Filtering: Determine if we should log this interaction for training vs debugging
    let filterReason = null;
    const POISON_PATTERNS = [
        /i am an ai/i,
        /as an ai language model/i,
        /cannot (fulfill|comply|assist)/i,
        /openai/i,
        /google/i
    ];


    // 5. Implicit Rewards & Penalties
    // Positive: Gratitude
    if (analysis && analysis.intent === 'GRATITUDE') {
        outcomeLabel = 'positive';
    }
    // Negative: Irritability / Anger (LLM-based)
    else if (analysis && (analysis.incident === 'anger' || analysis.incident === 'frustration' || analysis.sentiment === 'negative')) {
        outcomeLabel = 'negative';
    }

    // Negative: Profanity (Regex-based)
    const profanityRegex = /\b(damn|hell|stupid|idiot|useless|crap|shit|fuck)\b/i;
    if (profanityRegex.test(message)) {
        outcomeLabel = 'negative';
    }

    // 6. Logging
    // Determine filter reason (Poison Filter)
    filterReason = null; // Reset or update existing variable
    if (analysis && analysis.intent === 'ERROR') {
        filterReason = 'system_error';
    } else if (analysis && analysis.reply && (
        analysis.reply.includes("I am an AI") ||
        analysis.reply.includes("I cannot") ||
        analysis.reply.includes("OpenAI") ||
        analysis.reply.includes("Anthropic")
    )) {
        filterReason = 'ai_refusal';
    }

    // Construct conversation ID for logging (consistent with reward logging)
    const logConversationId = `${circleId}_${userId}`;
    const logOrchestratorDetails = sharingResult || { action: 'NONE' };

    trainingLogger.logInteraction(
        logConversationId,
        userId,
        message,
        analysis ? analysis.reply : "Error generating response",
        {
            type: logOrchestratorDetails.action || 'NONE',
            ...logOrchestratorDetails.details
        },
        // Log additional metadata
        {
            prompt_version: process.env.CURRENT_PROMPT_VERSION || 'initial',
            latency_ms: Date.now() - startTime,
            message_length: message.length,
            response_length: analysis && analysis.reply ? analysis.reply.length : 0,
            escalated: Boolean(sharingResult?.escalated),
            shared: Boolean(sharingResult?.shared),
            reasoning: analysis ? analysis.reasoning : null, // Chain of Thought
            outcome_label: outcomeLabel, // Implicit Reward/Penalty
            filter_reason: filterReason // Data Quality Filter
        }
    ).catch(err => console.error('[MessageHandler] Log interaction failed:', err));

    metricsCollector.recordResponseTime('full_analysis', latencyMs, true);
    metricsCollector.recordMessageLength(userId, message.length, analysis?.agent_response?.length || 0);

    // Return the analysis for simulations to use
    return analysis;
}



