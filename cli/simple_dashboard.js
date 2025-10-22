#!/usr/bin/env node

/**
 * @fileoverview Simplified Simulation Dashboard CLI
 * Single-level menu for better usability
 */

import chalk from 'chalk';
import { getDb } from '../db/connection.js';
import { spawn } from 'child_process';
import { SCENARIOS } from '../training/simulation/scenarios.js';
import { parseConversationId, extractCareCircleId } from '../utils/conversation_ids.js';

class SimpleDashboard {
    constructor() {
        this.db = null;
    }

    async initialize() {
        process.env.SIMULATION_MODE = 'true';
        this.db = await getDb();
    }

    async askQuestion(question) {
        const readline = await import('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true
        });
        
        return new Promise(resolve => {
            rl.question(chalk.yellow(question), (answer) => {
                rl.close();
                resolve(answer);
            });
        });
    }

    async showMainMenu() {
        console.log(chalk.cyan.bold('\n🎯 SIMULATION DASHBOARD'));
        console.log('-'.repeat(40));
        console.log('1. Run New Simulation');
        console.log('2. View Recent Conversations');
        console.log('3. Analyze Performance');
        console.log('4. Exit');
        console.log('-'.repeat(40));

        const choice = await this.askQuestion('Select option (1-4): ');
        return choice.trim();
    }

    getScenarioDisplayName(scenarioKey) {
        const scenario = SCENARIOS[scenarioKey];
        if (scenario) {
            return scenario.name;
        }
        return scenarioKey || 'unknown';
    }

    extractScenarioFromConversationId(conversationId) {
        // Try to parse using new conversation ID system
        const parsed = parseConversationId(conversationId);
        
        if (parsed.type === 'conversation' && parsed.scenario) {
            return parsed.scenario;
        }
        
        if (parsed.type === 'care_circle' && parsed.scenario) {
            return parsed.scenario;
        }
        
        // Fallback to old format parsing
        const parts = conversationId.split('_');
        if (parts.length >= 3) {
            // Look for known scenario keys
            const knownScenarios = Object.keys(SCENARIOS);
            for (let i = 2; i < parts.length; i++) {
                const potentialScenario = parts.slice(2, i + 1).join('_');
                if (knownScenarios.includes(potentialScenario)) {
                    return potentialScenario;
                }
            }
            // Fallback to just the 3rd part
            return parts[2];
        }
        return 'unknown';
    }

    async runNewSimulation() {
        console.log(chalk.cyan('🎯 Launching simulation...'));
        
        const process = spawn('node', ['cli/run_simulation.js'], { 
            stdio: 'inherit', 
            shell: true,
            detached: false
        });
        
        return new Promise((resolve) => {
            process.on('close', (code) => {
                if (code === 0) {
                    console.log(chalk.green('\n✅ Simulation completed!'));
                } else {
                    console.log(chalk.red(`\n❌ Simulation failed with code ${code}`));
                }
                resolve();
            });
        });
    }

    async viewRecentConversations() {
        try {
            const conversations = await this.db.all(`
                SELECT DISTINCT conversation_id, score, timestamp, critical_failure
                FROM feedback 
                ORDER BY timestamp DESC 
                LIMIT 10
            `);

            if (conversations.length === 0) {
                console.log(chalk.yellow('No recent conversations found.'));
                return;
            }

            console.log(chalk.cyan.bold('\n📊 RECENT CONVERSATIONS'));
            console.log('-'.repeat(80));
            conversations.forEach((conv, index) => {
                const status = conv.critical_failure ? '❌' : '✅';
                const date = new Date(conv.timestamp).toLocaleString();
                const scenario = this.extractScenarioFromConversationId(conv.conversation_id);
                const scenarioName = this.getScenarioDisplayName(scenario);
                console.log(`${index + 1}. ${status} ${conv.conversation_id} | Score: ${conv.score} | ${scenarioName} | ${date}`);
            });

            const choice = await this.askQuestion('\nSelect conversation (1-10) or press Enter to go back: ');
            const choiceNum = parseInt(choice);
            
            if (choiceNum >= 1 && choiceNum <= conversations.length) {
                await this.showConversationDetails(conversations[choiceNum - 1].conversation_id);
            }
        } catch (error) {
            console.error(chalk.red('Error fetching conversations:'), error.message);
        }
    }

    async showConversationDetails(conversationId) {
        try {
            console.log(chalk.gray(`Debug: Looking for messages with circle_id = ${conversationId}`));
            
            // Use conversation ID directly for unified message retrieval
            const messages = await this.db.all(`
                SELECT user_id, message, timestamp 
                FROM messages 
                WHERE circle_id = ? 
                ORDER BY timestamp ASC
            `, [conversationId]);
            
            console.log(chalk.gray(`Debug: Found ${messages.length} messages for conversation ${conversationId}`));

            if (messages.length === 0) {
                console.log(chalk.yellow('No messages found for this conversation.'));
                console.log(chalk.gray('Debug: Checking if there are any messages in the database...'));
                
                // Debug: Show all circle_ids in the database
                const allCircleIds = await this.db.all(`
                    SELECT DISTINCT circle_id 
                    FROM messages 
                    ORDER BY circle_id DESC 
                    LIMIT 10
                `);
                console.log(chalk.gray('Debug: Recent circle_ids in database:'));
                allCircleIds.forEach((row, index) => {
                    console.log(chalk.gray(`  ${index + 1}. ${row.circle_id}`));
                });
                return;
            }

            console.log(chalk.cyan.bold('\n💬 CONVERSATION'));
            console.log('-'.repeat(40));
            messages.forEach((msg, index) => {
                const time = new Date(msg.timestamp).toLocaleTimeString();
                const speaker = msg.user_id === 'agent' ? 'AGENT' :
                              msg.user_id.includes('patient') ? 'PATIENT' : 
                              msg.user_id.includes('caregiver') ? 'CAREGIVER' : 
                              msg.user_id.includes('doctor') ? 'DOCTOR' : 
                              msg.user_id.toUpperCase();
                console.log(`${index + 1}. [${time}] ${speaker}: ${msg.message}`);
            });
        } catch (error) {
            console.error(chalk.red('Error fetching conversation:'), error.message);
        }
    }

    async analyzePerformance() {
        console.log(chalk.yellow('Running performance analysis...'));
        const process = spawn('node', ['cli/analyze.js', 'all'], { stdio: 'inherit', shell: true });
        
        return new Promise((resolve) => {
            process.on('close', (code) => {
                if (code === 0) {
                    console.log(chalk.green('\n✅ Analysis completed!'));
                } else {
                    console.log(chalk.red(`\n❌ Analysis failed with code ${code}`));
                }
                resolve();
            });
        });
    }

    async run() {
        try {
            await this.initialize();
            
            while (true) {
                const choice = await this.showMainMenu();
                
                switch (choice) {
                    case '1':
                        await this.runNewSimulation();
                        break;
                    case '2':
                        await this.viewRecentConversations();
                        break;
                    case '3':
                        await this.analyzePerformance();
                        break;
                    case '4':
                        console.log(chalk.green('👋 Goodbye!'));
                        this.cleanup();
                        return;
                    default:
                        console.log(chalk.red('Invalid choice. Please enter 1-4.'));
                }
                
                await this.askQuestion('\nPress Enter to continue...');
            }
        } catch (error) {
            console.error(chalk.red('Dashboard error:'), error.message);
        } finally {
            this.cleanup();
        }
    }

    cleanup() {
        // No persistent readline interface to clean up
    }
}

// Run the dashboard
const dashboard = new SimpleDashboard();
dashboard.run().catch(console.error);
