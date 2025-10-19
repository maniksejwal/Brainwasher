/**
 * @fileoverview Dashboard Operations Module
 * Handles all dashboard operations and external tool integration
 */

import { spawn } from 'child_process';
import chalk from 'chalk';
import { SCENARIOS } from '../../training/simulation/scenarios.js';
import { FeedbackAnalyzer } from '../../training/analysis/feedback_analyzer.js';
import { IssueAnalyzer } from '../../training/analysis/issue_analyzer.js';

export class DashboardOperations {
    constructor(core, menu) {
        this.core = core;
        this.menu = menu;
        this.db = core.getDb();
    }

    /**
     * Run new simulation
     */
    async runNewSimulation() {
        try {
            console.log(chalk.cyan.bold('\n🚀 RUN NEW SIMULATION'));
            console.log('-'.repeat(40));

            // Select scenario
            const scenarioKey = await this.menu.showScenarioMenu(SCENARIOS);
            if (!scenarioKey) return;

            let scenario;
            let actualScenarioKey = scenarioKey;
            
            if (scenarioKey === 'random') {
                // Get random scenario
                const scenarioKeys = Object.keys(SCENARIOS);
                actualScenarioKey = scenarioKeys[Math.floor(Math.random() * scenarioKeys.length)];
                scenario = SCENARIOS[actualScenarioKey];
                console.log(`\nSelected: ${chalk.yellow('🎲 Random Scenario')}`);
                console.log(`Chosen: ${scenario.name}`);
            } else {
                scenario = SCENARIOS[scenarioKey];
                console.log(`\nSelected: ${scenario.name}`);
            }
            
            console.log(`Description: ${scenario.description}`);

            // Get turn count - use sessions for multi-session scenarios, turns for single-session
            const defaultTurns = scenario.multiSession ? scenario.sessions : (scenario.turns || 5);
            const turns = await this.menu.askForTurnCount(defaultTurns);

            console.log(chalk.yellow(`\nStarting simulation: ${actualScenarioKey} (${turns} turns)...`));
            
            // Run simulation
            const simProcess = spawn('node', ['cli/run_simulation.js', actualScenarioKey, '--turns', turns.toString()], {
                stdio: 'inherit',
                shell: true
            });

            simProcess.on('close', async (code) => {
                if (code === 0) {
                    console.log(chalk.green('\n✅ Simulation completed successfully!'));
                } else {
                    console.log(chalk.red(`\n❌ Simulation failed with code ${code}`));
                }
                await this.menu.pause();
            });

        } catch (error) {
            console.error(chalk.red('Error running simulation:'), error.message);
            await this.menu.pause();
        }
    }

    /**
     * View simulation details
     */
    async viewSimulationDetails() {
        try {
            console.log(chalk.cyan.bold('\n🔍 VIEW SIMULATION DETAILS'));
            console.log('-'.repeat(40));

            // Get recent conversations
            const recentConversations = await this.getRecentConversations(10);
            
            // Show conversation selection menu
            const conversationId = await this.menu.showConversationMenu(recentConversations);
            if (!conversationId) return;

            await this.showSimulationDetails(conversationId);

        } catch (error) {
            console.error(chalk.red('Error viewing simulation details:'), error.message);
            await this.menu.pause();
        }
    }

