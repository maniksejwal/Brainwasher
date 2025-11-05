/**
 * @fileoverview Handles future planning from AI analysis
 * Processes future_plan objects from agent responses and schedules tasks/messages
 */

import { 
    createFuturePlan, 
    createScheduledMessage,
    getPendingFuturePlans,
    getPendingScheduledMessages
} from '../../db/queries_future_plans.js';
import { events } from '../../orchestrator.js';

/**
 * Process future planning from AI analysis
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {object} analysis - AI analysis object with future_plan
 * @param {number} currentTurn - Current conversation turn number
 */
export async function handleFuturePlanning(userId, circleId, analysis, currentTurn) {
    if (!analysis.future_plan) {
        return; // No future planning
    }

    const futurePlan = analysis.future_plan;

    // Process tasks
    if (futurePlan.tasks && Array.isArray(futurePlan.tasks)) {
        for (const task of futurePlan.tasks) {
            // Extract trigger information
            const triggerType = task.trigger_type || (task.scheduled_turn !== undefined && task.scheduled_turn !== null ? 'turn' : null);
            const triggerValue = task.trigger_value || null;
            const triggerDetails = task.trigger_details || null;
            const scheduledTurn = triggerType === 'turn' ? (task.scheduled_turn || currentTurn + 1) : null;
            
            await createFuturePlan(
                circleId,
                userId,
                task.type || 'general',
                task.task,
                scheduledTurn,
                {
                    planned_action: task.planned_action || null,
                    priority: task.priority || 'medium'
                },
                triggerType,
                triggerValue,
                triggerDetails
            );
        }
    }

    // Process scheduled messages
    if (futurePlan.scheduled_messages && Array.isArray(futurePlan.scheduled_messages)) {
        for (const scheduledMsg of futurePlan.scheduled_messages) {
            // Extract trigger information
            const triggerType = scheduledMsg.trigger_type || (scheduledMsg.scheduled_turn !== undefined && scheduledMsg.scheduled_turn !== null ? 'turn' : null);
            const triggerValue = scheduledMsg.trigger_value || null;
            const triggerDetails = scheduledMsg.trigger_details || null;
            const scheduledTurn = triggerType === 'turn' ? (scheduledMsg.scheduled_turn || currentTurn + 1) : null;
            
            // Legacy support for trigger_condition field
            const legacyTriggerCondition = scheduledMsg.trigger_condition || null;
            
            await createScheduledMessage(
                circleId,
                userId,
                scheduledMsg.message,
                scheduledTurn,
                scheduledMsg.target_user || null,
                triggerType,
                triggerValue,
                triggerDetails,
                legacyTriggerCondition
            );
        }
    }

    // Anticipated responses are logged for agent reference but not stored in DB
    // They're part of the agent's internal planning strategy
}

/**
 * Process pending future plans and scheduled messages for current turn
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {number} currentTurn - Current conversation turn
 * @param {object} conversationContext - Context from current conversation (analysis, user message, etc.)
 */
export async function processPendingFutureItems(userId, circleId, currentTurn, conversationContext = null) {
    const currentTimestamp = Date.now();
    
    // Get pending future plans due now (handles turn, date, duration triggers)
    const pendingPlans = await getPendingFuturePlans(userId, circleId, currentTurn, currentTimestamp);
    
    // Get pending scheduled messages due now (handles turn, date, duration triggers)
    const pendingMessages = await getPendingScheduledMessages(userId, circleId, currentTurn, currentTimestamp);
    
    // Check conversation progress triggers if context is provided
    if (conversationContext) {
        const progressTriggers = await checkConversationProgressTriggers(userId, circleId, conversationContext);
        pendingPlans.push(...progressTriggers.plans);
        pendingMessages.push(...progressTriggers.messages);
    }
    
    // TODO: Check for location, event, interaction, and condition triggers
    // These require additional context (user location, recent events, interaction history, system state)
    // For now, these are stored but not automatically triggered
    
    // Return both for orchestrator to handle
    return {
        plans: pendingPlans,
        messages: pendingMessages
    };
}

/**
 * Check conversation progress triggers (when user agrees, discloses, hides, etc.)
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {object} context - Conversation context (analysis, user message, consent granted, etc.)
 */
