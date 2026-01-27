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
import { ConversationAnalyzer } from './conversation_analyzer.js';

export class SimulationFeedback {
    constructor(conversationId = 'sim_default', dbConnection = null, scenarioContext = null, promptVersion = 'simulation_v1.0') {
        this.conversationId = conversationId;
        this.scenarioContext = scenarioContext; // Store scenario-specific evaluation criteria
        this.promptVersion = promptVersion; // Store dynamic prompt version
        this.scorer = new SimulationScorer(dbConnection, scenarioContext);
        this.analyzer = new SimulationAnalyzer();
        this.reporter = new SimulationReporter(dbConnection);
        this.conversationAnalyzer = new ConversationAnalyzer(scenarioContext);
    }

    /**
     * Main feedback method - coordinates all feedback operations
     */
    /**
     * Main feedback method - coordinates all feedback operations
     */
    async provideFeedback(conversationId, userId, circleId, messageId, userMessage, agentResponse, orchestratorAction, context = null, promptVersion = null, conversationHistory = [], scenarioName = null, personaName = null, category = null) {
        // Use stored prompt version if not provided
        const actualPromptVersion = promptVersion || this.promptVersion;
        try {
            // 1. Score the response
            const analysis = await this.scorer.analyzeResponse(userMessage, agentResponse, orchestratorAction, conversationHistory);

            // 2. Assess care circle goals
            const goalAssessment = this.reporter.assessCareCircleGoals(userMessage, agentResponse, conversationHistory);

            // 3. Store feedback in database
            if (process.env.SIMULATION_DEBUG === 'true') console.log('[SimulationFeedback] Debug - analysis:', JSON.stringify(analysis, null, 2));

            // Extract prompt type and system used from agent response
            const promptType = agentResponse?.promptType || agentResponse?.analysis?.prompt_type || 'unified';
            const systemUsed = agentResponse?.system_used || agentResponse?.analysis?.system_used || 'unified';

            await this.reporter.autoScore(
                conversationId, userId, circleId, messageId,
                analysis.totalScore, analysis.scores?.[0]?.reason || 'No reason provided',
                actualPromptVersion, goalAssessment, agentResponse.modelUsed, promptType, systemUsed,
                scenarioName, personaName, category // Pass context
            );

            // 4. Store detailed reports for each issue
            for (const issue of analysis.issues) {
                await this.reporter.autoReport(
                    conversationId, userId, circleId, messageId,
                    issue.category, issue.description,
                    context || userMessage,
                    scenarioName, personaName // Pass context
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

    /**
     * Provide conversation-level feedback analysis
     * Analyzes patterns across multiple messages in a conversation
     */
    async provideConversationFeedback(conversationId, conversationHistory, feedbackHistory, scenarioName = null, personaName = null) {
        try {
            console.log(`[SimulationFeedback] Analyzing conversation-level patterns for ${conversationId}...`);

            // Perform conversation-level analysis
            const conversationAnalysis = this.conversationAnalyzer.analyzeConversation(
                conversationHistory,
                feedbackHistory
            );

            // Store conversation analysis in database
            await this.reporter.storeConversationAnalysis(conversationId, conversationAnalysis, scenarioName, personaName);

            if (conversationAnalysis?.speakerBalance?.starvationFlags?.length) {
                const summary = conversationAnalysis.speakerBalance.starvationFlags
                    .map(flag => `${flag.role}: ${(flag.actualShare * 100).toFixed(1)}% vs ${(flag.expectedShare * 100).toFixed(1)}% expected`)
                    .join('; ');
                await this.reporter.storeAdvice(
                    conversationId,
                    'system',
                    'conversation_starvation',
                    `Speaker starvation detected: ${summary}`,
                    'high'
                );
            }

            if (conversationAnalysis?.notificationCoverage?.missing) {
                await this.reporter.storeAdvice(
                    conversationId,
                    'system',
                    'missing_notifications',
                    'Scenario expected orchestrator notifications but none were sent.',
                    'high'
                );
            }

            // Generate conversation-level recommendations
            const conversationRecommendations = this._generateConversationRecommendations(conversationAnalysis);

            console.log(`[SimulationFeedback] Conversation analysis complete:`);
            console.log(`  📊 Context Continuity: ${((conversationAnalysis.contextContinuity?.continuityRate || 0) * 100).toFixed(1)}%`);
            console.log(`  🔄 Repetitive Patterns: ${conversationAnalysis.repetitivePatterns?.severity || 'low'}`);
            console.log(`  ⚡ Escalation Effectiveness: ${((conversationAnalysis.escalationPatterns?.effectiveness || 0) * 100).toFixed(1)}%`);
            console.log(`  🎯 Engagement Quality: ${((conversationAnalysis.engagementQuality?.overallScore || 0) * 100).toFixed(1)}%`);
            if (conversationAnalysis.futurePlanning) {
                console.log(`  🔮 Future Planning: ${conversationAnalysis.futurePlanning.totalPlans || 0} plans, ${((conversationAnalysis.futurePlanning.executionRate || 0) * 100).toFixed(1)}% executed`);
            }
            if (conversationAnalysis.starvationPenalty) {
                console.log(`  ⚠️ Starvation Penalty: ${conversationAnalysis.starvationPenalty}`);
            }
            console.log(`  💡 Recommendations: ${conversationRecommendations.length} generated`);

            return {
                conversationId,
                analysis: conversationAnalysis,
                recommendations: conversationRecommendations,
                timestamp: Date.now()
            };

        } catch (error) {
            console.error('[SimulationFeedback] Error providing conversation feedback:', error.message);
            return null;
        }
    }

    /**
     * Generate conversation-level recommendations
     */
    _generateConversationRecommendations(analysis) {
        const recommendations = [];

        // Context continuity issues
        if (analysis.contextContinuity.continuityRate < 0.7) {
            recommendations.push({
                category: 'context_continuity',
                priority: 'high',
                issue: 'Poor context maintenance across messages',
                suggestion: 'Implement context tracking and reference previous messages more consistently',
                impact: 'Improves conversation flow and user experience',
                specificActions: [
                    'Add context summarization to prompts',
                    'Implement message history analysis',
                    'Train on context-aware responses'
                ]
            });
        }

        // Repetitive patterns
        if (analysis.repetitivePatterns.severity === 'high') {
            recommendations.push({
                category: 'repetitive_responses',
                priority: 'high',
                issue: 'High frequency of repetitive responses',
                suggestion: 'Diversify response patterns and implement response variation',
                impact: 'Reduces user frustration and improves engagement',
                specificActions: [
                    'Add response variation to prompts',
                    'Implement response diversity scoring',
                    'Train on varied response patterns'
                ]
            });
        }

        // Escalation handling
        if (analysis.escalationPatterns.effectiveness < 0.5) {
            recommendations.push({
                category: 'escalation_handling',
                priority: 'high',
                issue: 'Poor escalation handling for critical situations',
                suggestion: 'Improve urgency detection and escalation protocols',
                impact: 'Critical for patient safety and care quality',
                specificActions: [
                    'Enhance urgency detection algorithms',
                    'Improve escalation response templates',
                    'Add critical situation handling training'
                ]
            });
        }

        // Denial handling
        if (analysis.denialHandling.denialHandlingRate < 0.6) {
            recommendations.push({
                category: 'denial_handling',
                priority: 'medium',
                issue: 'Ineffective handling of patient denial patterns',
                suggestion: 'Develop better strategies for addressing patient concerns and building trust',
                impact: 'Improves patient engagement and care adherence',
                specificActions: [
                    'Add denial pattern recognition training',
                    'Implement trust-building strategies',
                    'Develop patient concern validation techniques'
                ]
            });
        }

        // Engagement quality
        if (analysis.engagementQuality.overallScore < 0.6) {
            recommendations.push({
                category: 'engagement_quality',
                priority: 'medium',
                issue: 'Low overall engagement quality',
                suggestion: 'Improve response relevance, empathy, and question quality',
                impact: 'Enhances user satisfaction and conversation effectiveness',
                specificActions: [
                    'Enhance empathy training in prompts',
                    'Improve question generation quality',
                    'Add engagement scoring metrics'
                ]
            });
        }

        // Multi-user specific recommendations
        if (analysis.conflictResolution.applicable) {
            if (analysis.conflictResolution.resolvedConflicts / analysis.conflictResolution.totalConflicts < 0.7) {
                recommendations.push({
                    category: 'conflict_resolution',
                    priority: 'high',
                    issue: 'Poor conflict resolution in multi-user conversations',
                    suggestion: 'Improve conflict detection and mediation strategies',
                    impact: 'Critical for multi-user care circle effectiveness',
                    specificActions: [
                        'Add conflict detection algorithms',
                        'Implement mediation response templates',
                        'Train on conflict resolution strategies'
                    ]
                });
            }
        }

        return recommendations;
    }
}
