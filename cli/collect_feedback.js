#!/usr/bin/env node

/**
 * @fileoverview Human Feedback Collection CLI
 * Allows human reviewers to provide feedback on live conversations
 * 
 * Usage:
 *   node collect_feedback.js [conversation_id] [message_id]
 *   node collect_feedback.js --live                    # Monitor live conversations
 *   node collect_feedback.js --recent                  # Review recent conversations
 */

import { getDb } from '../db/connection.js';
import readline from 'readline';
import chalk from 'chalk';

class HumanFeedbackCollector {
    constructor() {
        this.db = null;
        this.rl = null;
    }

    async initialize() {
        this.db = await getDb();
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    /**
     * Monitor live conversations for feedback opportunities
     */
    async monitorLiveConversations() {
        console.log(chalk.blue.bold('🔍 Monitoring Live Conversations for Feedback Opportunities...'));
        console.log(chalk.gray('Press Ctrl+C to exit\n'));

        // Check for recent conversations that need feedback
        const recentConversations = await this.getRecentConversations();
        
        if (recentConversations.length === 0) {
            console.log(chalk.yellow('No recent conversations found. Waiting for new activity...'));
            return;
        }

        console.log(chalk.green(`Found ${recentConversations.length} recent conversations:`));
        for (const conv of recentConversations) {
            console.log(`  ${conv.conversation_id} - ${conv.message_count} messages - ${new Date(conv.last_message).toLocaleString()}`);
        }

        // Allow user to select conversation for feedback
        const selectedConv = await this.selectConversation(recentConversations);
        if (selectedConv) {
            await this.reviewConversation(selectedConv.conversation_id);
        }
    }

    /**
     * Review a specific conversation
     */
    async reviewConversation(conversationId) {
        console.log(chalk.blue.bold(`\n📋 Reviewing Conversation: ${conversationId}`));
        
        const messages = await this.getConversationMessages(conversationId);
        if (messages.length === 0) {
            console.log(chalk.red('No messages found for this conversation.'));
            return;
        }

        console.log(chalk.green(`\nFound ${messages.length} messages:`));
        
        // Display conversation
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const speaker = msg.role === 'user' ? chalk.cyan.bold('USER') : chalk.magenta.bold('AGENT');
            console.log(`\n${i + 1}. ${speaker}: ${msg.message}`);
            console.log(chalk.gray(`   Time: ${new Date(msg.timestamp).toLocaleString()}`));
        }

        // Collect feedback
        await this.collectConversationFeedback(conversationId, messages);
    }

    /**
     * Collect feedback on specific conversation
     */
    async collectConversationFeedback(conversationId, messages) {
        console.log(chalk.blue.bold('\n💬 Feedback Collection'));
        console.log('Options:');
        console.log('  - Press ENTER to skip');
        console.log('  - Type message number (e.g., "1", "2") to give feedback on that turn');
        console.log('  - Type "all" to give overall feedback');
        console.log('  - Type "q" to quit');

        const choice = await this.askQuestion('\n❓ Provide feedback? (enter/1/2/all/q): ');
        
        if (choice && choice.toLowerCase() === 'q') {
            console.log(chalk.yellow('👋 Exiting feedback collection...'));
            return;
        }

        if (!choice || choice === '') {
            console.log(chalk.gray('Skipping feedback collection.'));
            return;
        }

        if (choice.toLowerCase() === 'all') {
            await this.collectOverallFeedback(conversationId);
        } else {
            const messageIndex = parseInt(choice) - 1;
            if (messageIndex >= 0 && messageIndex < messages.length) {
                await this.collectMessageFeedback(conversationId, messages[messageIndex], messageIndex + 1);
            } else {
                console.log(chalk.red('Invalid message number.'));
            }
        }
    }

    /**
     * Collect overall conversation feedback
     */
    async collectOverallFeedback(conversationId) {
        console.log(chalk.blue.bold('\n📊 Overall Conversation Feedback'));
        
        const score = await this.askQuestion('Overall quality (-1/0/1): ');
        const comment = await this.askQuestion('What should improve? ');
        
        const feedbackScore = parseInt(score);
        if (isNaN(feedbackScore) || feedbackScore < -1 || feedbackScore > 1) {
            console.log(chalk.red('Invalid score. Must be -1, 0, or 1.'));
            return;
        }

        await this.saveFeedback({
            conversation_id: conversationId,
            user_id: 'human_reviewer',
            circle_id: conversationId,
            score: feedbackScore,
            comment: comment,
            feedback_type: 'overall',
            timestamp: Date.now()
        });

        console.log(chalk.green('✅ Overall feedback saved!'));
    }