    /**
     * Show simulation details
     */
    async showSimulationDetails(conversationId) {
        try {
            // Get simulation data
            const simulation = await this.db.get(`
                SELECT * FROM feedback 
                WHERE conversation_id = ? AND source = 'simulation'
                ORDER BY timestamp DESC 
                LIMIT 1
            `, [conversationId]);

            if (!simulation) {
                console.log(chalk.red('Simulation not found'));
                await this.menu.pause();
                return;
            }

            console.log(chalk.green.bold('\n📊 SIMULATION DETAILS'));
            console.log('-'.repeat(40));
            console.log(`Conversation ID: ${simulation.conversation_id}`);
            console.log(`Score: ${simulation.score}`);
            console.log(`Critical Failure: ${simulation.critical_failure ? 'Yes' : 'No'}`);
            console.log(`Timestamp: ${new Date(simulation.timestamp).toLocaleString()}`);
            console.log(`Prompt Version: ${simulation.prompt_version || 'Unknown'}`);

            // Goal performance
            if (simulation.goal_adherence_score || simulation.goal_history_score || simulation.goal_conversation_score) {
                console.log(chalk.cyan.bold('\n🎯 GOAL PERFORMANCE'));
                console.log(`Adherence: ${simulation.goal_adherence_score || 0}`);
                console.log(`History: ${simulation.goal_history_score || 0}`);
                console.log(`Conversation: ${simulation.goal_conversation_score || 0}`);
            }

            // Extract circle ID from conversation ID
            // Conversation ID format: sim_1760897668480_cli_patient_1_4
            // Circle ID format: cli_patient_1
            const circleIdMatch = conversationId.match(/sim_\d+_(.+)_\d+$/);
            const circleId = circleIdMatch ? circleIdMatch[1] : conversationId;
            
            console.log(chalk.gray(`Debug: Conversation ID: ${conversationId}`));
            console.log(chalk.gray(`Debug: Extracted Circle ID: ${circleId}`));
            
            // Get conversation messages
            const messages = await this.db.all(`
                SELECT user_id, message, timestamp 
                FROM messages 
                WHERE circle_id = ? 
                ORDER BY timestamp ASC
            `, [circleId]);
            
            console.log(chalk.gray(`Debug: Found ${messages.length} messages`));
            
            // Debug: Show all user IDs found
            const uniqueUserIds = [...new Set(messages.map(m => m.user_id))];
            console.log(chalk.gray(`Debug: Unique user IDs: ${uniqueUserIds.join(', ')}`));
            
            // Debug: Show sample messages
            if (messages.length > 0) {
                console.log(chalk.gray('Debug: Sample messages:'));
                messages.slice(0, 3).forEach((msg, index) => {
                    console.log(chalk.gray(`  ${index + 1}. [${msg.user_id}] ${msg.message.substring(0, 50)}...`));
                });
            }

            if (messages.length > 0) {
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
            }

            // Get detailed feedback
            const detailedFeedback = await this.db.all(`
                SELECT * FROM detailed_feedback 
                WHERE conversation_id = ?
                ORDER BY timestamp ASC
            `, [conversationId]);

            if (detailedFeedback.length > 0) {
                console.log(chalk.cyan.bold('\n📝 DETAILED FEEDBACK'));
                detailedFeedback.forEach(feedback => {
                    console.log(`- ${feedback.category}: ${feedback.description}`);
                });
            }

            await this.menu.pause();

        } catch (error) {
            console.error(chalk.red('Error showing simulation details:'), error.message);
        }
    }

    /**
     * Analyze performance
     */
    async analyzePerformance() {
        try {
            console.log(chalk.cyan.bold('\n📈 PERFORMANCE ANALYSIS'));
            console.log('-'.repeat(40));

            // Run analysis tools
            console.log(chalk.yellow('Running performance analysis...'));
            
            const analysisProcess = spawn('node', ['cli/analyze_rewards.js'], {
                stdio: 'inherit',
                shell: true
            });

            analysisProcess.on('close', async (code) => {
                if (code === 0) {
                    console.log(chalk.green('\n✅ Analysis completed successfully!'));
                } else {
                    console.log(chalk.red(`\n❌ Analysis failed with code ${code}`));
                }
                await this.menu.pause();
            });

        } catch (error) {
            console.error(chalk.red('Error analyzing performance:'), error.message);
            await this.menu.pause();
        }
    }

    /**
     * Manage scenarios
     */
    async manageScenarios() {
        const choice = await this.menu.showScenarioManagementMenu();
        
        switch (choice) {
            case '1':
                await this.listScenarios();
                break;
            case '2':
                await this.viewScenarioDetails();
                break;
            case '3':
                await this.runBatchTests();
                break;
            case '4':
                await this.runAllScenarios();
                break;
            default:
                return;
        }
    }

    /**
     * List all scenarios
     */
    async listScenarios() {
        console.log(chalk.cyan.bold('\n📋 ALL SCENARIOS'));
        console.log('-'.repeat(60));
        
        Object.entries(SCENARIOS).forEach(([key, scenario]) => {
            console.log(`${chalk.green(key)}: ${scenario.name}`);
            console.log(`  ${scenario.description}`);
            console.log(`  Category: ${scenario.category} | Complexity: ${scenario.complexity}`);
            console.log('');
        });

        await this.menu.pause();
    }

    /**
     * View scenario details
     */
    async viewScenarioDetails() {
        const scenarioKey = await this.menu.showScenarioMenu(SCENARIOS);
        if (!scenarioKey) return;

        const scenario = SCENARIOS[scenarioKey];
        
        console.log(chalk.green.bold(`\n📋 ${scenario.name}`));
        console.log('-'.repeat(60));
        console.log(`Description: ${scenario.description}`);
        console.log(`Category: ${scenario.category}`);
        console.log(`Complexity: ${scenario.complexity}`);
        console.log(`Turns: ${scenario.turns || 'Default'}`);
        
        if (scenario.users) {
            console.log('\nUsers:');
            scenario.users.forEach(user => {
                console.log(`  - ${user.role}: ${user.personaKey}`);
            });
        }
        
        if (scenario.instructions) {
            console.log(`\nInstructions: ${scenario.instructions}`);
        }

        await this.menu.pause();
    }

