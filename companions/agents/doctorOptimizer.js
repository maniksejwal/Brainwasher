/**
 * @fileoverview Doctor Optimizer Handler
 * Optimizes responses specifically for doctors
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';

/**
 * Process doctor optimization
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context
 * @returns {Promise<object>} Optimized doctor response
 */
export async function processDoctorOptimization(userId, role, message, circleId, context) {
    if (role !== 'doctor') {
        return { reply: null };
    }
    
    // Format conversation history
    const conversationHistory = (context.history || []).slice(-5).map(h => 
        `${h.user_id}: ${h.message}`
    ).join('\n') || 'No recent history';
    
    const prompt = loadPrompt('doctor_optimizer', {
        MESSAGE: message,
        CLINICAL_ASSESSMENT: context.clinicalAssessment?.assessment || 'No immediate concerns',
        CRITICALITY: context.clinicalAssessment?.criticality || 'NONE',
        CONVERSATION_HISTORY: conversationHistory
    });

    try {
        const result = await makeApiCall(prompt, [], true);
        const analysis = parseCompanionResponse(result);
        
        if (!analysis) {
            throw new Error('Failed to parse JSON response');
        }
        
        return {
            reply: analysis.reply || null
        };
    } catch (error) {
        console.error('[DoctorOptimizer] Error:', error.message);
        return { reply: null };
    }
}