    /**
     * Collect feedback on specific message
     */
    async collectMessageFeedback(conversationId, message, messageNumber) {
        console.log(chalk.blue.bold(`\n💬 Message ${messageNumber} Feedback`));
        console.log(`Message: ${message.message}`);
        
        const score = await this.askQuestion('Message quality (-1/0/1): ');
        const comment = await this.askQuestion('What should improve? ');
        
        const feedbackScore = parseInt(score);
        if (isNaN(feedbackScore) || feedbackScore < -1 || feedbackScore > 1) {
            console.log(chalk.red('Invalid score. Must be -1, 0, or 1.'));
            return;
        }

        await this.saveFeedback({
            conversation_id: conversationId,
            user_id: 'human_reviewer',
            circle_id: conversationId,
            message_id: message.message_id,
            score: feedbackScore,
            comment: comment,
            feedback_type: 'message',
            timestamp: Date.now()
        });

        console.log(chalk.green('✅ Message feedback saved!'));
    }

    /**
     * Save feedback to database
     */
    async saveFeedback(feedbackData) {
        await this.db.run(`
            INSERT INTO feedback (
                conversation_id, user_id, circle_id, message_id, 
                score, comment, feedback_type, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            feedbackData.conversation_id,
            feedbackData.user_id,
            feedbackData.circle_id,
            feedbackData.message_id || null,
            feedbackData.score,
            feedbackData.comment,
            feedbackData.feedback_type,
            feedbackData.timestamp
        ]);
    }

    /**
     * Get recent conversations that might need feedback
     */
    async getRecentConversations() {
        return await this.db.all(`
            SELECT 
                circle_id as conversation_id,
                COUNT(*) as message_count,
                MAX(timestamp) as last_message
            FROM messages 
            WHERE timestamp > ? 
            GROUP BY circle_id 
            ORDER BY last_message DESC 
            LIMIT 10
        `, [Date.now() - 24 * 60 * 60 * 1000]); // Last 24 hours
    }

    /**
     * Get messages for a specific conversation
     */
    async getConversationMessages(conversationId) {
        return await this.db.all(`
            SELECT message_id, role, message, timestamp
            FROM messages 
            WHERE circle_id = ? 
            ORDER BY timestamp ASC
        `, [conversationId]);
    }

    /**
     * Select conversation from list
     */
    async selectConversation(conversations) {
        console.log('\nSelect conversation to review:');
        conversations.forEach((conv, index) => {
            console.log(`  ${index + 1}. ${conv.conversation_id} (${conv.message_count} messages)`);
        });
        console.log(`  ${conversations.length + 1}. Skip`);

        const choice = await this.askQuestion(`\nChoice (1-${conversations.length + 1}): `);
        const index = parseInt(choice) - 1;
        
        if (index >= 0 && index < conversations.length) {
            return conversations[index];
        }
        return null;
    }

    /**
     * Ask user a question
     */
    async askQuestion(question) {
        return new Promise(resolve => {
            this.rl.question(question, resolve);
        });
    }

    /**
     * Cleanup
     */
    cleanup() {
        if (this.rl) {
            this.rl.close();
        }
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
🎯 Human Feedback Collection CLI

Usage:
  node collect_feedback.js [options]

Options:
  --live, -l        Monitor live conversations for feedback opportunities
  --recent, -r      Review recent conversations
  --conversation ID Review specific conversation
  --help, -h        Show this help

Examples:
  node collect_feedback.js --live                    # Monitor live conversations
  node collect_feedback.js --recent                  # Review recent conversations
  node collect_feedback.js cli_patient_1             # Review specific conversation
        `);
        process.exit(0);
    }

    const collector = new HumanFeedbackCollector();
    
    try {
        await collector.initialize();
        
        if (args.includes('--live') || args.includes('-l')) {
            await collector.monitorLiveConversations();
        } else if (args.includes('--recent') || args.includes('-r')) {
            const recentConversations = await collector.getRecentConversations();
            if (recentConversations.length > 0) {
                const selectedConv = await collector.selectConversation(recentConversations);
                if (selectedConv) {
                    await collector.reviewConversation(selectedConv.conversation_id);
                }
            } else {
                console.log(chalk.yellow('No recent conversations found.'));
            }
        } else if (args.length > 0) {
            // Review specific conversation
            const conversationId = args[0];
            await collector.reviewConversation(conversationId);
        } else {
            console.log(chalk.red('Please specify an option. Use --help for usage information.'));
        }
    } catch (error) {
        console.error(chalk.red('Error:'), error.message);
    } finally {
        collector.cleanup();
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
