/**
 * @fileoverview CompanionCoordinator
 * The coordinator that coordinates all Companion handlers, agents, and makes final decisions
 * Part of the Companion (coordinators + agents + handlers) that serves a user
 */

import { processCompanionHandlers } from './handlers/index.js';
import { aggregateResponses, resolveConflicts } from './utils/responseAggregator.js';

/**
 * Main coordinator that coordinates all Companion components
 * @param {string} userId - User ID
 * @param {string} role - User role (patient, caregiver, doctor)
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context (history, state, etc.)
 * @returns {Promise<object>} Final response object
 */
export async function coordinateCompanions(userId, role, message, circleId, context) {
    try {
        // Step 1: Activate all relevant handlers and agents
        // Some handlers depend on others, so we process in stages
        const initialResults = await processCompanionHandlers(userId, role, message, circleId, context);
        
        // Step 2: Enhance context with initial results for dependent handlers
        const enhancedContext = {
            ...context,
            inputUnderstanding: initialResults.inputUnderstanding?.result || {},
            historyAnalyzer: initialResults.historyAnalyzer?.result || {},
            empathyHandler: initialResults.empathyHandler?.result || {},
            stateTracker: initialResults.stateTracker?.result || {}
        };
        
        // Step 3: Re-process handlers that need enhanced context (like privacyGuard)
        // For now, privacyGuard gets enhanced context inline
        const componentResults = initialResults;
        
        // Update privacyGuard with enhanced context if it didn't get it
        if (componentResults.privacyGuard && !componentResults.privacyGuard.result.sharingSuggestion) {
            const { processPrivacyDecision } = await import('./handlers/privacyGuard.js');
            componentResults.privacyGuard.result = await processPrivacyDecision(
                userId, role, message, circleId, enhancedContext
            );
        }
        
        // Step 4: Aggregate responses from all handlers and agents
        const aggregated = aggregateResponses(componentResults);
        
        // Step 5: Resolve any conflicts between handlers and agents
        const resolved = resolveConflicts(aggregated, componentResults);
        
        // Step 6: Generate future_plan if needed
        // Calculate current turn from conversation history
        const currentTurn = context.history ? 
            context.history.filter(m => m.user_id === userId).length + 1 : 1;
        
        // Generate future plan using dedicated agent
        let futurePlan = aggregated.future_plan || null;
        if (!futurePlan) {
            try {
                const { generateFuturePlan } = await import('./agents/futurePlanningAgent.js');
                futurePlan = await generateFuturePlan(
                    userId, 
                    role, 
                    message, 
                    circleId, 
                    context, 
                    currentTurn
                );
            } catch (error) {
                console.error('[CompanionCoordinator] Error generating future plan:', error.message);
                futurePlan = null;
            }
        }
        resolved.future_plan = futurePlan;
        
        // Step 7: Add state_update from state tracker
        resolved.state_update = aggregated.state_update || initialResults.stateTracker?.result?.state_update || null;
        
        // Step 8: Ensure we have required fields for compatibility
        if (!resolved.intent) {
            resolved.intent = aggregated.intent || 'ASKING_QUESTION';
        }
        if (!resolved.reply) {
            resolved.reply = 'I understand. Can you tell me more?';
        }
        
        // Step 9: Return final coordinated response
        return resolved;
    } catch (error) {
        console.error('[CompanionCoordinator] Error:', error.message);
        // Fallback response
        return {
            intent: 'ASKING_QUESTION',
            reply: 'I understand. Can you tell me more?',
            criticality: 'NONE',
            privacyLevel: 'PRIVATE',
            facts: {},
            sharingSuggestion: null
        };
    }
}

/**
 * Determine which handlers and agents are relevant for this message
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {object} context - Conversation context
 * @returns {Array<string>} List of handler names to activate
 */
export function getRelevantHandlers(role, message, context) {
    const components = [];
    
    // Core handlers (always included)
    components.push('inputUnderstanding', 'historyAnalyzer', 'empathyHandler', 'privacyGuard', 'stateTracker');
    
    // Role-specific agents
    if (role === 'patient') {
        components.push('patientOptimizer');
    } else if (role === 'doctor') {
        components.push('doctorOptimizer');
    }
    
    // Context-dependent agents
    if (context.hasMedicalContent || message.toLowerCase().includes('pain') || message.toLowerCase().includes('symptom')) {
        components.push('clinicalAgent');
    }
    
    if (context.hasCriticalContent || message.toLowerCase().includes('emergency') || message.toLowerCase().includes('urgent')) {
        components.push('escalationManager');
    }
    
    return components;
}

