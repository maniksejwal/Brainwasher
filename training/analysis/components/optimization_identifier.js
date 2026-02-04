/**
 * @fileoverview Component for identifying optimization opportunities
 */

export class OptimizationIdentifier {
    constructor(commentAnalyzer) {
        this.commentAnalyzer = commentAnalyzer;
    }

    /**
     * Identify specific optimization opportunities
     */
    identifyOptimizationOpportunities(promptPerformance, feedbackData) {
        const opportunities = [];

        // Find patterns in negative feedback
        const negativeFeedback = feedbackData.filter(f => f.score < 0);
        const failurePatterns = {};
        const contextFailures = {};

        negativeFeedback.forEach(feedback => {
            const comment = feedback.comment?.toLowerCase() || '';
            const scenario = feedback.scenario_name || 'unknown';
            const persona = feedback.persona_name || 'unknown';

            // Categorize failure types
            let type = 'general';
            if (comment.includes('escalat')) type = 'escalation';
            else if (comment.includes('empathy') || comment.includes('loop')) type = 'empathy_loop';
            else if (comment.includes('denial') || comment.includes('accept')) type = 'denial_acceptance';
            else if (comment.includes('generic') || comment.includes('bland')) type = 'generic_response';

            // 1. General Pattern Tracking
            failurePatterns[type] = (failurePatterns[type] || 0) + 1;

            // 2. Context-Aware Tracking (Granular)
            if (scenario !== 'unknown' || persona !== 'unknown') {
                const contextKey = `${type}|${scenario}|${persona}`;
                if (!contextFailures[contextKey]) {
                    contextFailures[contextKey] = { count: 0, type, scenario, persona };
                }
                contextFailures[contextKey].count++;
            }
        });

        // Create optimization opportunities based on GENERAL patterns
        Object.entries(failurePatterns).forEach(([pattern, count]) => {
            if (count >= 3) { // Threshold for action
                opportunities.push({
                    pattern: pattern,
                    frequency: count,
                    priority: count >= 5 ? 'high' : 'medium',
                    description: `Frequent ${pattern.replace('_', ' ')} issues detected globally`,
                    suggested_prompt_changes: this.commentAnalyzer ? this.commentAnalyzer.getPromptSuggestions(pattern) : []
                });
            }
        });

        // Create optimization opportunities based on CONTEXT patterns (Granular)
        Object.values(contextFailures).forEach(cf => {
            if (cf.count >= 2) { // Lower threshold for specific context
                opportunities.push({
                    type: 'context_specific_failure',
                    pattern: cf.type,
                    context: { scenario: cf.scenario, persona: cf.persona },
                    frequency: cf.count,
                    priority: cf.count >= 3 ? 'high' : 'medium',
                    description: `Failure Pattern: ${cf.type} with ${cf.persona} in ${cf.scenario}`,
                    suggested_prompt_changes: this.commentAnalyzer ? this.commentAnalyzer.getPromptSuggestions(cf.type) : []
                });
            }
        });

        return opportunities;
    }
}
