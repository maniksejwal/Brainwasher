#!/usr/bin/env node

/**
 * @fileoverview World Simulation CLI
 * Command-line interface for running multi-care circle world simulations
 */

import { WorldSimulator } from '../training/world_simulation/world_simulator.js';
import { SCENARIOS, getWorldScenarios, isWorldScenario } from '../training/simulation/scenarios.js';
import { 
    getWorldScenariosByCategory, 
    getRandomWorldScenario,
    displayWorldScenariosByCategory
} from '../training/world_simulation/world_scenarios.js';
import { readlineManager } from './readline_manager.js';
import chalk from 'chalk';

class WorldSimulationCLI {
    constructor() {
        this.simulator = null;
    }

    async run() {
        console.log('🌍 WORLD SIMULATION CLI');
        console.log('Multi-Care Circle Dynamics & Role Inversions\n');

        // Check for command-line arguments
        const args = process.argv.slice(2);
        let scenarioArg = args.find(arg => arg.startsWith('--scenario='))?.split('=')[1];
        let turnsArg = args.find(arg => arg.startsWith('--turns='))?.split('=')[1];
        let skipFeedbackFlag = true;
        if (args.includes('--with-feedback')) {
            skipFeedbackFlag = false;
        }
        if (args.includes('--skip-feedback')) {
            skipFeedbackFlag = true;
        }

        if (!scenarioArg) {
            const scenarioIndex = args.indexOf('--scenario');
            if (scenarioIndex !== -1 && args[scenarioIndex + 1]) {
                scenarioArg = args[scenarioIndex + 1];
            }
        }

        if (!turnsArg) {
            const turnsIndex = args.indexOf('--turns');
            if (turnsIndex !== -1 && args[turnsIndex + 1]) {
                turnsArg = args[turnsIndex + 1];
            }
        }
        
        if (scenarioArg) {
            // Run scenario directly from command line
            try {
                await this.runScenarioFromArgs(scenarioArg, { turns: turnsArg, skipFeedback: skipFeedbackFlag });
            } catch (error) {
                console.error(chalk.red('\n❌ World simulation failed:'), error.message);
                if (error?.stack) {
                    console.error(error.stack);
                }
                process.exit(1);
            }
            return;
        }

        try {
            await this.showMainMenu();
        } catch (error) {
            console.error('❌ Error:', error.message);
        } finally {
            await this.cleanup();
        }
    }

    async showMainMenu() {
        readlineManager.initialize();
        
        while (true) {
            console.log(chalk.cyan.bold('\n🌍 WORLD SIMULATION CLI'));
            console.log('-'.repeat(50));
            console.log('1. Select Scenario from Categories');
            console.log('2. Run Random Scenario');
            console.log('3. List All Scenarios');
            console.log('4. Exit');
            console.log('-'.repeat(50));

            const choice = await readlineManager.askQuestion('Select option (1-4): ');
            
            switch (choice.trim()) {
                case '1':
                    await this.selectScenarioFromCategories();
                    break;
                case '2':
                    await this.runRandomScenario();
                    break;
                case '3':
                    await this.listScenarios();
                    break;
                case '4':
                    console.log('👋 Goodbye!');
                    return;
                default:
                    console.log(chalk.red('❌ Invalid option. Please select 1-4.'));
            }
        }
    }

    async selectScenarioFromCategories() {
        console.log(chalk.cyan('\n🎯 Select World Scenario'));
        console.log('-'.repeat(50));
        
        // Use category-based display
        const options = displayWorldScenariosByCategory(true);
        
        console.log(`\n  ${(options.length + 1).toString().padStart(2)}. 🎲 Random scenario`);
        options.push({ key: 'random', name: 'Random Scenario' });

        const choice = await readlineManager.askQuestion(`\nSelect scenario (1-${options.length}): `);
        const choiceNum = parseInt(choice);
        
        if (isNaN(choiceNum) || choiceNum < 1 || choiceNum > options.length) {
            console.log(chalk.yellow('Invalid choice. Using random scenario.'));
            await this.runRandomScenario();
            return;
        }

        const selected = options[choiceNum - 1];
        if (selected.key === 'random') {
            await this.runRandomScenario();
        } else {
            await this.runScenario(selected.key);
        }
    }

    async runScenario(scenarioKey, options = {}) {
        const scenario = SCENARIOS[scenarioKey];
        if (!scenario || !isWorldScenario(scenario)) {
            console.log(chalk.red(`❌ World scenario '${scenarioKey}' not found`));
            return;
        }

        console.log(chalk.cyan.bold(`\n🌍 Starting World Simulation: ${scenario.name}`));
        console.log(chalk.gray(`📋 Description: ${scenario.description}`));
        console.log(chalk.gray(`👥 Users: ${scenario.users.length} | 🔄 Turns: ${scenario.turns} | 📊 Complexity: ${scenario.complexity}/5`));
        console.log(chalk.gray(`🌍 Circles: ${scenario.circles.length}\n`));

        this.simulator = new WorldSimulator({
            logResults: true,
            autoFeedback: !options.skipFeedback
        });

        try {
            await this.simulator.runWorldScenario(scenarioKey);
            
            console.log(`\n✅ World simulation completed successfully!`);
            console.log(`📊 Summary:`);
            console.log(`   Scenario: ${scenario.name}`);
            console.log(`   Users: ${scenario.users.length} | Turns: ${scenario.turns}`);
            console.log(`   Circles: ${scenario.circles.length}`);
            
        } catch (error) {
            console.error(`❌ World simulation failed:`, error.message);
        } finally {
            if (this.simulator) {
                await this.simulator.cleanup();
                this.simulator = null;
            }
        }
    }

    async runRandomScenario(options = {}) {
        const randomScenario = getRandomWorldScenario();
        console.log(`\n🎲 Running Random Scenario: ${randomScenario.name}`);
        await this.runScenario(randomScenario.key, options);
    }

    async runScenarioFromArgs(scenarioArg, options = {}) {
        // Handle special cases
        if (scenarioArg.toLowerCase() === 'random') {
            await this.runRandomScenario(options);
            return;
        }

        // Check if scenario exists and is a world scenario
        const worldScenarios = getWorldScenarios();
        if (!worldScenarios[scenarioArg]) {
            console.log(`❌ World scenario '${scenarioArg}' not found`);
            console.log('Available world scenarios:');
            Object.keys(worldScenarios).forEach(key => {
                console.log(`  - ${key}`);
            });
            return;
        }

        await this.runScenario(scenarioArg, options);
    }

    async listScenarios() {
        console.log(chalk.cyan.bold('\n📋 AVAILABLE WORLD SCENARIOS:\n'));
        displayWorldScenariosByCategory(false);
        console.log('');
    }

    async cleanup() {
        if (this.simulator) {
            await this.simulator.cleanup();
        }
        readlineManager.cleanup();
        process.exit(0);
    }
}

// Run CLI if this file is executed directly
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` ||
    process.argv[1]?.includes('world_simulation_cli')) {
    const cli = new WorldSimulationCLI();
    cli.run().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

export { WorldSimulationCLI };
