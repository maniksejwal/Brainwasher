/**
 * @fileoverview Patient Optimizer Handler
 * Optimizes responses specifically for patients
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';

/**
 * Process patient optimization
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context
 * @returns {Promise<object>} Optimized patient response
 */
export async function processPatientOptimization(userId, role, message, circleId, context) {
    if (role !== 'patient') {
        return { reply: null };
    }
    
    // Get repetition detection from history analyzer
    const historyAnalysis = context.historyAnalyzer || {};
    const repetitionDetected = historyAnalysis.isRepetitive ? 'yes' : 'no';
    const topicShift = historyAnalysis.topicShift ? 'yes' : 'no';
    
    // Format conversation history
    const conversationHistory = (context.history || []).slice(-5).map(h => 
        `${h.user_id}: ${h.message}`
    ).join('\n') || 'No recent history';
    
    const prompt = loadPrompt('patient_optimizer', {
        MESSAGE: message,
        EMPATHY_LEVEL: context.empathyHandler?.level || context.empathyLevel || 'MEDIUM',
        CLINICAL_ASSESSMENT: context.clinicalAssessment?.assessment || 'No immediate concerns',
        CRITICALITY: context.clinicalAssessment?.criticality || 'NONE',
        REPETITION_DETECTED: repetitionDetected,
        TOPIC_SHIFT: topicShift,
        CONVERSATION_HISTORY: conversationHistory
    });

    try {
        const result = await makeApiCall(prompt, [], true);
        
        // Debug: log what we received
        if (process.env.DEBUG_COMPANION) {
            console.log('[PatientOptimizer] Raw result:', JSON.stringify(result, null, 2));
        }
        
        const analysis = parseCompanionResponse(result);
        
        if (!analysis) {
            // If parsing failed, check if result is a fallback response
            if (result && result.reply && typeof result.reply === 'string') {
                // This is a fallback - the API returned plain text
                console.warn('[PatientOptimizer] Received plain text response, using as reply');
                // Use the fallback reply directly
                return {
                    reply: result.reply
                };
            }
            throw new Error('Failed to parse JSON response');
        }
        
        return {
            reply: analysis.reply || null
        };
    } catch (error) {
        console.error('[PatientOptimizer] Error:', error.message);
        return { reply: null };
    }
}

