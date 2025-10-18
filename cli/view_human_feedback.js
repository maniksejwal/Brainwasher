#!/usr/bin/env node

/**
 * @fileoverview Human Feedback Viewer CLI
 * Displays collected human feedback with analysis
 * 
 * Usage:
 *   node view_human_feedback.js [options]
 */

import { getDb } from '../db/connection.js';
import chalk from 'chalk';

class HumanFeedbackViewer {
    constructor() {
        this.db = null;
    }

    async initialize() {
        this.db = await getDb();
    }

    /**
     * Show all human feedback
     */
    async showAllFeedback() {
        console.log(chalk.blue.bold('📊 All Human Feedback'));
        console.log('='.repeat(50));

        const feedback = await this.db.all(`
            SELECT 
                f.*,
                m.message,
                m.role as message_role
            FROM feedback f
            LEFT JOIN messages m ON f.message_id = m.message_id
            WHERE f.user_id = 'human_reviewer'
            ORDER BY f.timestamp DESC
        `);

        if (feedback.length === 0) {
            console.log(chalk.yellow('No human feedback found.'));
            return;
        }

        console.log(chalk.green(`Found ${feedback.length} feedback entries:\n`));

        feedback.forEach((entry, index) => {
            const scoreColor = entry.score > 0 ? chalk.green : entry.score < 0 ? chalk.red : chalk.yellow;
            const scoreText = entry.score > 0 ? '+1' : entry.score < 0 ? '-1' : '0';
            
            console.log(`${index + 1}. ${scoreColor.bold(scoreText)} ${entry.feedback_type.toUpperCase()}`);
            console.log(`   Conversation: ${entry.conversation_id}`);
            if (entry.message_id) {
                console.log(`   Message: ${entry.message?.substring(0, 100)}...`);
            }
            console.log(`   Comment: ${entry.comment}`);
            console.log(`   Time: ${new Date(entry.timestamp).toLocaleString()}`);
            console.log('');
        });
    }

    /**
     * Show feedback statistics
     */
    async showFeedbackStats() {
        console.log(chalk.blue.bold('📈 Feedback Statistics'));
        console.log('='.repeat(50));

        const stats = await this.db.get(`
            SELECT 
                COUNT(*) as total_feedback,
                AVG(score) as avg_score,
                SUM(CASE WHEN score > 0 THEN 1 ELSE 0 END) as positive_count,
                SUM(CASE WHEN score < 0 THEN 1 ELSE 0 END) as negative_count,
                SUM(CASE WHEN score = 0 THEN 1 ELSE 0 END) as neutral_count
            FROM feedback 
            WHERE user_id = 'human_reviewer'
        `);

        if (!stats || stats.total_feedback === 0) {
            console.log(chalk.yellow('No human feedback found.'));
            return;
        }

        const positiveRate = (stats.positive_count / stats.total_feedback * 100).toFixed(1);
        const negativeRate = (stats.negative_count / stats.total_feedback * 100).toFixed(1);
        const neutralRate = (stats.neutral_count / stats.total_feedback * 100).toFixed(1);

        console.log(`Total Feedback: ${stats.total_feedback}`);
        console.log(`Average Score: ${stats.avg_score.toFixed(2)}`);
        console.log(`Positive: ${stats.positive_count} (${positiveRate}%)`);
        console.log(`Negative: ${stats.negative_count} (${negativeRate}%)`);
        console.log(`Neutral: ${stats.neutral_count} (${neutralRate}%)`);

        // Show trend over time
        const trend = await this.db.all(`
            SELECT 
                DATE(timestamp/1000, 'unixepoch') as date,
                COUNT(*) as count,
                AVG(score) as avg_score
            FROM feedback 
            WHERE user_id = 'human_reviewer'
            GROUP BY DATE(timestamp/1000, 'unixepoch')
            ORDER BY date DESC
            LIMIT 7
        `);

        if (trend.length > 0) {
            console.log(chalk.blue.bold('\n📅 Recent Trend (Last 7 Days):'));
            trend.forEach(day => {
                const scoreColor = day.avg_score > 0 ? chalk.green : day.avg_score < 0 ? chalk.red : chalk.yellow;
                console.log(`  ${day.date}: ${day.count} feedback, avg ${scoreColor(day.avg_score.toFixed(2))}`);
            });
        }
    }

