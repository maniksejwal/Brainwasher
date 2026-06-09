/**
 * @fileoverview Companion Component Registry and Processor
 *
 * AGENT REGISTRY
 * --------------
 * All companion agents and handlers are registered in HANDLER_MAP below.
 * This is the single source of truth for what agents exist in the JS layer.
 *
 * Architecture distinction:
 *   Handlers   — stateless processors that produce structured analysis from a message.
 *                They run early in the pipeline and feed context to agents.
 *   Agents     — decision-making specialists. Each has its own LLM call and prompt.
 *                They read from handler output but reach their own independent conclusions.
 *
 * Current agents (JS layer):
 *   inputUnderstanding  — unified intent/entity/fact extraction (general LLM)
 *   historyAnalyzer     — longitudinal pattern detection from conversation history
 *   empathyHandler      — empathy level + physio-aware stress response
 *   stateTracker        — behavioural state machine (compliance, mood trajectory)
 *   clinicalAgent       — medical criticality assessment (SPECIALIST, independent LLM)
 *   escalationManager   — escalation routing based on clinical criticality
 *   privacyGuard        — privacy classification (SPECIALIST, independent LLM, not unified)
 *   patientOptimizer    — patient-facing response optimisation
 *   doctorOptimizer     — clinician-facing summary and escalation content
 *   caregiverOptimizer  — caregiver burden, respite, and secondary-stress screening
 *
 * HTN agents (Python / tensornets layer — bridged via tensornetsBridge.js):
 *   physioState         — HRV/physiological state estimation (companions/physio/state.js)
 *   tensornetsMCTS      — MCTS action selection via /mcts/best-action
 *   tensornetsPrivacy   — MPS-based InfoClass privacy gating (agents/privacy_layer.py)
 *   sharedTensorBuffer  — multi-agent physiological state sharing (agents/shared_tensor_state.py)
 *   sessionManager      — longitudinal session state (agents/session_manager.py)
 *   htnJudge            — offline evaluation via /judge/turn, /judge/session (server.py)
 *
 * HTN agents are NOT in HANDLER_MAP — they are called directly from CompanionCoordinator.js
 * via tensornetsBridge.js. They do not participate in the per-message handler pipeline.
 * The bridge falls back gracefully when the tensornets server is unavailable.
 *
 * Adding a new agent:
 *   1. Create companions/agents/myAgent.js with its own LLM call and prompt.
 *   2. Create prompts/companion_my_agent.js with the prompt text.
 *   3. Add the prompt to companions/utils/promptLoader.js.
 *   4. Import and add to HANDLER_MAP below with a descriptive key.
 *   5. Add the key to the appropriate stage in processCompanionHandlers() or
 *      getRelevantHandlers() in CompanionCoordinator.js.
 */

// Handlers (stateless processors)
import { processInputUnderstanding } from './inputUnderstanding.js';
import { processHistoryAnalysis } from './historyAnalyzer.js';
import { processEmpathyDecision } from './empathyHandler.js';
import { processPrivacyDecision } from './privacyGuard.js';
import { processStateTracking } from './stateTracker.js';

// Agents (specialist decision-makers with independent LLM calls)
import { processClinicalAnalysis } from '../agents/clinicalAgent.js';
import { processEscalation } from '../agents/escalationManager.js';
import { processPatientOptimization } from '../agents/patientOptimizer.js';
import { processDoctorOptimization } from '../agents/doctorOptimizer.js';
import { processCaregiverOptimization } from '../agents/caregiverOptimizer.js';
// futurePlanningAgent is called directly from CompanionCoordinator — not via HANDLER_MAP

const HANDLER_MAP = {
    // ── Core handlers (run first, in parallel) ──────────────────────────────
    inputUnderstanding: processInputUnderstanding,  // unified LLM: intent, facts, mentions
    historyAnalyzer:    processHistoryAnalysis,      // longitudinal pattern detection
    empathyHandler:     processEmpathyDecision,      // empathy level + physio stress
    stateTracker:       processStateTracking,        // behavioural state machine

    // ── Specialist agents (run after core, read enhanced context) ───────────
    clinicalAgent:      processClinicalAnalysis,     // SPECIALIST: medical criticality (own LLM)
    privacyGuard:       processPrivacyDecision,      // SPECIALIST: privacy level (own LLM, independent)
    escalationManager:  processEscalation,           // escalation routing (reads clinicalAgent)
    patientOptimizer:    processPatientOptimization,   // patient-facing response optimisation
    doctorOptimizer:     processDoctorOptimization,    // clinician-facing summary
    caregiverOptimizer:  processCaregiverOptimization, // caregiver burden + respite screening
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
    const dependentHandlers = relevantComponents.filter(c => !coreHandlers.includes(c));
    
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