    /**
     * Run batch tests
     */
    async runBatchTests() {
        console.log(chalk.yellow('\nRunning batch tests...'));
        
        const batchProcess = spawn('node', ['training/simulation/scenario_runner.js'], {
            stdio: 'inherit',
            shell: true
        });

        batchProcess.on('close', async (code) => {
            if (code === 0) {
                console.log(chalk.green('\n✅ Batch tests completed successfully!'));
            } else {
                console.log(chalk.red(`\n❌ Batch tests failed with code ${code}`));
            }
            await this.menu.pause();
        });
    }

    /**
     * Run all scenarios
     */
    async runAllScenarios() {
        const confirmed = await this.menu.askConfirmation('Run all scenarios? This may take a while.');
        if (!confirmed) return;

        console.log(chalk.yellow('\nRunning all scenarios...'));
        
        const batchProcess = spawn('node', ['training/simulation/scenario_runner.js', '--all'], {
            stdio: 'inherit',
            shell: true
        });

        batchProcess.on('close', async (code) => {
            if (code === 0) {
                console.log(chalk.green('\n✅ All scenarios completed successfully!'));
            } else {
                console.log(chalk.red(`\n❌ Scenarios failed with code ${code}`));
            }
            await this.menu.pause();
        });
    }

    /**
     * View feedback
     */
    async viewFeedback() {
        const choice = await this.menu.showFeedbackMenu();
        
        switch (choice) {
            case '1':
                await this.viewAllFeedback();
                break;
            case '2':
                await this.viewHumanFeedback();
                break;
            case '3':
                await this.viewCriticalFailures();
                break;
            case '4':
                await this.viewGoalPerformance();
                break;
            default:
                return;
        }
    }

    /**
     * View all feedback
     */
    async viewAllFeedback() {
        console.log(chalk.yellow('\nOpening feedback viewer...'));
        
        const feedbackProcess = spawn('node', ['cli/view_feedback.js', '--all'], {
            stdio: 'inherit',
            shell: true
        });

        feedbackProcess.on('close', async () => {
            await this.menu.pause();
        });
    }

    /**
     * View human feedback
     */
    async viewHumanFeedback() {
        console.log(chalk.yellow('\nOpening human feedback viewer...'));
        
        const feedbackProcess = spawn('node', ['cli/view_feedback.js', '--real'], {
            stdio: 'inherit',
            shell: true
        });

        feedbackProcess.on('close', async () => {
            await this.menu.pause();
        });
    }

    /**
     * View critical failures
     */
    async viewCriticalFailures() {
        console.log(chalk.yellow('\nOpening critical failures viewer...'));
        
        const failuresProcess = spawn('node', ['cli/view_feedback.js', '--failures'], {
            stdio: 'inherit',
            shell: true
        });

        failuresProcess.on('close', async () => {
            await this.menu.pause();
        });
    }

    /**
     * View goal performance
     */
    async viewGoalPerformance() {
        console.log(chalk.yellow('\nOpening goal performance viewer...'));
        
        const goalsProcess = spawn('node', ['cli/view_feedback.js', '--goals'], {
            stdio: 'inherit',
            shell: true
        });

        goalsProcess.on('close', async () => {
            await this.menu.pause();
        });
    }

    /**
     * Batch operations
     */
    async batchOperations() {
        const choice = await this.menu.showBatchOperationsMenu();
        
        switch (choice) {
            case '1':
                await this.runBatchAnalysis();
                break;
            case '2':
                await this.generatePerformanceReport();
                break;
            case '3':
                await this.cleanOldData();
                break;
            case '4':
                await this.exportData();
                break;
            default:
                return;
        }
    }

    /**
     * Run batch analysis
     */
    async runBatchAnalysis() {
        console.log(chalk.yellow('\nRunning comprehensive analysis...'));
        
        const analysisProcess = spawn('node', ['cli/analyze_failures.js'], {
            stdio: 'inherit',
            shell: true
        });

        analysisProcess.on('close', async (code) => {
            if (code === 0) {
                console.log(chalk.green('\n✅ Analysis completed successfully!'));
            } else {
                console.log(chalk.red(`\n❌ Analysis failed with code ${code}`));
            }
            await this.menu.pause();
        });
    }

    /**
     * Generate performance report
     */
    async generatePerformanceReport() {
        console.log(chalk.yellow('\nGenerating performance report...'));
        
        const reportProcess = spawn('node', ['cli/view_feedback.js', '--prompts'], {
            stdio: 'inherit',
            shell: true
        });

        reportProcess.on('close', async () => {
            await this.menu.pause();
        });
    }

