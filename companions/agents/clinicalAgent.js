/**
 * @fileoverview Clinical Agent Handler
 * Medical assessment and symptom evaluation
 */

import { normalizeCriticality } from '../../utils/criticality.js';
import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';

/**
 * Process clinical analysis
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context
 * @returns {Promise<object>} Clinical assessment
 */
export async function processClinicalAnalysis(userId, role, message, circleId, context) {
    // CRITICAL SAFETY RULE: Simple "pain" is almost always LOW, not HIGH
    const messageLower = message.toLowerCase();
    const isSimplePain = /^\s*(i\s+)?(have|feel|got)\s+(a\s+)?(little|bit\s+of\s+|some\s+)?(pain|ache|sore)\s*(\.|$)/i.test(message);
    const hasSevereIndicators = /chest|severe|extreme|unbearable|dizzy|weak|shortness\s+of\s+breath|fainting/i.test(message);
    const isFallForElderly = /fall|fell/i.test(message) && (context.userAge > 65 || role === 'patient');
    
    // Detect user's analogy preference from conversation history
    const conversationHistory = (context.history || []).slice(-10);
    const userMessages = conversationHistory.filter(h => h.user_id === userId).map(h => h.message || '').join(' ').toLowerCase();
    const analogyIndicators = [
        /\b(like|similar to|as if|as though|reminds me of|kind of like|sort of like|analogy|metaphor)\b/i,
        /\b(like what|what's it like|how is it like|can you explain like)\b/i,
        /\b(example|for instance|imagine|picture this)\b/i
    ];
    const usesAnalogies = analogyIndicators.some(pattern => pattern.test(userMessages));
    const analogyPreference = usesAnalogies ? 'prefers_analogies' : 'prefers_direct_explanations';
    
    // Format conversation history for context
    const conversationHistoryText = conversationHistory.slice(-5).map(h => 
        `${h.user_id}: ${h.message || ''}`
    ).join('\n') || 'No recent history';
    
    const prompt = loadPrompt('clinical', {
        MESSAGE: message,
        ROLE: role,
        USER_AGE: context.userAge || 'unknown',
        HAS_SEVERE_INDICATORS: hasSevereIndicators ? 'yes' : 'no',
        IS_SIMPLE_PAIN: isSimplePain ? 'yes' : 'no',
        IS_FALL_FOR_ELDERLY: isFallForElderly ? 'yes' : 'no',
        ANALOGY_PREFERENCE: analogyPreference,
        CONVERSATION_HISTORY: conversationHistoryText
    });

    try {
        const result = await makeApiCall(prompt, [], true);
        const analysis = parseCompanionResponse(result);
        
        if (!analysis) {
            throw new Error('Failed to parse JSON response');
        }
        
        let criticality = normalizeCriticality(analysis.criticality);
        
        // Apply critical safety rule: downgrade simple pain
        if (isSimplePain && !hasSevereIndicators && criticality === 'HIGH') {
            criticality = 'LOW';
        }
        
        // Upgrade falls for elderly
        if (isFallForElderly && criticality === 'LOW') {
            criticality = 'MEDIUM';
        }
        
        return {
            assessment: analysis.assessment || 'No immediate medical concerns',
            criticality: criticality,
            hasMisconception: analysis.has_misconception || false,
            misconceptionType: analysis.misconception_type || 'none',
            educationalApproach: analysis.educational_approach || null,
            escalateMisconception: analysis.escalate_misconception || false
        };
    } catch (error) {
        console.error('[ClinicalAgent] Error:', error.message);
        return {
            assessment: 'Unable to assess',
            criticality: 'LOW'
        };
    }
}

