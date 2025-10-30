#!/usr/bin/env node

/**
 * @fileoverview World Simulation CLI
 * Command-line interface for running multi-care circle world simulations
 */

import { WorldSimulator } from '../training/world_simulation/world_simulator.js';
import { WORLD_SCENARIOS, getWorldScenariosByCategory, getRandomWorldScenario } from '../training/world_simulation/world_scenarios.js';
import { readlineManager } from './readline_manager.js';

class WorldSimulationCLI {
    constructor() {
        this.simulator = null;
    }

    async run() {
        console.log('🌍 WORLD SIMULATION CLI');
        console.log('Multi-Care Circle Dynamics & Role Inversions\n');

        // Check for command-line arguments
        const args = process.argv.slice(2);
        const scenarioArg = args.find(arg => arg.startsWith('--scenario='))?.split('=')[1];
        
        if (scenarioArg) {
            // Run scenario directly from command line
            await this.runScenarioFromArgs(scenarioArg);
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
            console.log('\n📋 WORLD SIMULATION OPTIONS:');
            console.log('1. Run Role Inversion Scenario');
            console.log('2. Run Family Network Scenario');
            console.log('3. Run Sandwich Generation Scenario');
            console.log('4. Run Blended Family Scenario');
            console.log('5. List All Scenarios');
            console.log('6. Run Random Scenario');
            console.log('7. Exit');
            console.log('----------------------------------------');

            const choice = await readlineManager.askQuestion('Select option (1-7): ');
            
            switch (choice.trim()) {
                case '1':
                    await this.runScenario('patient_caregiver_swap');
                    break;
                case '2':
                    await this.runScenario('family_network_care');
                    break;
                case '3':
                    await this.runScenario('sandwich_generation');
                    break;
                case '4':
                    await this.runScenario('blended_family_care');
                    break;
                case '5':
                    await this.listScenarios();
                    break;
                case '6':
                    await this.runRandomScenario();
                    break;
                case '7':
                    console.log('👋 Goodbye!');
                    return;
                default:
                    console.log('❌ Invalid option. Please select 1-7.');
            }
        }
    }

    async runScenario(scenarioKey) {
        const scenario = WORLD_SCENARIOS[scenarioKey];
        if (!scenario) {
            console.log(`❌ Scenario '${scenarioKey}' not found`);
            return;
        }

        console.log(`\n🌍 Starting World Simulation: ${scenario.name}`);
        console.log(`📋 Description: ${scenario.description}`);
        console.log(`👥 Users: ${scenario.users.length} | 🔄 Turns: ${scenario.turns}`);
        console.log(`📊 Complexity: ${scenario.complexity}/5\n`);

        this.simulator = new WorldSimulator({
            logResults: true,
            autoFeedback: true
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

    async runRandomScenario() {
        const randomScenario = getRandomWorldScenario();
        console.log(`\n🎲 Running Random Scenario: ${randomScenario.name}`);
        await this.runScenario(randomScenario.key);
    }

    async runScenarioFromArgs(scenarioArg) {
        // Handle special cases
        if (scenarioArg.toLowerCase() === 'random') {
            await this.runRandomScenario();
            return;
        }

        // Check if scenario exists
        if (!WORLD_SCENARIOS[scenarioArg]) {
            console.log(`❌ Scenario '${scenarioArg}' not found`);
            console.log('Available scenarios:');
            Object.keys(WORLD_SCENARIOS).forEach(key => {
                console.log(`  - ${key}`);
            });
            return;
        }

        await this.runScenario(scenarioArg);
    }

    async listScenarios() {
        console.log('\n📋 AVAILABLE WORLD SCENARIOS:\n');
        
        const categories = ['role_inversion', 'family_network', 'generational', 'blended_family'];
        
        for (const category of categories) {
            const scenarios = getWorldScenariosByCategory(category);
            if (scenarios.length > 0) {
                console.log(`📁 ${category.toUpperCase().replace('_', ' ')}:`);
                scenarios.forEach((scenario, index) => {
                    console.log(`   ${index + 1}. ${scenario.name}`);
                    console.log(`      ${scenario.description}`);
                    console.log(`      👥 Users: ${scenario.users.length} | 🔄 Turns: ${scenario.turns} | 📊 Complexity: ${scenario.complexity}/5\n`);
                });
            }
        }
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
