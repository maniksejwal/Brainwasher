#!/usr/bin/env node

/**
 * @fileoverview Simplified Simulation Dashboard CLI
 * Single-level menu for better usability
 */

import chalk from 'chalk';
import { getDb } from '../db/connection.js';
import { spawn } from 'child_process';
import { SCENARIOS } from '../training/simulation/scenarios.js';
import { getScenarioCategories, displayScenariosByCategory } from '../training/simulation/scenario_categories.js';
import { parseConversationId, extractCareCircleId } from '../utils/conversation_ids.js';
import { readlineManager } from './readline_manager.js';

class SimpleDashboard {
    constructor() {
        this.db = null;
    }

    async initialize() {
        process.env.SIMULATION_MODE = 'true';
        this.db = await getDb();
    }

    async selectScenario() {
        console.log(chalk.cyan('\n🎯 Select Scenario'));
        console.log('-'.repeat(40));
        
        // Use centralized scenario display with numbers
        const options = displayScenariosByCategory(true);

        console.log(`\n  ${(options.length + 1).toString().padStart(2)}. 🎲 Random scenario`);
        options.push({ key: 'random', scenario: null });

        const choice = await readlineManager.askQuestion(`\nSelect scenario (1-${options.length}): `);
        const choiceNum = parseInt(choice);
        
        if (isNaN(choiceNum) || choiceNum < 1 || choiceNum > options.length) {
            console.log(chalk.yellow('Invalid choice. Using random scenario.'));
            const randomKey = Object.keys(SCENARIOS)[Math.floor(Math.random() * Object.keys(SCENARIOS).length)];
            return randomKey;
        }

        const selected = options[choiceNum - 1];
        if (selected.key === 'random') {
            const randomKey = Object.keys(SCENARIOS)[Math.floor(Math.random() * Object.keys(SCENARIOS).length)];
            return randomKey;
        }

        return selected.key;
    }

    async askQuestion(question) {
        return await readlineManager.askQuestion(question);
    }

