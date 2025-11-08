/**
 * @fileoverview Handles rescheduling future plans when conversation context changes
 * Reschedules plans when: commands are run (/clear, /consent), conversation doesn't make sense, user backtracks
 */

import { 
    getPendingFuturePlans, 
    getPendingScheduledMessages,
    rescheduleFuturePlan,
    rescheduleScheduledMessage,
    cancelFuturePlan,
    cancelScheduledMessage
} from '../../db/queries_future_plans.js';
import { getRecentMessages } from '../../db/index.js';

/**
 * Check if future plans should be rescheduled
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {object} analysis - AI analysis
 * @param {string} message - User message
 * @returns {object} { shouldReschedule: boolean, reason: string }
 */
export async function checkIfShouldReschedule(userId, circleId, analysis, message) {
    const lowerMessage = message.toLowerCase().trim();
    
    // Check for commands that invalidate future plans
    if (lowerMessage.startsWith('/clear')) {
        return { shouldReschedule: true, reason: 'clear_command' };
    }
    
    if (lowerMessage.startsWith('/consent')) {
        return { shouldReschedule: true, reason: 'consent_changed' };
    }
    
    // Check if conversation doesn't make sense (user backtracking, topic shift)
    // If user denies something they previously agreed to, or changes topic dramatically
    const backtrackIndicators = [
        'never mind', 'forget it', 'i changed my mind', "don't", "didn't", 'no actually',
        'wait', 'hold on', 'cancel that', 'ignore', 'forget'
    ];
    
    const hasBacktrack = backtrackIndicators.some(indicator => lowerMessage.includes(indicator));
    if (hasBacktrack && analysis.intent === 'REPORTING_FACT') {
        return { shouldReschedule: true, reason: 'user_backtracked' };
    }
    
    // Check for topic shifts that might invalidate future plans
    // This is detected if the agent's previous plan was about topic X, but user is now talking about topic Y
    // (This would require conversation history analysis - simplified for now)
    
    return { shouldReschedule: false, reason: null };
}

/**
 * Reschedule affected future plans based on reason
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {string} reason - Reason for rescheduling
 */
export async function rescheduleAffectedPlans(userId, circleId, reason) {
    // Get all pending plans
    const pendingPlans = await getPendingFuturePlans(userId, circleId, null, null);
    const pendingMessages = await getPendingScheduledMessages(userId, circleId, null, null);
    
    switch (reason) {
        case 'clear_command':
            // Cancel all pending plans when /clear is run
            for (const plan of pendingPlans) {
                await cancelFuturePlan(plan.plan_id);
            }
            for (const msg of pendingMessages) {
                await cancelScheduledMessage(msg.scheduled_message_id);
            }
            console.log(`[RescheduleHandler] Cancelled ${pendingPlans.length} plans and ${pendingMessages.length} messages due to /clear`);
            break;
            
        case 'consent_changed':
            // Reschedule plans that depend on consent (e.g., plans to share information)
            // For now, defer plans by 2 turns to allow consent to stabilize
            const history = await getRecentMessages(circleId, 100);
            const currentTurn = history.filter(m => m.user_id === userId).length;
            
            for (const plan of pendingPlans) {
                if (plan.details && typeof plan.details === 'object' && plan.details.requiresConsent) {
                    // Reschedule consent-dependent plans
                    if (plan.trigger_type === 'turn') {
                        await rescheduleFuturePlan(plan.plan_id, currentTurn + 2, null, null);
                    }
                }
            }
            break;
            
        case 'user_backtracked':
            // Defer plans by 1 turn when user backtracks
            const history2 = await getRecentMessages(circleId, 100);
            const currentTurn2 = history2.filter(m => m.user_id === userId).length;
            
            for (const plan of pendingPlans) {
                if (plan.trigger_type === 'turn' && plan.scheduled_turn <= currentTurn2 + 2) {
                    // Only reschedule near-term plans (within 2 turns)
                    await rescheduleFuturePlan(plan.plan_id, currentTurn2 + 3, null, null);
                }
            }
            for (const msg of pendingMessages) {
                if (msg.trigger_type === 'turn' && msg.scheduled_turn <= currentTurn2 + 2) {
                    await rescheduleScheduledMessage(msg.scheduled_message_id, currentTurn2 + 3, null, null);
                }
            }
            console.log(`[RescheduleHandler] Rescheduled near-term plans due to user backtracking`);
            break;
    }
}

