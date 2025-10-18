/**
 * @fileoverview Simulation Feedback Coordinator
 * Orchestrates scoring, analysis, and reporting for simulation feedback
 * 
 * This is the main coordinator that delegates to specialized modules:
 * - SimulationScorer: Core scoring logic
 * - SimulationAnalyzer: Pattern analysis and detection  
 * - SimulationReporter: Database operations and reporting
 */

import { SimulationScorer } from './simulation_scorer.js';
import { SimulationAnalyzer } from './simulation_analyzer.js';
import { SimulationReporter } from './simulation_reporter.js';

export class SimulationFeedback {
    constructor(conversationId = 'sim_default', dbConnection = null) {
        this.conversationId = conversationId;
        this.scorer = new SimulationScorer(dbConnection);
        this.analyzer = new SimulationAnalyzer();
        this.reporter = new SimulationReporter(dbConnection);
    }

    /**
     * Main feedback method - coordinates all feedback operations
     */
    async provideFeedback(conversationId, userId, circleId, messageId, userMessage, agentResponse, orchestratorAction, context = null, promptVersion = 'simulation_v1.0', conversationHistory = []) {
        try {
            // 1. Score the response
            const analysis = this.scorer.analyzeResponse(userMessage, agentResponse, conversationHistory);
            
            // 2. Assess care circle goals
            const goalAssessment = this.reporter.assessCareCircleGoals(userMessage, agentResponse, conversationHistory);
            
            // 3. Store feedback in database
            await this.reporter.autoScore(
                conversationId, userId, circleId, messageId, 
                analysis.score, analysis.scores[0].reason, 
                promptVersion, goalAssessment
            );
            
            // 4. Store detailed reports for each issue
            for (const issue of analysis.issues) {
                await this.reporter.autoReport(
                    conversationId, userId, circleId, messageId,
                    issue.category, issue.description, 
                    context || userMessage
                );
            }
            
            // 5. Return comprehensive analysis
            return {
                score: analysis.score,
                issues: analysis.issues,
                urgencyAssessment: analysis.urgencyAssessment,
                goalAssessment: goalAssessment,
                criticalFailure: analysis.scores.some(s => s.score <= -2)
            };
            
        } catch (error) {
            console.error('[SimulationFeedback] Error providing feedback:', error.message);
            throw error;
        }
    }

    /**
     * Generate comprehensive feedback report
     */
    async generateReport(conversationId) {
        return await this.reporter.generateFeedbackReport(conversationId);
    }

    /**
     * Flag simulation for critical issues
     */
    async flagSimulation(conversationId, flagType, reason) {
        return await this.reporter.flagSimulation(conversationId, flagType, reason);
    }
}
