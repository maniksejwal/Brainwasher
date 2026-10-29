/**
 * @fileoverview Companion Components Processor
 * Processes user messages through all relevant Companion handlers and agents
 */

// Handlers (processors)
import { processInputUnderstanding } from './inputUnderstanding.js';
import { processHistoryAnalysis } from './historyAnalyzer.js';
import { processEmpathyDecision } from './empathyHandler.js';
import { processPrivacyDecision } from './privacyGuard.js';
import { processStateTracking } from './stateTracker.js';

// Agents (decision-makers)
import { processClinicalAnalysis } from '../agents/clinicalAgent.js';
import { processEscalation } from '../agents/escalationManager.js';
import { processPatientOptimization } from '../agents/patientOptimizer.js';
import { processDoctorOptimization } from '../agents/doctorOptimizer.js';
// Note: futurePlanningAgent is called directly from CompanionCoordinator, not via HANDLER_MAP

const HANDLER_MAP = {
    inputUnderstanding: processInputUnderstanding,
    historyAnalyzer: processHistoryAnalysis,
    clinicalAgent: processClinicalAnalysis,
    empathyHandler: processEmpathyDecision,
    escalationManager: processEscalation,
    privacyGuard: processPrivacyDecision,
    patientOptimizer: processPatientOptimization,
    doctorOptimizer: processDoctorOptimization,
    stateTracker: processStateTracking
};

/**
 * Process message through all Companion handlers and agents
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context
 * @returns {Promise<object>} Results from all handlers and agents
 */
export async function processCompanionHandlers(userId, role, message, circleId, context) {
    const { getRelevantHandlers } = await import('../CompanionCoordinator.js');
    const relevantComponents = getRelevantHandlers(role, message, context);
    
    // Process handlers in stages: core handlers first, then dependent ones
    const coreHandlers = ['inputUnderstanding', 'historyAnalyzer', 'empathyHandler', 'stateTracker'];
    const dependentHandlers = relevantComponents.filter(c => !coreHandlers.includes(c) && c !== 'clinicalAgent');
    
    // Step 1: Process core handlers in parallel
    const corePromises = coreHandlers
        .filter(h => relevantComponents.includes(h))
        .map(componentName => {
            const componentFn = HANDLER_MAP[componentName];
            if (!componentFn) return null;
            return componentFn(userId, role, message, circleId, context)
                .then(result => ({ component: componentName, result }))
                .catch(error => {
                    console.error(`[Companions] Error in ${componentName}:`, error.message);
                    return { component: componentName, result: null, error: error.message };
                });
        }).filter(Boolean);
    
    const coreResults = await Promise.all(corePromises);
    const componentResults = {};
    for (const { component, result, error } of coreResults) {
        componentResults[component] = { result, error };
    }
    
    // Step 2: Enhance context with core results for dependent handlers
    const enhancedContext = {
        ...context,
        inputUnderstanding: componentResults.inputUnderstanding?.result || {},
        historyAnalyzer: componentResults.historyAnalyzer?.result || {},
        empathyHandler: componentResults.empathyHandler?.result || {},
        stateTracker: componentResults.stateTracker?.result || {}
    };

    // Step 2b: Run clinical analysis before its dependents (optimizers, escalation, future planning)
    if (relevantComponents.includes('clinicalAgent')) {
        try {
            const clinical = await HANDLER_MAP.clinicalAgent(userId, role, message, circleId, enhancedContext);
            componentResults.clinicalAgent = { result: clinical };
            if (clinical) enhancedContext.clinicalAssessment = clinical;
        } catch (error) {
            console.error('[Companions] Error in clinicalAgent:', error.message);
            componentResults.clinicalAgent = { result: null, error: error.message };
        }
    }

    // Step 3: Process dependent handlers with enhanced context
    const dependentPromises = dependentHandlers.map(componentName => {
        const componentFn = HANDLER_MAP[componentName];
        if (!componentFn) {
            console.warn(`[Companions] Component ${componentName} not found`);
            return null;
        }
        return componentFn(userId, role, message, circleId, enhancedContext)
            .then(result => ({ component: componentName, result }))
            .catch(error => {
                console.error(`[Companions] Error in ${componentName}:`, error.message);
                return { component: componentName, result: null, error: error.message };
            });
    }).filter(Boolean);
    
    const dependentResults = await Promise.all(dependentPromises);
    for (const { component, result, error } of dependentResults) {
        componentResults[component] = { result, error };
    }
    
    return componentResults;
}

