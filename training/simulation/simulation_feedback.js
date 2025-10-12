/**
 * @fileoverview training/simulation/simulation_feedback.js
 * Automatic feedback generation from simulations.
 * Simulations can detect issues and automatically score/report them.
 */

import { getDb } from '../../db/connection.js';

class SimulationFeedback {
    constructor(simulationId = 'sim_default', dbConnection = null) {
        this.simulationId = simulationId;
        this.dbConnection = dbConnection; // Use provided DB or fall back to main DB
    }

    /**
     * Automatically score an interaction
     */
    async autoScore(conversationId, userId, circleId, messageId, score, reason) {
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
                source TEXT DEFAULT 'user'
            )
        `);

        await db.run(
            `INSERT INTO feedback (conversation_id, message_id, user_id, circle_id, score, comment, timestamp, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'simulation')`,
            [conversationId, messageId, userId, circleId, score, reason, Date.now()]
        );

        console.log(`[SimulationFeedback] Auto-scored: ${score} - "${reason}"`);
    }

    /**
     * Automatically report an issue
     */
    async autoReport(conversationId, userId, circleId, messageId, category, description, context) {
        const db = this.dbConnection || await getDb();
        
        await db.run(`
            CREATE TABLE IF NOT EXISTS detailed_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT,
                message_id INTEGER,
                user_id TEXT,
                circle_id TEXT,
                category TEXT,
                description TEXT,
                context TEXT,
                timestamp INTEGER,
                resolved BOOLEAN DEFAULT 0,
                source TEXT DEFAULT 'user'
            )
        `);

        await db.run(
            `INSERT INTO detailed_feedback 
             (conversation_id, message_id, user_id, circle_id, category, description, context, timestamp, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'simulation')`,
            [conversationId, messageId, userId, circleId, category, description, context, Date.now()]
        );

        console.log(`[SimulationFeedback] Auto-reported [${category}]: "${description}"`);
    }

    /**
     * Analyze agent response for issues
     */
    analyzeResponse(userMessage, agentResponse, orchestratorAction) {
        const issues = [];
        const scores = [];

        // Check for template variable issues
        if (agentResponse.includes('{{') || agentResponse.includes('}}')) {
            issues.push({
                category: 'bug',
                description: `Template variables not replaced: ${this._extractTemplateVars(agentResponse)}`,
                severity: 'high'
            });
            scores.push({ score: -1, reason: 'Template variables not replaced' });
        }

        // Check for excessive verbosity
        const responseWords = agentResponse.split(/\s+/).length;
        const messageWords = userMessage.split(/\s+/).length;
        if (responseWords > messageWords * 4) {
            issues.push({
                category: 'verbosity',
                description: `Response is ${responseWords} words vs user's ${messageWords} words (${(responseWords/messageWords).toFixed(1)}x ratio)`,
                severity: 'medium'
            });
            scores.push({ score: 0, reason: 'Too verbose' });
        }

        // Check for very short responses
        if (responseWords < 3 && messageWords > 5) {
            issues.push({
                category: 'brevity',
                description: `Response too brief: only ${responseWords} words for ${messageWords} word message`,
                severity: 'medium'
            });
            scores.push({ score: -1, reason: 'Response too brief' });
        }

        // Check for missing escalation on critical keywords
        const criticalKeywords = ['dizzy', 'chest pain', 'bleeding', 'unconscious', 'can\'t breathe'];
        const hasCriticalKeyword = criticalKeywords.some(k => userMessage.toLowerCase().includes(k));
        if (hasCriticalKeyword && orchestratorAction.type !== 'ESCALATE') {
            issues.push({
                category: 'escalation',
                description: `Critical symptom detected ("${criticalKeywords.find(k => userMessage.toLowerCase().includes(k))}") but no escalation`,
                severity: 'critical'
            });
            scores.push({ score: -1, reason: 'Missed critical escalation' });
        }

        // Positive scoring for good responses
        if (issues.length === 0 && responseWords >= 5 && responseWords <= messageWords * 3) {
            scores.push({ score: 1, reason: 'Well-balanced response' });
        }

        return { issues, scores };
    }

    _extractTemplateVars(text) {
        const matches = text.match(/\{\{[^}]+\}\}/g);
        return matches ? matches.join(', ') : '';
    }

    /**
     * Comprehensive feedback for an interaction
     */
    async provideFeedback(conversationId, userId, circleId, messageId, userMessage, agentResponse, orchestratorAction, context = null) {
        const analysis = this.analyzeResponse(userMessage, agentResponse, orchestratorAction);

        // Report all detected issues
        for (const issue of analysis.issues) {
            await this.autoReport(
                conversationId,
                userId,
                circleId,
                messageId,
                issue.category,
                issue.description,
                context || userMessage
            );
        }

        // Provide scores
        for (const scoreData of analysis.scores) {
            await this.autoScore(
                conversationId,
                userId,
                circleId,
                messageId,
                scoreData.score,
                scoreData.reason
            );
        }

        return {
            issuesFound: analysis.issues.length,
            scores: analysis.scores,
            issues: analysis.issues
        };
    }
}

export { SimulationFeedback };

