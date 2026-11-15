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
import { selectAction } from '../agents/actionSelector.js';
import { updateOpenAsks } from '../../db/queries_asks.js';
import { getCircleMembers } from '../../db/index.js';
import { applySharingDirectives, buildDirectiveNotice, loadRestrictions, describeRestrictions, describeWithheldFrom } from '../../services/sharingPolicy.js';
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

    // Step 2a: Track the patient's questions and requests across turns. Never fails the turn.
    if (role === 'patient') {
        const understanding = enhancedContext.inputUnderstanding;
        enhancedContext.openAsks = await updateOpenAsks(circleId, userId, {
            asks: understanding.asks,
            resolved: understanding.resolvedAsks
        }).catch((error) => {
            console.warn('[Companions] Could not update open asks:', error.message);
            return [];
        });
        componentResults.openAsks = { result: enhancedContext.openAsks };
        if (process.env.DEBUG_COMPANION) {
            console.log(`[OpenAsks] labelled ${JSON.stringify(understanding.asks || [])} resolved ${JSON.stringify(understanding.resolvedAsks || [])} -> open ${enhancedContext.openAsks.length}`);
        }
    }

    // Step 2a': Store who the speaker asked not to share with (or lifted), then load the active
    // restrictions so the privacy guard and the reply see them. Sending is enforced again at
    // every send path, so a failure here cannot let anything through.
    await applyTurnSharingDirectives(userId, message, circleId, enhancedContext, componentResults);

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

    // Step 2c: Plan this turn's action before the reply is written (patients, not HIGH)
    if (relevantComponents.includes('patientOptimizer')) {
        const plan = await selectAction(userId, role, message, enhancedContext);
        if (plan) {
            Object.assign(enhancedContext, plan);
            componentResults.actionSelector = { result: plan };
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


/**
 * Applies the speaker's sharing directives and loads their active restrictions into the
 * context: enhancedContext.sharingRestrictions is the list, or null when it could not be
 * read. componentResults.sharingDirectives holds what changed and the confirmation notice.
 * Never fails the turn.
 */
async function applyTurnSharingDirectives(userId, message, circleId, enhancedContext, componentResults) {
    const directives = enhancedContext.inputUnderstanding?.sharingDirectives || [];
    try {
        if (!enhancedContext.members) enhancedContext.members = await getCircleMembers(circleId);
        if (directives.length > 0) {
            const outcome = await applySharingDirectives({
                circleId, ownerUserId: userId, directives, members: enhancedContext.members, sourceText: message
            });
            componentResults.sharingDirectives = { result: { ...outcome, notice: buildDirectiveNotice(outcome) } };
            console.log(`[SharingPolicy] directives applied (circle=${circleId}, owner=${userId}):`, JSON.stringify(outcome));
        }
    } catch (error) {
        console.error('[SharingPolicy] Could not apply sharing directives:', error.message);
        componentResults.sharingDirectives = { result: null, error: error.message };
    }
    enhancedContext.sharingRestrictions = await loadRestrictions(circleId, userId);
    const restrictions = enhancedContext.sharingRestrictions;
    // Read by buildKnownSection in the reply prompts: '' none, null unknown
    enhancedContext.sharingRestrictionText = restrictions === null
        ? null
        : describeRestrictions(restrictions, enhancedContext.members || []);
    componentResults.sharingRestrictions = {
        result: { list: restrictions, text: enhancedContext.sharingRestrictionText }
    };
    // Members who restricted the speaker: '' none, null unknown (read by buildKnownSection)
    enhancedContext.withheldFrom = await describeWithheldFrom(circleId, userId, enhancedContext.members || []);
}
