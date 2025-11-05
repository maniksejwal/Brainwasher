/**
 * @fileoverview Patient Optimizer Handler
 * Optimizes responses specifically for patients
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';
import { validateAndAdjustResponse, shouldUseBlankTurn, getBlankTurnResponse } from '../utils/responseStyleValidator.js';

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
    const conversationHistory = (context.history || []).slice(-5);
    const conversationHistoryText = conversationHistory.map(h => 
        `${h.user_id}: ${h.message}`
    ).join('\n') || 'No recent history';
    
    // Check if blank turn should be used
    if (shouldUseBlankTurn(message, historyAnalysis, conversationHistory)) {
        return { reply: getBlankTurnResponse() };
    }
    
    // Build repetition guidance and topic shift instructions
    let repetitionGuidance = '';
    let topicShiftGuidance = '';
    if (historyAnalysis.isRepetitive) {
        repetitionGuidance = 'CRITICAL: Repetition detected in conversation. You MUST change your approach. Provide fresh information, ask different questions, or introduce new angles. Do NOT repeat similar responses.';
        
        // TOPIC SHIFTING: When repetition is detected, suggest shifting to a related but different topic
        topicShiftGuidance = 'TOPIC SHIFT REQUIRED: The conversation has become repetitive. You MUST shift to a related but different topic. Examples:\n' +
            '- If discussing medication, shift to lifestyle habits or daily routines\n' +
            '- If discussing symptoms, shift to how they affect daily life or emotional well-being\n' +
            '- If discussing treatment, shift to support systems or family dynamics\n' +
            '- If discussing health concerns, shift to prevention or coping strategies\n' +
            'INTRODUCE THE TOPIC SHIFT NATURALLY: "Speaking of [current topic], I\'m curious about [new topic]..." or "Let\'s also talk about [new topic]..."';
    }
    
    const prompt = loadPrompt('patient_optimizer', {
        MESSAGE: message,
        EMPATHY_LEVEL: context.empathyHandler?.level || context.empathyLevel || 'MEDIUM',
        CLINICAL_ASSESSMENT: context.clinicalAssessment?.assessment || 'No immediate concerns',
        CRITICALITY: context.clinicalAssessment?.criticality || 'NONE',
        REPETITION_DETECTED: repetitionDetected,
        REPETITION_GUIDANCE: repetitionGuidance,
        TOPIC_SHIFT_GUIDANCE: topicShiftGuidance,
        TOPIC_SHIFT: topicShift,
        CONVERSATION_HISTORY: conversationHistoryText
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
        
        // Validate and adjust response style
        const validation = validateAndAdjustResponse(
            analysis.reply,
            message,
            historyAnalysis,
            conversationHistory,
            {
                allowBlankTurns: false, // Already checked above
                allowRepetition: false,
                allowYesNo: false,
                requireProbing: true
            }
        );
        
        // If response needs regeneration due to style issues, log it
        if (validation.needsRegeneration && process.env.DEBUG_COMPANION) {
            console.warn('[PatientOptimizer] Response style issues detected:', validation.adjustments);
        }
        
        return {
            reply: validation.response || analysis.reply || null
        };
    } catch (error) {
        console.error('[PatientOptimizer] Error:', error.message);
        return { reply: null };
    }
}

