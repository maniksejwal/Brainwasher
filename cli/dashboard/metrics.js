/**
 * @fileoverview Dashboard Metrics Module
 * Handles all metrics display and data retrieval
 */

import chalk from 'chalk';

export class DashboardMetrics {
    constructor(core) {
        this.core = core;
        this.db = core.getDb();
    }

    /**
     * Show key simulation metrics
     */
    async showKeyMetrics() {
        try {
            console.log(chalk.cyan.bold('\n📊 KEY METRICS'));
            console.log('-'.repeat(40));

            // Total simulations
            const totalSims = await this.getTotalSimulations();
            console.log(`Total Simulations: ${chalk.green(totalSims)}`);

            // Recent activity (24h)
            const recentActivity = await this.getRecentActivity();
            console.log(`Recent Activity (24h): ${chalk.green(recentActivity)}`);

            // Feedback collection
            const feedbackCount = await this.getFeedbackCount();
            console.log(`Feedback Collected: ${chalk.green(feedbackCount)}`);

            // Critical failures
            const criticalFailures = await this.getCriticalFailures();
            console.log(`Critical Failures: ${criticalFailures > 0 ? chalk.red(criticalFailures) : chalk.green('0')}`);

            // Average scores
            const avgScore = await this.getAverageScore();
            console.log(`Average Score: ${chalk.green(avgScore.toFixed(2))}`);

            // Goal performance
            const goalPerformance = await this.getGoalPerformance();
            console.log(`Goal Performance: ${chalk.green(goalPerformance.toFixed(1))}%`);

        } catch (error) {
            console.error(chalk.red('Error loading metrics:'), error.message);
        }
    }

    /**
     * Show recent simulations
     */
    async showRecentSimulations() {
        try {
            console.log(chalk.cyan.bold('\n🕒 RECENT SIMULATIONS'));
            console.log('-'.repeat(40));

            const recentSims = await this.getRecentSimulations(5);
            
            if (recentSims.length === 0) {
                console.log(chalk.gray('No recent simulations found'));
                return;
            }

            recentSims.forEach((sim, index) => {
                const status = sim.critical_failure ? chalk.red('❌') : chalk.green('✅');
                const score = sim.score ? sim.score.toFixed(1) : 'N/A';
                const timestamp = new Date(sim.timestamp).toLocaleString();
                
                console.log(`${status} ${chalk.bold(sim.conversation_id)} | Score: ${score} | ${timestamp}`);
            });

        } catch (error) {
            console.error(chalk.red('Error loading recent simulations:'), error.message);
        }
    }

    /**
     * Get total number of simulations
     */
    async getTotalSimulations() {
        try {
            const result = await this.db.get(`
                SELECT COUNT(*) as count 
                FROM feedback 
                WHERE source = 'simulation'
            `);
            return result?.count || 0;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get recent activity count (24h)
     */
    async getRecentActivity() {
        try {
            const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
            const result = await this.db.get(`
                SELECT COUNT(*) as count 
                FROM feedback 
                WHERE source = 'simulation' AND timestamp > ?
            `, [oneDayAgo]);
            return result?.count || 0;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get total feedback count
     */
    async getFeedbackCount() {
        try {
            const result = await this.db.get(`
                SELECT COUNT(*) as count 
                FROM feedback
            `);
            return result?.count || 0;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get critical failures count
     */
    async getCriticalFailures() {
        try {
            const result = await this.db.get(`
                SELECT COUNT(*) as count 
                FROM feedback 
                WHERE critical_failure = 1
            `);
            return result?.count || 0;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get average score
     */
    async getAverageScore() {
        try {
            const result = await this.db.get(`
                SELECT AVG(score) as avg_score 
                FROM feedback 
                WHERE source = 'simulation'
            `);
            return result?.avg_score || 0;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get goal performance percentage
     */
    async getGoalPerformance() {
        try {
            const result = await this.db.get(`
                SELECT 
                    AVG(goal_adherence_score) as adherence,
                    AVG(goal_history_score) as history,
                    AVG(goal_conversation_score) as conversation
                FROM feedback 
                WHERE source = 'simulation'
            `);
            
            if (!result) return 0;
            
            const avgGoals = (result.adherence + result.history + result.conversation) / 3;
            return Math.max(0, avgGoals * 100);
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get recent simulations (distinct conversations)
     */
    async getRecentSimulations(limit = 5) {
        try {
            const results = await this.db.all(`
                SELECT DISTINCT conversation_id, score, critical_failure, timestamp
                FROM feedback 
                WHERE source = 'simulation'
                ORDER BY timestamp DESC 
                LIMIT ?
            `, [limit]);
            
            return results || [];
        } catch (error) {
            return [];
        }
    }
}
