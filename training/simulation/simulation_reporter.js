/**
 * @fileoverview Simulation Reporter - Database operations and reporting
 * Handles database storage, flagging, and detailed reporting
 */

import { getDb } from '../../db/connection.js';
import { SimulationScorer } from './simulation_scorer.js';
import chalk from 'chalk';

export class SimulationReporter {
    constructor(dbConnection = null) {
        this.dbConnection = dbConnection;
        this.scorer = new SimulationScorer(dbConnection);
    }

    /**
     * Auto-score feedback and store in database
     */
    async autoScore(conversationId, userId, circleId, messageId, score, reason, promptVersion = 'simulation_v1.0', goalAssessment = null, modelUsed = null) {
        const db = this.dbConnection || await getDb();
        
        await db.run(`
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT,
                message_id INTEGER,
                user_id TEXT,
                circle_id TEXT,
                score INTEGER,
                comment TEXT,
                timestamp INTEGER,
                source TEXT DEFAULT 'user',
                prompt_version TEXT,
                goal_adherence_score REAL,
                goal_history_score REAL,
                goal_conversation_score REAL,
                critical_failure BOOLEAN DEFAULT 0
            )
        `);

        const criticalFailure = score <= -2;
        const goalAdherence = goalAssessment?.adherence || null;
        const goalHistory = goalAssessment?.history || null;
        const goalConversation = goalAssessment?.conversation || null;

        await db.run(
            `INSERT INTO feedback (conversation_id, message_id, user_id, circle_id, score, comment, timestamp, source, prompt_version, goal_adherence_score, goal_history_score, goal_conversation_score, critical_failure, model_used, model_version)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'simulation', ?, ?, ?, ?, ?, ?, ?)`,
            [conversationId, messageId, userId, circleId, score, reason, Date.now(), promptVersion, goalAdherence, goalHistory, goalConversation, criticalFailure, modelUsed, modelUsed]
        );

        const autoScoredMsg = `[SimulationReporter][Auto-Scored]: Score ${score} - "${reason}"`;
        if (criticalFailure) {
            console.log(chalk.yellowBright(autoScoredMsg) + chalk.red.bold('  🚨 [Critical Failure]'));
        } else {
            console.log(chalk.yellowBright(autoScoredMsg));
        }
        
        // Store advice/recommendations if critical failure
        if (criticalFailure) {
            await this.storeAdvice(conversationId, userId, 'improvement', reason, 'high');
            await this.flagSimulation(conversationId, 'critical_failure', reason);
        }
    }

