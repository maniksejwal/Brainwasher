/**
 * @fileoverview State Tracker Handler
 * Tracks behavioral state changes (stages of change, coping styles)
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';

/**
 * Process state tracking
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context
 * @returns {Promise<object>} State update or null
 */
export async function processStateTracking(userId, role, message, circleId, context) {
    // Get current state from context
    const currentState = context.currentState || {};
    const currentStateStr = JSON.stringify(currentState, null, 2) || 'No current state';
    
    // Format conversation history
    const conversationHistory = (context.history || []).slice(-10).map(h => 
        `${h.user_id}: ${h.message}`
    ).join('\n') || 'No recent history';
    
    const prompt = loadPrompt('state_tracker', {
        MESSAGE: message,
        CURRENT_STATE: currentStateStr,
        CONVERSATION_HISTORY: conversationHistory
    });
    
    try {
        const result = await makeApiCall(prompt, [], true);
        const analysis = parseCompanionResponse(result, 'StateTracker');
        
        if (!analysis) {
            return { state_update: null };
        }
        
        return {
            state_update: analysis.state_update || null
        };
    } catch (error) {
        console.error('[StateTracker] Error:', error.message);
        return { state_update: null };
    }
}

