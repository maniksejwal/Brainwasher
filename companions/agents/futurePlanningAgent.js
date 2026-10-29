/**
 * @fileoverview Future Planning Agent
 * Generates future plans for multi-turn conversation strategy
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';

/**
 * Generate future planning strategy
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context (with history, currentState, etc.)
 * @param {number} currentTurn - Current conversation turn number
 * @returns {Promise<object|null>} Future plan object or null
 */
export async function generateFuturePlan(userId, role, message, circleId, context, currentTurn = 1) {
    // Don't plan if conversation is ending or too late in conversation
    if (currentTurn >= 15) {
        return null;
    }
    
    const history = context.history || [];
    // Ensure historyText is a string
    let historyText = context.historyText;
    if (!historyText || typeof historyText !== 'string') {
        historyText = history.map(h => {
            const userId = h.user_id || h.userId || 'unknown';
            const msg = h.message || h.content || '';
            return `${userId}: ${msg}`;
        }).join('\n');
    }
    const intent = context.inputUnderstanding?.intent || 'ASKING_QUESTION';
    const criticality = context.clinicalAssessment?.criticality || 'NONE';
    const facts = context.inputUnderstanding?.facts || {};
    
    // Determine if future planning is needed
    const needsFuturePlanning = 
        intent === 'REPORTING_FACT' && Object.keys(facts).length > 0 ||
        intent === 'ASKING_QUESTION' ||
        criticality === 'HIGH' || criticality === 'MEDIUM' ||
        context.hasMedicalContent ||
        /medication|appointment|follow|check|remind/i.test(message);
    
    if (!needsFuturePlanning) {
        return null;
    }
    
    // Ensure historyText is a string before substring
    const historyTextSafe = typeof historyText === 'string' ? historyText : '';
    
    const prompt = loadPrompt('future_planning', {
        CURRENT_TURN: currentTurn.toString(),
        INTENT: intent,
        CRITICALITY: criticality,
        FACTS: JSON.stringify(facts),
        HISTORY_TEXT: historyTextSafe.substring(0, 500),
        MESSAGE: message
    });

    try {
        const result = await makeApiCall(prompt, [], true);
        const analysis = parseCompanionResponse(result, 'FuturePlanning');
        
        if (!analysis || !analysis.future_plan) {
            return null;
        }
        
        // Validate and clean future_plan structure
        const futurePlan = analysis.future_plan;
        
        // Ensure tasks have required fields
        if (futurePlan.tasks && Array.isArray(futurePlan.tasks)) {
            futurePlan.tasks = futurePlan.tasks.map(task => ({
                ...task,
                scheduled_turn: task.scheduled_turn || (task.trigger_type === 'turn' ? currentTurn + 2 : null),
                trigger_type: task.trigger_type || (task.scheduled_turn ? 'turn' : null),
                type: task.type || 'general'
            })).filter(task => task.task && task.task.trim());
        }
        
        // Ensure scheduled_messages have required fields
        if (futurePlan.scheduled_messages && Array.isArray(futurePlan.scheduled_messages)) {
            futurePlan.scheduled_messages = futurePlan.scheduled_messages.map(msg => ({
                ...msg,
                scheduled_turn: msg.scheduled_turn || (msg.trigger_type === 'turn' ? currentTurn + 2 : null),
                trigger_type: msg.trigger_type || (msg.scheduled_turn ? 'turn' : null),
                target_user: msg.target_user || role
            })).filter(msg => msg.message && msg.message.trim());
        }
        
        // Only return if there are actual plans
        if ((!futurePlan.tasks || futurePlan.tasks.length === 0) && 
            (!futurePlan.scheduled_messages || futurePlan.scheduled_messages.length === 0)) {
            return null;
        }
        
        return futurePlan;
    } catch (error) {
        console.error('[FuturePlanningAgent] Error:', error.message);
        return null;
    }
}

