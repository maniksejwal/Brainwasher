/**
 * @fileoverview Training Database Manager
 * Centralized database connection management for all training components
 * Ensures consistency between simulation and analysis systems
 */

import { getDb } from '../../db/connection.js';

export class TrainingDatabaseManager {
    constructor() {
        this.db = null;
        this.isSimulationMode = false;
    }

    /**
     * Initialize database connection for training components
     * @param {boolean} simulationMode - Whether to use simulation database
     */
    async initialize(simulationMode = false) {
        this.isSimulationMode = simulationMode;
        
        if (simulationMode) {
            process.env.SIMULATION_MODE = 'true';
        } else {
            delete process.env.SIMULATION_MODE;
        }
        
        this.db = await getDb();
        
        console.log(`[TrainingDatabaseManager] Initialized in ${simulationMode ? 'simulation' : 'production'} mode`);
        return this.db;
    }

    /**
     * Get database connection
     */
    getDb() {
        if (!this.db) {
            throw new Error('TrainingDatabaseManager not initialized. Call initialize() first.');
        }
        return this.db;
    }

    /**
     * Check if in simulation mode
     */
    isSimulation() {
        return this.isSimulationMode;
    }

    /**
     * Get conversation count for training analysis
     */
    async getConversationCount(days = 7) {
        const db = this.getDb();
        const result = await db.get(`
            SELECT COUNT(DISTINCT conversation_id) as count 
            FROM feedback 
            WHERE timestamp > (strftime('%s', 'now') - ${days * 24 * 60 * 60}) * 1000
        `);
        return result?.count || 0;
    }

    /**
     * Get performance metrics for training analysis
     */
    async getPerformanceMetrics(days = 7) {
        const db = this.getDb();
        
        // Check if goal columns exist
        const columns = await db.all("PRAGMA table_info(feedback)");
        const hasGoalColumns = columns.some(col => col.name === 'goal_adherence_score');
        
        let query;
        if (hasGoalColumns) {
            query = `
                SELECT 
                    AVG(score) as averageScore,
                    COUNT(*) as totalFeedback,
                    AVG(goal_adherence_score) as adherenceScore,
                    AVG(goal_conversation_score) as conversationScore,
                    AVG(CASE WHEN critical_failure = 1 THEN 1 ELSE 0 END) as failureRate
                FROM feedback 
                WHERE timestamp > (strftime('%s', 'now') - ${days * 24 * 60 * 60}) * 1000
            `;
        } else {
            query = `
                SELECT 
                    AVG(score) as averageScore,
                    COUNT(*) as totalFeedback,
                    0 as adherenceScore,
                    0 as conversationScore,
                    AVG(CASE WHEN critical_failure = 1 THEN 1 ELSE 0 END) as failureRate
                FROM feedback 
                WHERE timestamp > (strftime('%s', 'now') - ${days * 24 * 60 * 60}) * 1000
            `;
        }
        
        const result = await db.get(query);
        
        return {
            averageScore: result?.averageScore || 0,
            totalFeedback: result?.totalFeedback || 0,
            adherenceScore: result?.adherenceScore || 0,
            conversationScore: result?.conversationScore || 0,
            failureRate: result?.failureRate || 0
        };
    }

    /**
     * Get feedback data for analysis
     */
    async getFeedbackData(limit = 1000, days = 7) {
        const db = this.getDb();
        const feedback = await db.all(`
            SELECT 
                conversation_id,
                user_id,
                circle_id,
                message_id,
                user_message,
                agent_response,
                score,
                reason,
                timestamp,
                prompt_version,
                goal_adherence_score,
                goal_conversation_score,
                critical_failure
            FROM feedback 
            WHERE timestamp > datetime('now', '-${days} days')
            ORDER BY timestamp DESC
            LIMIT ?
        `, [limit]);
        
        return feedback;
    }

    /**
     * Store training metadata
     */
    async storeTrainingMetadata(key, value) {
        const db = this.getDb();
        await db.run(`
            INSERT OR REPLACE INTO training_metadata (key, value, updated_at)
            VALUES (?, ?, datetime('now'))
        `, [key, value]);
    }

    /**
     * Get training metadata
     */
    async getTrainingMetadata(key) {
        const db = this.getDb();
        const result = await db.get(`
            SELECT value FROM training_metadata 
            WHERE key = ?
        `, [key]);
        return result?.value || null;
    }

    /**
     * Store prompt version
     */
    async storePromptVersion(version, content, performanceScore) {
        const db = this.getDb();
        await db.run(`
            INSERT INTO prompt_versions (version, content, deployed_at, performance_score)
            VALUES (?, ?, datetime('now'), ?)
        `, [version, content, performanceScore]);
    }

    /**
     * Get prompt versions
     */
    async getPromptVersions(limit = 10) {
        const db = this.getDb();
        const versions = await db.all(`
            SELECT * FROM prompt_versions 
            ORDER BY deployed_at DESC 
            LIMIT ?
        `, [limit]);
        return versions;
    }
}

// Export singleton instance
export const trainingDb = new TrainingDatabaseManager();