    /**
     * Show feedback by conversation
     */
    async showFeedbackByConversation() {
        console.log(chalk.blue.bold('💬 Feedback by Conversation'));
        console.log('='.repeat(50));

        const conversations = await this.db.all(`
            SELECT 
                conversation_id,
                COUNT(*) as feedback_count,
                AVG(score) as avg_score,
                MIN(timestamp) as first_feedback,
                MAX(timestamp) as last_feedback
            FROM feedback 
            WHERE user_id = 'human_reviewer'
            GROUP BY conversation_id
            ORDER BY last_feedback DESC
        `);

        if (conversations.length === 0) {
            console.log(chalk.yellow('No conversations with human feedback found.'));
            return;
        }

        conversations.forEach((conv, index) => {
            const scoreColor = conv.avg_score > 0 ? chalk.green : conv.avg_score < 0 ? chalk.red : chalk.yellow;
            
            console.log(`${index + 1}. ${conv.conversation_id}`);
            console.log(`   Feedback Count: ${conv.feedback_count}`);
            console.log(`   Average Score: ${scoreColor(conv.avg_score.toFixed(2))}`);
            console.log(`   Last Feedback: ${new Date(conv.last_feedback).toLocaleString()}`);
            console.log('');
        });
    }

    /**
     * Show common issues from negative feedback
     */
    async showCommonIssues() {
        console.log(chalk.blue.bold('🚨 Common Issues from Negative Feedback'));
        console.log('='.repeat(50));

        const issues = await this.db.all(`
            SELECT 
                comment,
                COUNT(*) as frequency
            FROM feedback 
            WHERE user_id = 'human_reviewer' AND score < 0
            GROUP BY comment
            ORDER BY frequency DESC
            LIMIT 10
        `);

        if (issues.length === 0) {
            console.log(chalk.yellow('No negative feedback found.'));
            return;
        }

        issues.forEach((issue, index) => {
            console.log(`${index + 1}. "${issue.comment}" (${issue.frequency} times)`);
        });
    }

    /**
     * Show feedback patterns
     */
    async showFeedbackPatterns() {
        console.log(chalk.blue.bold('🔍 Feedback Patterns'));
        console.log('='.repeat(50));

        // Message vs Overall feedback patterns
        const patterns = await this.db.all(`
            SELECT 
                feedback_type,
                COUNT(*) as count,
                AVG(score) as avg_score
            FROM feedback 
            WHERE user_id = 'human_reviewer'
            GROUP BY feedback_type
        `);

        patterns.forEach(pattern => {
            const scoreColor = pattern.avg_score > 0 ? chalk.green : pattern.avg_score < 0 ? chalk.red : chalk.yellow;
            console.log(`${pattern.feedback_type.toUpperCase()}: ${pattern.count} entries, avg ${scoreColor(pattern.avg_score.toFixed(2))}`);
        });

        // Time-based patterns
        const timePatterns = await this.db.all(`
            SELECT 
                CASE 
                    WHEN strftime('%H', timestamp/1000, 'unixepoch') BETWEEN '09' AND '17' THEN 'Work Hours'
                    WHEN strftime('%H', timestamp/1000, 'unixepoch') BETWEEN '18' AND '22' THEN 'Evening'
                    ELSE 'Other Hours'
                END as time_period,
                COUNT(*) as count,
                AVG(score) as avg_score
            FROM feedback 
            WHERE user_id = 'human_reviewer'
            GROUP BY time_period
        `);

        if (timePatterns.length > 0) {
            console.log(chalk.blue.bold('\n⏰ Time-based Patterns:'));
            timePatterns.forEach(pattern => {
                const scoreColor = pattern.avg_score > 0 ? chalk.green : pattern.avg_score < 0 ? chalk.red : chalk.yellow;
                console.log(`${pattern.time_period}: ${pattern.count} entries, avg ${scoreColor(pattern.avg_score.toFixed(2))}`);
            });
        }
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
📊 Human Feedback Viewer CLI

Usage:
  node view_human_feedback.js [options]

Options:
  --all, -a         Show all human feedback
  --stats, -s       Show feedback statistics
  --conversations   Show feedback by conversation
  --issues, -i      Show common issues from negative feedback
  --patterns, -p    Show feedback patterns
  --help, -h        Show this help

Examples:
  node view_human_feedback.js --all              # Show all feedback
  node view_human_feedback.js --stats            # Show statistics
  node view_human_feedback.js --issues           # Show common issues
        `);
        process.exit(0);
    }

    const viewer = new HumanFeedbackViewer();
    
    try {
        await viewer.initialize();
        
        if (args.includes('--all') || args.includes('-a')) {
            await viewer.showAllFeedback();
        } else if (args.includes('--stats') || args.includes('-s')) {
            await viewer.showFeedbackStats();
        } else if (args.includes('--conversations')) {
            await viewer.showFeedbackByConversation();
        } else if (args.includes('--issues') || args.includes('-i')) {
            await viewer.showCommonIssues();
        } else if (args.includes('--patterns') || args.includes('-p')) {
            await viewer.showFeedbackPatterns();
        } else {
            // Default: show all
            await viewer.showAllFeedback();
        }
    } catch (error) {
        console.error(chalk.red('Error:'), error.message);
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
