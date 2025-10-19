/**
 * @fileoverview Dashboard Menu Module
 * Handles all menu interactions and navigation
 */

import chalk from 'chalk';

export class DashboardMenu {
    constructor(core) {
        this.core = core;
    }

    /**
     * Show main menu
     */
    async showMainMenu() {
        console.log(chalk.cyan.bold('\n🎯 MAIN MENU'));
        console.log('-'.repeat(40));
        console.log('1. Run New Simulation');
        console.log('2. View Simulation Details');
        console.log('3. Analyze Performance');
        console.log('4. Manage Scenarios');
        console.log('5. View Feedback');
        console.log('6. Batch Operations');
        console.log('7. System Status');
        console.log('8. Refresh Dashboard');
        console.log('9. Exit');
        console.log('-'.repeat(40));

        const choice = await this.core.askQuestion('\nSelect an option (1-9): ');
        return choice.trim();
    }

    /**
     * Show scenario selection menu
     */
    async showScenarioMenu(scenarios) {
        console.log(chalk.cyan.bold('\n🎭 SELECT SCENARIO'));
        console.log('-'.repeat(40));
        
        const scenarioKeys = Object.keys(scenarios);
        
        // Add random option at the top
        console.log(`${chalk.yellow('1. 🎲 Random Scenario')}`);
        
        scenarioKeys.forEach((key, index) => {
            const scenario = scenarios[key];
            console.log(`${index + 2}. ${scenario.name}`);
        });
        
        console.log(`${scenarioKeys.length + 2}. Back to Main Menu`);
        console.log('-'.repeat(40));

        const choice = await this.core.askQuestion(`\nSelect scenario (1-${scenarioKeys.length + 2}): `);
        const choiceNum = parseInt(choice.trim());
        
        if (choiceNum === scenarioKeys.length + 2) {
            return null; // Back to main menu
        }
        
        if (choiceNum === 1) {
            return 'random'; // Special marker for random selection
        }
        
        if (choiceNum >= 2 && choiceNum <= scenarioKeys.length + 1) {
            return scenarioKeys[choiceNum - 2];
        }
        
        return null;
    }

    /**
     * Show feedback menu
     */
    async showFeedbackMenu() {
        console.log(chalk.cyan.bold('\n💬 FEEDBACK ANALYSIS'));
        console.log('-'.repeat(40));
        console.log('1. View All Feedback');
        console.log('2. View Human Feedback');
        console.log('3. View Critical Failures');
        console.log('4. View Goal Performance');
        console.log('5. Back to Main Menu');
        console.log('-'.repeat(40));

        const choice = await this.core.askQuestion('\nSelect an option (1-5): ');
        return choice.trim();
    }

    /**
     * Show batch operations menu
     */
    async showBatchOperationsMenu() {
        console.log(chalk.cyan.bold('\n⚡ BATCH OPERATIONS'));
        console.log('-'.repeat(40));
        console.log('1. Run Comprehensive Analysis');
        console.log('2. Generate Performance Report');
        console.log('3. Clean Old Data');
        console.log('4. Export Data');
        console.log('5. Back to Main Menu');
        console.log('-'.repeat(40));

        const choice = await this.core.askQuestion('\nSelect an option (1-5): ');
        return choice.trim();
    }

    /**
     * Show scenario management menu
     */
    async showScenarioManagementMenu() {
        console.log(chalk.cyan.bold('\n🎭 SCENARIO MANAGEMENT'));
        console.log('-'.repeat(40));
        console.log('1. List All Scenarios');
        console.log('2. View Scenario Details');
        console.log('3. Run Batch Tests');
        console.log('4. Run All Scenarios');
        console.log('5. Back to Main Menu');
        console.log('-'.repeat(40));

        const choice = await this.core.askQuestion('\nSelect an option (1-5): ');
        return choice.trim();
    }

    /**
     * Show turn count input
     */
    async askForTurnCount(defaultTurns = 5) {
        const turns = await this.core.askQuestion(`\nNumber of turns (default: ${defaultTurns}): `);
        const turnCount = parseInt(turns.trim()) || defaultTurns;
        return Math.max(1, Math.min(20, turnCount)); // Clamp between 1-20
    }

    /**
     * Show confirmation prompt
     */
    async askConfirmation(message) {
        const response = await this.core.askQuestion(`\n${message} (y/N): `);
        return response.toLowerCase().startsWith('y');
    }

    /**
     * Show conversation selection menu
     */
    async showConversationMenu(conversations) {
        console.log(chalk.cyan.bold('\n💬 SELECT CONVERSATION'));
        console.log('-'.repeat(60));
        
        if (conversations.length === 0) {
            console.log(chalk.gray('No recent conversations found'));
            console.log('1. Back to Main Menu');
            console.log('-'.repeat(60));
            const choice = await this.core.askQuestion('\nSelect option (1): ');
            return choice.trim() === '1' ? null : null;
        }
        
        conversations.forEach((conv, index) => {
            const status = conv.critical_failure ? chalk.red('❌') : chalk.green('✅');
            const score = conv.score ? conv.score.toFixed(1) : 'N/A';
            const timestamp = new Date(conv.timestamp).toLocaleString();
            
            console.log(`${index + 1}. ${status} ${chalk.bold(conv.conversation_id)}`);
            console.log(`   Score: ${score} | ${timestamp}`);
            console.log('');
        });
        
        console.log(`${conversations.length + 1}. Back to Main Menu`);
        console.log('-'.repeat(60));

        const choice = await this.core.askQuestion(`\nSelect conversation (1-${conversations.length + 1}): `);
        const choiceNum = parseInt(choice.trim());
        
        if (choiceNum === conversations.length + 1) {
            return null; // Back to main menu
        }
        
        if (choiceNum >= 1 && choiceNum <= conversations.length) {
            return conversations[choiceNum - 1].conversation_id;
        }
        
        return null;
    }

    /**
     * Show conversation ID input (fallback)
     */
    async askForConversationId() {
        return await this.core.askQuestion('\nEnter conversation ID: ');
    }

    /**
     * Show pause message
     */
    async pause(message = 'Press Enter to continue...') {
        await this.core.askQuestion(`\n${message}`);
    }
}
