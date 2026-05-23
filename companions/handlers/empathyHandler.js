/**
 * @fileoverview Empathy Handler
 * Decides between empathy and pragmatism based on user communication style
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';
import { findCircleById } from '../../db/index.js';

/**
 * Process empathy decision with context-aware prompts
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {string} circleId - Circle ID
 * @param {object} context - Conversation context
 * @returns {Promise<object>} Empathy decision and response
 */
export async function processEmpathyDecision(userId, role, message, circleId, context) {
    // Determine appropriate prompt based on circle type
    let promptType = 'empathy';
    try {
        const circle = await findCircleById(circleId);
        if (circle?.circle_type === 'professional') {
            promptType = 'business_empathy';
        }
    } catch (error) {
        console.warn('[EmpathyHandler] Could not determine circle type, using default prompt');
    }
    
    const prompt = loadPrompt(promptType, {
        MESSAGE: message,
        ROLE: role,
        CRITICALITY: context.clinicalAssessment?.criticality || context.businessAssessment?.criticality || 'NONE'
    });

    try {
        const result = await makeApiCall(prompt, [], true);
        
        // Debug: log what we received
        if (process.env.DEBUG_COMPANION) {
            console.log('[EmpathyHandler] Raw result:', JSON.stringify(result, null, 2));
        }
        
        const analysis = parseCompanionResponse(result);
        
        if (!analysis) {
            // If parsing failed, check if result is a fallback response
            if (result && result.reply && typeof result.reply === 'string') {
                // This is a fallback - the API returned plain text
                console.warn('[EmpathyHandler] Received plain text response, using fallback');
                // Extract the text and provide a default structure
                return {
                    level: 'MEDIUM', // Default to medium when we can't determine
                    reply: result.reply.length > 200 ? null : result.reply // Use reply if it's short enough
                };
            }
            throw new Error('Failed to parse JSON response');
        }
        
        return {
            level: analysis.level || 'MEDIUM',
            reply: analysis.reply || null
        };
    } catch (error) {
        console.error('[EmpathyHandler] Error:', error.message);
        return {
            level: 'MEDIUM',
            reply: null
        };
    }
}