async function checkConversationProgressTriggers(userId, circleId, context) {
    const { getPendingFuturePlans, getPendingScheduledMessages, executeFuturePlan, markScheduledMessageSent } = await import('../../db/queries_future_plans.js');
    const db = await import('../../db/connection.js');
    const dbConn = await db.getDb();
    
    const triggeredPlans = [];
    const triggeredMessages = [];
    
    // Get all plans with conversation_progress triggers
    const progressPlans = await dbConn.all(`
        SELECT * FROM future_plans 
        WHERE user_id = ? AND circle_id = ? AND status = 'pending' AND trigger_type = 'conversation_progress'
    `, [userId, circleId]);
    
    const progressMessages = await dbConn.all(`
        SELECT * FROM scheduled_messages 
        WHERE user_id = ? AND circle_id = ? AND status = 'pending' AND trigger_type = 'conversation_progress'
    `, [userId, circleId]);
    
    // Check each plan/message trigger value against conversation context
    for (const plan of progressPlans) {
        const triggerValue = plan.trigger_value?.toLowerCase() || '';
        const shouldTrigger = checkTriggerCondition(triggerValue, context);
        
        if (shouldTrigger) {
            triggeredPlans.push({
                ...plan,
                details: plan.details ? JSON.parse(plan.details) : null,
                triggerDetails: plan.trigger_details ? JSON.parse(plan.trigger_details) : null
            });
        }
    }
    
    for (const msg of progressMessages) {
        const triggerValue = msg.trigger_value?.toLowerCase() || '';
        const shouldTrigger = checkTriggerCondition(triggerValue, context);
        
        if (shouldTrigger) {
            triggeredMessages.push({
                ...msg,
                triggerDetails: msg.trigger_details ? JSON.parse(msg.trigger_details) : null
            });
        }
    }
    
    return { plans: triggeredPlans, messages: triggeredMessages };
}

/**
 * Check if a trigger condition matches the conversation context
 * @param {string} triggerValue - Trigger condition (e.g., "when user agrees to see doctor")
 * @param {object} context - Conversation context
 */
function checkTriggerCondition(triggerValue, context) {
    if (!triggerValue || !context) return false;
    
    const analysis = context.analysis || {};
    const userMessage = (context.userMessage || '').toLowerCase();
    const consentGranted = context.consentGranted || false;
    const intent = analysis.intent || '';
    const facts = analysis.facts || {};
    const criticality = analysis.criticality || '';
    
    // Check common trigger patterns
    if (triggerValue.includes('when user agrees')) {
        // Check if user agreed to something (yes, ok, sure, etc.)
        const agreementWords = ['yes', 'ok', 'sure', 'agree', 'alright', 'fine', 'go ahead'];
        return agreementWords.some(word => userMessage.includes(word));
    }
    
    if (triggerValue.includes('when user discloses')) {
        // Check if user disclosed something (has facts, symptom reports, etc.)
        const symptomKeywords = triggerValue.match(/discloses?\s+(\w+)/);
        if (symptomKeywords) {
            const symptom = symptomKeywords[1].toLowerCase();
            // Check if facts contain the symptom or user message mentions it
            return Object.keys(facts).some(key => key.toLowerCase().includes(symptom)) ||
                   userMessage.includes(symptom);
        }
        // Generic disclosure: user reported facts or symptoms
        return Object.keys(facts).length > 0 || criticality !== 'NONE';
    }
    
    if (triggerValue.includes('when user hides')) {
        // Check if user is hiding information (denial, vague responses, etc.)
        const hidingKeywords = triggerValue.match(/hides?\s+(\w+)/);
        if (hidingKeywords) {
            const topic = hidingKeywords[1].toLowerCase();
            // Check if user message is vague or denies the topic
            const denialWords = ['no', 'not', 'never', "don't", "didn't"];
            return denialWords.some(word => userMessage.includes(word)) && 
                   (userMessage.includes(topic) || Object.keys(facts).some(key => key.toLowerCase().includes(topic)));
        }
        // Generic hiding: user denies or gives vague responses
        return userMessage.includes('no') || userMessage.includes("don't") || userMessage.length < 20;
    }
    
    if (triggerValue.includes('when consent granted')) {
        return consentGranted === true;
    }
    
    if (triggerValue.includes('when user mentions')) {
        const topic = triggerValue.match(/mentions?\s+(\w+)/);
        if (topic) {
            const keyword = topic[1].toLowerCase();
            return userMessage.includes(keyword) || 
                   Object.keys(facts).some(key => key.toLowerCase().includes(keyword));
        }
    }
    
    return false;
}

/**
 * Execute a future plan (called when turn arrives)
 * @param {object} plan - Future plan object from database
 */
export async function executePlan(plan) {
    const { executeFuturePlan } = await import('../../db/queries_future_plans.js');
    
    // Mark as executed
    await executeFuturePlan(plan.plan_id, {
        executed_at_turn: plan.scheduled_turn,
        description: plan.description
    });
    
    // Emit event for orchestrator to handle plan execution
    events.emit('future_plan_executed', {
        planId: plan.plan_id,
        circleId: plan.circle_id,
        userId: plan.user_id,
        planType: plan.plan_type,
        description: plan.description,
        details: plan.details
    });
}

/**
 * Send a scheduled message (called when turn arrives)
 * @param {object} scheduledMessage - Scheduled message object from database
 */
export async function sendScheduledMessage(scheduledMessage) {
    const { markScheduledMessageSent } = await import('../../db/queries_future_plans.js');
    
    // Mark as sent
    await markScheduledMessageSent(scheduledMessage.scheduled_message_id);
    
    // Emit broadcast event
    events.emit('broadcast', {
        targetUsers: scheduledMessage.target_user_id ? [scheduledMessage.target_user_id] : [],
        message: scheduledMessage.message_text,
        from: 'agent',
        circleId: scheduledMessage.circle_id,
        source: 'scheduled_message',
        scheduledMessageId: scheduledMessage.scheduled_message_id
    });
}

