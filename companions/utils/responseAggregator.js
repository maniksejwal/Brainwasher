/**
 * @fileoverview Response Aggregator
 * Combines and resolves outputs from multiple Companion handlers
 */

/**
 * Aggregate responses from all handlers and agents into a unified structure
 * @param {object} componentResults - Results from all handlers and agents
 * @returns {object} Aggregated response
 */
export function aggregateResponses(componentResults) {
    const aggregated = {
        intent: null,
        reply: null,
        criticality: 'NONE',
        privacyLevel: 'PRIVATE',
        facts: {},
        sharingSuggestion: null,
        empathyLevel: null,
        clinicalAssessment: null,
        escalationRequired: false,
        confidence: 0,
        future_plan: null // For future planning
    };
    
    // Aggregate from each handler
    if (componentResults.inputUnderstanding?.result) {
        const input = componentResults.inputUnderstanding.result;
        aggregated.intent = input.intent || aggregated.intent;
        aggregated.facts = { ...aggregated.facts, ...(input.facts || {}) };
        // Extract mentioned_usernames for entity resolution
        aggregated.mentioned_usernames = input.mentionedUsernames || input.mentioned_usernames || [];
        // Store resolved users for use by other handlers
        aggregated.resolvedUsers = input.resolvedUsers || [];
    }
    
    if (componentResults.historyAnalyzer?.result) {
        const history = componentResults.historyAnalyzer.result;
        aggregated.facts = { ...aggregated.facts, ...(history.contextualFacts || {}) };
    }
    
    if (componentResults.empathyHandler?.result) {
        const empathy = componentResults.empathyHandler.result;
        aggregated.empathyLevel = empathy.level;
        aggregated.reply = empathy.reply || aggregated.reply;
    }
    
    if (componentResults.privacyGuard?.result) {
        const privacy = componentResults.privacyGuard.result;
        aggregated.privacyLevel = privacy.level || aggregated.privacyLevel;
        aggregated.sharingSuggestion = privacy.sharingSuggestion || aggregated.sharingSuggestion;
    }
    
    // Aggregate from each agent
    if (componentResults.clinicalAgent?.result) {
        const clinical = componentResults.clinicalAgent.result;
        aggregated.clinicalAssessment = clinical.assessment;
        aggregated.criticality = clinical.criticality || aggregated.criticality;
    }
    
    if (componentResults.escalationManager?.result) {
        const escalation = componentResults.escalationManager.result;
        aggregated.escalationRequired = escalation.required || false;
        aggregated.criticality = escalation.criticality || aggregated.criticality;
        aggregated.sharingSuggestion = escalation.sharingSuggestion || aggregated.sharingSuggestion;
    }
    
    if (componentResults.patientOptimizer?.result) {
        const patient = componentResults.patientOptimizer.result;
        aggregated.reply = patient.reply || aggregated.reply;
    }
    
    if (componentResults.doctorOptimizer?.result) {
        const doctor = componentResults.doctorOptimizer.result;
        aggregated.reply = doctor.reply || aggregated.reply;
    }
    
    return aggregated;
}

/**
 * Resolve conflicts between handler and agent outputs
 * @param {object} aggregated - Aggregated responses
 * @param {object} componentResults - Original component results (handlers + agents)
 * @returns {object} Resolved response with conflicts handled
 */
export function resolveConflicts(aggregated, componentResults) {
    const resolved = { ...aggregated };
    
    // Conflict resolution rules
    
    // 1. Criticality: Take highest
    const criticalityLevels = { 'NONE': 0, 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3 };
    const criticalities = Object.values(componentResults)
        .map(c => c.result?.criticality)
        .filter(Boolean)
        .map(c => ({ level: c, value: criticalityLevels[c] || 0 }));
    
    if (criticalities.length > 0) {
        criticalities.sort((a, b) => b.value - a.value);
        resolved.criticality = criticalities[0].level;
    }
    
    // 2. Privacy: Take most restrictive
    const privacyLevels = { 'PUBLIC': 0, 'PRIVATE': 1, 'SENSITIVE': 2 };
    const privacies = Object.values(componentResults)
        .map(c => c.result?.privacyLevel)
        .filter(Boolean)
        .map(p => ({ level: p, value: privacyLevels[p] || 0 }));
    
    if (privacies.length > 0) {
        privacies.sort((a, b) => b.value - a.value);
        resolved.privacyLevel = privacies[0].level;
    }
    
    // 3. Reply: Prefer role-specific optimizers, fallback to empathy handler
    if (!resolved.reply) {
        if (componentResults.patientOptimizer?.result?.reply) {
            resolved.reply = componentResults.patientOptimizer.result.reply;
        } else if (componentResults.doctorOptimizer?.result?.reply) {
            resolved.reply = componentResults.doctorOptimizer.result.reply;
        } else if (componentResults.empathyHandler?.result?.reply) {
            resolved.reply = componentResults.empathyHandler.result.reply;
        }
    }
    
    // 4. Escalation: If any component says escalate, escalate
    const escalationRequired = Object.values(componentResults)
        .some(c => c.result?.escalationRequired === true);
    resolved.escalationRequired = escalationRequired || resolved.escalationRequired;
    
    return resolved;
}