    /**
     * Store advice/recommendations
     */
    async storeAdvice(conversationId, userId, adviceType, adviceText, priority = 'medium') {
        const db = this.dbConnection || await getDb();
        
        await db.run(
            `INSERT INTO advice (conversation_id, user_id, advice_type, advice_text, priority, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [conversationId, userId, adviceType, adviceText, priority, Date.now()]
        );
    }

    /**
     * Auto-report detailed issues
     */
    async autoReport(conversationId, userId, circleId, messageId, category, description, context) {
        const db = this.dbConnection || await getDb();
        
        await db.run(`
            CREATE TABLE IF NOT EXISTS detailed_feedback (
                report_id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT,
                message_id INTEGER,
                user_id TEXT NOT NULL,
                circle_id TEXT,
                category TEXT NOT NULL,
                description TEXT,
                details TEXT NOT NULL,
                context TEXT,
                prompt_version TEXT,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )
        `);

        await db.run(
            `INSERT INTO detailed_feedback (conversation_id, message_id, user_id, circle_id, category, description, context, timestamp, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'simulation')`,
            [conversationId, messageId, userId, circleId, category, description, context, Date.now()]
        );

        console.log(chalk.blue(`[SimulationReporter][Message Flagged]`) + chalk.white(` ${category}: ${description}`));
    }

    /**
     * Flag simulation for critical issues
     */
    async flagSimulation(conversationId, flagType, reason) {
        const db = this.dbConnection || await getDb();
        
        await db.run(`
            CREATE TABLE IF NOT EXISTS simulation_flags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT,
                flag_type TEXT,
                reason TEXT,
                timestamp INTEGER,
                resolved BOOLEAN DEFAULT 0,
                resolution_notes TEXT
            )
        `);

        await db.run(
            `INSERT INTO simulation_flags (conversation_id, flag_type, reason, timestamp)
             VALUES (?, ?, ?, ?)`,
            [conversationId, flagType, reason, Date.now()]
        );

        // Compact but visible flag message
        console.log(chalk.red.bold('🚨 [SIMULATION FLAGGED]') + 
                   chalk.yellow(` ${flagType}`) + 
                   chalk.white(` | ${reason} | ${conversationId}`));
    }

    /**
     * Assess care circle goals and return assessment
     * Delegates to SimulationScorer to avoid code duplication
     */
    assessCareCircleGoals(userMessage, agentResponse, conversationHistory = []) {
        const goals = {
            adherence: this.scorer._assessAdherenceGoal(userMessage, agentResponse),
            history: this.scorer._assessHistoryGoal(userMessage, agentResponse, conversationHistory),
            conversation: this.scorer._assessConversationGoal(userMessage, agentResponse)
        };
        
        return goals;
    }

    /**
     * Generate comprehensive feedback report
     */
    async generateFeedbackReport(conversationId) {
        const db = this.dbConnection || await getDb();
        
        try {
            // Get all feedback for conversation
            const feedback = await db.all(`
                SELECT * FROM feedback 
                WHERE conversation_id = ?
                ORDER BY timestamp ASC
            `, [conversationId]);
            
            // Get detailed reports
            const detailedReports = await db.all(`
                SELECT * FROM detailed_feedback 
                WHERE conversation_id = ?
                ORDER BY timestamp ASC
            `, [conversationId]);
            
            // Calculate summary statistics
            const totalTurns = feedback.length;
            const avgScore = feedback.reduce((sum, f) => sum + f.score, 0) / totalTurns;
            const criticalFailures = feedback.filter(f => f.critical_failure).length;
            const positiveScores = feedback.filter(f => f.score > 0).length;
            const negativeScores = feedback.filter(f => f.score < 0).length;
            
            // Goal assessment summary
            const goalSummary = {
                adherence: feedback.reduce((sum, f) => sum + (f.goal_adherence_score || 0), 0) / totalTurns,
                history: feedback.reduce((sum, f) => sum + (f.goal_history_score || 0), 0) / totalTurns,
                conversation: feedback.reduce((sum, f) => sum + (f.goal_conversation_score || 0), 0) / totalTurns
            };
            
            return {
                conversationId: conversationId,
                summary: {
                    totalTurns: totalTurns,
                    avgScore: avgScore,
                    criticalFailures: criticalFailures,
                    positiveScores: positiveScores,
                    negativeScores: negativeScores,
                    successRate: positiveScores / totalTurns
                },
                goalSummary: goalSummary,
                feedback: feedback,
                detailedReports: detailedReports,
                recommendations: this._generateRecommendations(feedback, detailedReports)
            };
            
        } catch (error) {
            console.error('[SimulationReporter] Error generating feedback report:', error.message);
            return null;
        }
    }

    /**
     * Generate recommendations based on feedback
     */
    _generateRecommendations(feedback, detailedReports) {
        const recommendations = [];
        
        // Analyze patterns
        const avgScore = feedback.reduce((sum, f) => sum + f.score, 0) / feedback.length;
        const criticalFailures = feedback.filter(f => f.critical_failure).length;
        
        if (avgScore < 0) {
            recommendations.push({
                priority: 'high',
                category: 'overall_performance',
                recommendation: 'Overall conversation performance is poor. Review prompt for clarity and safety.',
                actions: [
                    'Review prompt templates for clarity',
                    'Add safety checks for critical situations',
                    'Improve escalation triggers',
                    'Test with adversarial personas'
                ]
            });
        }
        
        if (criticalFailures > 0) {
            recommendations.push({
                priority: 'critical',
                category: 'critical_failures',
                recommendation: `${criticalFailures} critical failures detected. Immediate prompt review required.`,
                actions: [
                    'Review critical failure patterns',
                    'Strengthen safety mechanisms',
                    'Add emergency response protocols',
                    'Implement additional safety checks'
                ]
            });
        }
        
        // Analyze detailed reports
        const categories = {};
        detailedReports.forEach(report => {
            categories[report.category] = (categories[report.category] || 0) + 1;
        });
        
        Object.entries(categories).forEach(([category, count]) => {
            if (count >= 2) {
                recommendations.push({
                    priority: 'medium',
                    category: category,
                    recommendation: `Frequent ${category} issues detected (${count} occurrences).`,
                    actions: this._getCategoryActions(category)
                });
            }
        });
        
        return recommendations;
    }

    /**
     * Get specific actions for issue categories
     */
    _getCategoryActions(category) {
        const actions = {
            escalation: [
                'Strengthen escalation triggers in prompts',
                'Add temporal urgency assessment',
                'Improve critical symptom detection'
            ],
            empathy_loop: [
                'Add variety to empathy expressions',
                'Include action-oriented responses',
                'Limit repetitive caring language'
            ],
            verbosity: [
                'Reduce response length targets',
                'Focus on key points only',
                'Remove redundant phrases'
            ],
            generic_response: [
                'Add context-specific response templates',
                'Include symptom-specific questions',
                'Improve personalization'
            ]
        };
        
        return actions[category] || ['Review prompt for clarity and specificity'];
    }

    /**
     * Store conversation-level analysis in database
     */
    async storeConversationAnalysis(conversationId, analysis) {
        try {
            if (!this.dbConnection) {
                console.warn('[SimulationReporter] No database connection for storing conversation analysis');
                return false;
            }

            // Create conversation_analysis table if it doesn't exist
            await this.dbConnection.run(`
                CREATE TABLE IF NOT EXISTS conversation_analysis (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id TEXT NOT NULL,
                    analysis_data TEXT NOT NULL,
                    timestamp INTEGER NOT NULL
                )
            `);

            // Store the analysis
            await this.dbConnection.run(`
                INSERT INTO conversation_analysis (conversation_id, analysis_data, timestamp)
                VALUES (?, ?, ?)
            `, [conversationId, JSON.stringify(analysis), Date.now()]);

            console.log(`[SimulationReporter] Conversation analysis stored for ${conversationId}`);
            return true;

        } catch (error) {
            console.error('[SimulationReporter] Error storing conversation analysis:', error.message);
            return false;
        }
    }

    /**
     * Retrieve conversation analysis from database
     */
    async getConversationAnalysis(conversationId) {
        try {
            if (!this.dbConnection) {
                console.warn('[SimulationReporter] No database connection for retrieving conversation analysis');
                return null;
            }

            const result = await this.dbConnection.get(`
                SELECT analysis_data, timestamp 
                FROM conversation_analysis 
                WHERE conversation_id = ? 
                ORDER BY timestamp DESC 
                LIMIT 1
            `, [conversationId]);

            if (result) {
                return {
                    analysis: JSON.parse(result.analysis_data),
                    timestamp: result.timestamp
                };
            }

            return null;

        } catch (error) {
            console.error('[SimulationReporter] Error retrieving conversation analysis:', error.message);
            return null;
        }
    }
}