    async showMainMenu() {
        console.log(chalk.cyan.bold('\n🎯 SIMULATION DASHBOARD'));
        console.log('-'.repeat(40));
        console.log('1. Run New Simulation');
        console.log('2. Run World Simulation');
        console.log('3. View Recent Conversations');
        console.log('4. Analyze Performance');
        console.log('5. Prompt Management');
        console.log('6. Exit');
        console.log('-'.repeat(40));

        const choice = await this.askQuestion('Select option (1-6): ');
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
        // Handle human feedback IDs
        if (conversationId.startsWith('cli_sim_')) {
            return 'Human Feedback';
        }
        
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
        
        // Get scenario selection from user first
        const scenarioKey = await this.selectScenario();
        if (!scenarioKey) {
            console.log(chalk.yellow('❌ No scenario selected. Returning to menu.'));
            return;
        }
        
        // Stop dashboard's readline to prevent conflicts
        console.log(chalk.gray('📱 Stopping dashboard interface...'));
        readlineManager.cleanup();
        
        // Pass scenario as argument to simulation (with feedback enabled by default)
        // Note: Feedback is enabled by default unless --skip-feedback is explicitly passed
        const process = spawn('node', ['cli/run_simulation.js', `--scenario=${scenarioKey}`, '--from-dashboard'], { 
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
                
                // Simply resolve and let the main loop handle the exit
                resolve();
            });
            
            process.on('error', (error) => {
                console.log(chalk.red(`\n❌ Simulation error: ${error.message}`));
                resolve();
            });
        });
    }

    async viewRecentConversations() {
        try {
            const conversations = await this.db.all(`
                SELECT 
                    conversation_id,
                    AVG(score) as avg_score,
                    MAX(timestamp) as latest_timestamp,
                    MAX(critical_failure) as has_critical_failure,
                    COUNT(*) as feedback_count
                FROM feedback 
                GROUP BY conversation_id
                ORDER BY latest_timestamp DESC 
                LIMIT 10
            `);

            if (conversations.length === 0) {
                console.log(chalk.yellow('No recent conversations found.'));
                return;
            }

            console.log(chalk.cyan.bold('\n📊 RECENT CONVERSATIONS'));
            console.log('-'.repeat(80));
            conversations.forEach((conv, index) => {
                const status = conv.critical_failures > 0 ? '⚠️' : '✅';
                const criticalText = conv.critical_failures > 0 ? ` (${conv.critical_failures} critical)` : '';
                const date = new Date(conv.latest_timestamp).toLocaleString();
                const scenario = this.extractScenarioFromConversationId(conv.conversation_id);
                const scenarioName = this.getScenarioDisplayName(scenario);
                const scoreDisplay = conv.feedback_count > 1 ? 
                    `${conv.avg_score.toFixed(1)} (${conv.feedback_count} entries)` : 
                    conv.avg_score.toString();
                console.log(`${index + 1}. ${status} ${conv.conversation_id} | Score: ${scoreDisplay}${criticalText} | ${scenarioName} | ${date}`);
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
            console.log(chalk.gray(`Debug: Looking for messages with conversation_id = ${conversationId}`));
            
            // Use conversation ID to match either conversation_id or circle_id fields
            const messages = await this.db.all(`
                SELECT user_id, message, timestamp 
                FROM messages 
                WHERE circle_id = ? 
                ORDER BY timestamp ASC
            `, [conversationId]);
            
            console.log(chalk.gray(`Debug: Found ${messages.length} messages for conversation ${conversationId}`));

            if (messages.length === 0) {
                // Try alternative: look for any messages with similar timestamp pattern
                const timestampMatch = conversationId.match(/(\d+)$/);
                if (timestampMatch) {
                    const timestamp = timestampMatch[1];
                    const nearbyMessages = await this.db.all(`
                        SELECT user_id, message, timestamp, circle_id
                        FROM messages 
                        WHERE circle_id LIKE ? OR circle_id LIKE ?
                        ORDER BY timestamp DESC
                        LIMIT 20
                    `, [`%${timestamp}%`, `sim_${timestamp}%`]);
                    
                    if (nearbyMessages.length > 0) {
                        console.log(chalk.yellow(`\n⚠️  No exact match found. Showing nearby conversation (${nearbyMessages.length} messages):`));
                        nearbyMessages.forEach((msg, index) => {
                            const time = new Date(msg.timestamp).toLocaleTimeString();
                            const speaker = msg.user_id === 'agent' ? 'AGENT' :
                                          msg.user_id.includes('patient') ? 'PATIENT' : 
                                          msg.user_id.includes('caregiver') ? 'CAREGIVER' : 
                                          msg.user_id.includes('doctor') ? 'DOCTOR' : 
                                          msg.user_id.toUpperCase();
                            console.log(`${index + 1}. [${time}] ${speaker}: ${msg.message.substring(0, 100)}${msg.message.length > 100 ? '...' : ''}`);
                        });
                        return;
                    }
                }
                
                console.log(chalk.yellow('No messages found for this conversation.'));
                console.log(chalk.gray('This may be old feedback from before message storage was implemented.'));
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
                        // Exit after simulation to avoid readline issues
                        console.log(chalk.cyan('\n🔄 Simulation completed. Exiting dashboard.'));
                        console.log(chalk.gray('💡 Run `node cli/simple_dashboard.js` to restart.'));
                        this.cleanup();
                        return;
                    case '2':
                        await this.runWorldSimulation();
                        // Exit after simulation to avoid readline issues
                        console.log(chalk.cyan('\n🔄 World simulation completed. Exiting dashboard.'));
                        console.log(chalk.gray('💡 Run `node cli/simple_dashboard.js` to restart.'));
                        this.cleanup();
                        return;
                    case '3':
                        await this.viewRecentConversations();
                        break;
                    case '4':
                        await this.analyzePerformance();
                        break;
                    case '5':
                        await this.openPromptManagement();
                        break;
                    case '6':
                        console.log(chalk.green('👋 Goodbye!'));
                        this.cleanup();
                        process.exit(0);
                        return;
                    default:
                        console.log(chalk.red('Invalid choice. Please enter 1-6.'));
                }
                
                await this.askQuestion('\nPress Enter to continue...');
            }
        } catch (error) {
            console.error(chalk.red('Dashboard error:'), error.message);
        } finally {
            this.cleanup();
        }
    }

    async runWorldSimulation() {
        console.log(chalk.cyan('🌍 Launching world simulation...'));
        
        // Stop dashboard's readline to prevent conflicts
        console.log(chalk.gray('📱 Stopping dashboard interface...'));
        readlineManager.cleanup();
        
        // Spawn world simulation CLI
        const { spawn } = await import('child_process');
        const process = spawn('node', ['cli/world_simulation_cli.js'], { 
            stdio: 'inherit', 
            shell: true,
            detached: false
        });
        
        return new Promise((resolve) => {
            process.on('close', (code) => {
                if (code === 0) {
                    console.log(chalk.green('\n✅ World simulation completed!'));
                } else {
                    console.log(chalk.red(`\n❌ World simulation failed with code ${code}`));
                }
                resolve();
            });
            
            process.on('error', (error) => {
                console.log(chalk.red(`\n❌ World simulation error: ${error.message}`));
                resolve();
            });
        });
    }

    async openPromptManagement() {
        const { PromptDashboard } = await import('./dashboard/prompts.js');
        const promptDashboard = new PromptDashboard();
        await promptDashboard.run();
    }

    cleanup() {
        // Actually clean up the readline interface
        readlineManager.cleanup();
    }
}

// Run the dashboard
const dashboard = new SimpleDashboard();
dashboard.run().catch(console.error);
