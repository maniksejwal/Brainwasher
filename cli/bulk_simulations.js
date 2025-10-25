#!/usr/bin/env node

/**
 * @fileoverview Bulk Simulation Runner
 * Runs multiple simulations automatically without human intervention
 * Generates large amounts of training data for the AI system
 */

import { SimulationDriver } from '../training/simulation/simulator.js';
import { SCENARIOS } from '../training/simulation/scenarios.js';
import { getScenarioCategories } from '../training/simulation/scenario_categories.js';
import chalk from 'chalk';

class BulkSimulationRunner {
    constructor(options = {}) {
        this.runsPerScenario = options.runsPerScenario || 1; // Reduced from 5 for testing
        this.scenarioFilter = options.scenarioFilter || null; // e.g., 'basic', 'complex', 'escalation'
        this.maxConcurrent = options.maxConcurrent || 1; // Run one at a time to avoid API limits
        this.results = [];
        this.startTime = Date.now();
    }

    /**
     * Get scenarios to run based on filter
     */
    getScenariosToRun() {
        const allScenarios = Object.entries(SCENARIOS);
        
        if (this.scenarioFilter) {
            return allScenarios.filter(([key, scenario]) => 
                scenario.category === this.scenarioFilter
            );
        }
        
        return allScenarios;
    }

    /**
     * Run a single simulation
     */
    async runSingleSimulation(scenarioKey, scenarioConfig, runNumber) {
        const simulator = new SimulationDriver({ 
            autoFeedback: true,  // Ensure AI feedback is generated
            logResults: false   // Reduce verbosity for bulk runs
        });

        try {
            const startTime = Date.now();
            
            // Set simulation mode
            process.env.SIMULATION_MODE = 'true';
            
            await simulator.runScenario(scenarioConfig);
            
            const duration = Date.now() - startTime;
            
            const result = {
                scenarioKey,
                scenarioName: scenarioConfig.name,
                run: runNumber,
                success: true,
                duration,
                timestamp: Date.now()
            };
            
            this.results.push(result);
            
            console.log(chalk.green(`✓ ${scenarioConfig.name} (Run ${runNumber}) - ${(duration/1000).toFixed(1)}s`));
            
            return result;
            
        } catch (error) {
            const result = {
                scenarioKey,
                scenarioName: scenarioConfig.name,
                run: runNumber,
                success: false,
                error: error.message,
                timestamp: Date.now()
            };
            
            this.results.push(result);
            
            console.log(chalk.red(`✗ ${scenarioConfig.name} (Run ${runNumber}) - ${error.message}`));
            
            return result;
        } finally {
            // Cleanup
            await simulator.cleanup();
            delete process.env.SIMULATION_MODE;
        }
    }

    /**
     * Run all bulk simulations
     */
    async runBulkSimulations() {
        const scenariosToRun = this.getScenariosToRun();
        const totalSimulations = scenariosToRun.length * this.runsPerScenario;
        
        console.log(chalk.blue.bold('\n🚀 BULK SIMULATION RUNNER'));
        console.log(chalk.blue('='.repeat(50)));
        console.log(chalk.blue(`📊 Scenarios: ${scenariosToRun.length}`));
        console.log(chalk.blue(`🔄 Runs per scenario: ${this.runsPerScenario}`));
        console.log(chalk.blue(`📈 Total simulations: ${totalSimulations}`));
        console.log(chalk.blue(`🎯 Filter: ${this.scenarioFilter || 'All scenarios'}`));
        console.log(chalk.blue('='.repeat(50) + '\n'));

        let completedCount = 0;
        let successCount = 0;
        let failureCount = 0;

        for (const [scenarioKey, scenarioConfig] of scenariosToRun) {
            console.log(chalk.yellow(`\n📋 Running: ${scenarioConfig.name}`));
            console.log(chalk.gray(`   Category: ${scenarioConfig.category} | Complexity: ${'★'.repeat(scenarioConfig.complexity)}`));
            
            for (let run = 1; run <= this.runsPerScenario; run++) {
                const result = await this.runSingleSimulation(scenarioKey, scenarioConfig, run);
                
                completedCount++;
                if (result.success) {
                    successCount++;
                } else {
                    failureCount++;
                }
                
                // Progress update
                const progress = ((completedCount / totalSimulations) * 100).toFixed(1);
                console.log(chalk.blue(`   Progress: ${completedCount}/${totalSimulations} (${progress}%)`));
                
                // Small delay to avoid API rate limits
                if (completedCount < totalSimulations) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }

        // Final summary
        const totalDuration = Date.now() - this.startTime;
        this.printSummary(successCount, failureCount, totalDuration);
        
        return this.results;
    }

    /**
     * Print final summary
     */
    printSummary(successCount, failureCount, totalDuration) {
        console.log(chalk.blue.bold('\n📊 BULK SIMULATION SUMMARY'));
        console.log(chalk.blue('='.repeat(50)));
        console.log(chalk.green(`✅ Successful: ${successCount}`));
        console.log(chalk.red(`❌ Failed: ${failureCount}`));
        console.log(chalk.blue(`⏱️  Total time: ${(totalDuration / 1000 / 60).toFixed(1)} minutes`));
        console.log(chalk.blue(`📈 Average per simulation: ${(totalDuration / (successCount + failureCount) / 1000).toFixed(1)}s`));
        console.log(chalk.blue('='.repeat(50)));
        
        // Show failed scenarios
        if (failureCount > 0) {
            console.log(chalk.red('\n❌ Failed Simulations:'));
            this.results
                .filter(r => !r.success)
                .forEach(r => {
                    console.log(chalk.red(`   ${r.scenarioName} (Run ${r.run}): ${r.error}`));
                });
        }
        
        console.log(chalk.green('\n🎯 All training data has been saved to the simulation database!'));
        console.log(chalk.green('💡 Run the training pipeline to analyze the results.'));
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    // Parse arguments
    const runsPerScenario = (() => {
        const idx = args.indexOf('--runs');
        return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1]) : 5;
    })();
    
    const scenarioFilter = (() => {
        const idx = args.indexOf('--filter');
        return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
    })();
    
    const help = args.includes('--help') || args.includes('-h');
    
    if (help) {
        console.log(chalk.blue.bold('\n🚀 Bulk Simulation Runner'));
        console.log(chalk.blue('Runs multiple simulations automatically without human intervention\n'));
        console.log(chalk.yellow('Usage:'));
        console.log('  node cli/bulk_simulations.js [options]\n');
        console.log(chalk.yellow('Options:'));
        console.log('  --runs <number>     Number of runs per scenario (default: 5)');
        console.log('  --filter <category> Filter scenarios by category');
        console.log('  --help, -h         Show this help message\n');
        console.log(chalk.yellow('Available categories:'));
        const categories = getScenarioCategories();
        Object.keys(categories).forEach(category => {
            console.log(`  ${category}`);
        });
        console.log(chalk.yellow('\nExamples:'));
        console.log('  node cli/bulk_simulations.js --runs 10 --filter basic');
        console.log('  node cli/bulk_simulations.js --runs 3 --filter escalation');
        console.log('  node cli/bulk_simulations.js --runs 20');
        return;
    }
    
    const runner = new BulkSimulationRunner({
        runsPerScenario,
        scenarioFilter
    });
    
    try {
        await runner.runBulkSimulations();
    } catch (error) {
        console.error(chalk.red('❌ Bulk simulation failed:'), error.message);
        process.exit(1);
    }
}

// Run if called directly
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` ||
    process.argv[1]?.includes('bulk_simulations')) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

export { BulkSimulationRunner };