    /**
     * Clean old data
     */
    async cleanOldData() {
        const confirmed = await this.menu.askConfirmation('Clean old simulation data? This cannot be undone.');
        if (!confirmed) return;

        try {
            const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            
            await this.db.run(`
                DELETE FROM feedback 
                WHERE source = 'simulation' AND timestamp < ?
            `, [oneWeekAgo]);
            
            await this.db.run(`
                DELETE FROM detailed_feedback 
                WHERE source = 'simulation' AND timestamp < ?
            `, [oneWeekAgo]);
            
            console.log(chalk.green('✅ Old data cleaned successfully!'));
            
        } catch (error) {
            console.error(chalk.red('Error cleaning data:'), error.message);
        }
        
        await this.menu.pause();
    }

    /**
     * Export data
     */
    async exportData() {
        console.log(chalk.yellow('\nExporting data...'));
        
        const exportProcess = spawn('node', ['cli/view_feedback.js', '--all'], {
            stdio: 'pipe',
            shell: true
        });

        let output = '';
        exportProcess.stdout.on('data', (data) => {
            output += data.toString();
        });

        exportProcess.on('close', async (code) => {
            if (code === 0) {
                // Save to file
                const fs = await import('fs/promises');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const filename = `simulation_export_${timestamp}.txt`;
                
                await fs.writeFile(filename, output);
                console.log(chalk.green(`✅ Data exported to ${filename}`));
            } else {
                console.log(chalk.red('❌ Export failed'));
            }
            await this.menu.pause();
        });
    }

    /**
     * System status
     */
    async systemStatus() {
        console.log(chalk.cyan.bold('\n⚙️ SYSTEM STATUS'));
        console.log('-'.repeat(40));

        try {
            // Database connectivity
            const dbTest = await this.db.get('SELECT 1 as test');
            console.log(`Database: ${chalk.green('Connected')}`);

            // Recent activity
            const recentActivity = await this.db.get(`
                SELECT COUNT(*) as count 
                FROM feedback 
                WHERE timestamp > ?
            `, [Date.now() - (24 * 60 * 60 * 1000)]);
            
            console.log(`Recent Activity: ${chalk.green(recentActivity.count)} interactions`);

            // System health
            const criticalFailures = await this.db.get(`
                SELECT COUNT(*) as count 
                FROM feedback 
                WHERE critical_failure = 1 AND timestamp > ?
            `, [Date.now() - (24 * 60 * 60 * 1000)]);
            
            const healthStatus = criticalFailures.count === 0 ? 'Healthy' : 'Issues Detected';
            const healthColor = criticalFailures.count === 0 ? 'green' : 'red';
            console.log(`System Health: ${chalk[healthColor](healthStatus)}`);

            // Available scenarios
            const scenarioCount = Object.keys(SCENARIOS).length;
            console.log(`Available Scenarios: ${chalk.green(scenarioCount)}`);

        } catch (error) {
            console.error(chalk.red('Error checking system status:'), error.message);
        }

        await this.menu.pause();
    }

    /**
     * Analyze performance using unified analysis tool
     */
    async analyzePerformance() {
        try {
            console.log(chalk.cyan.bold('\n📊 ANALYZE PERFORMANCE'));
            console.log('-'.repeat(40));
            
            const analysisType = await this.menu.askQuestion('Analysis type (prompts/rewards/failures/optimize/all): ');
            
            if (!['prompts', 'rewards', 'failures', 'optimize', 'all'].includes(analysisType)) {
                console.log(chalk.red('Invalid analysis type.'));
                await this.menu.pause();
                return;
            }
            
            console.log(chalk.yellow(`Running ${analysisType} analysis...`));
            
            // Use the unified analyze tool
            const analyzeProcess = spawn('node', ['cli/analyze.js', analysisType], {
                stdio: 'inherit',
                shell: true
            });
            
            analyzeProcess.on('close', async (code) => {
                if (code === 0) {
                    console.log(chalk.green('\n✅ Analysis completed successfully!'));
                } else {
                    console.log(chalk.red(`\n❌ Analysis failed with code ${code}`));
                }
                await this.menu.pause();
            });
            
        } catch (error) {
            console.error(chalk.red('Error running analysis:'), error.message);
            await this.menu.pause();
        }
    }
    
    /**
     * Get recent conversations for selection
     * @param {number} limit - Number of recent conversations to get
     * @returns {Array} - Array of recent conversations
     */
    async getRecentConversations(limit = 10) {
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
            console.error(chalk.red('Error getting recent conversations:'), error.message);
            return [];
        }
    }
}
