#!/usr/bin/env node

/**
 * @fileoverview Quick Bulk Runner
 * Simple script to run multiple simulations of specific scenarios
 */

import { SimulationDriver } from '../training/simulation/simulator.js';
import { SCENARIOS } from '../training/simulation/scenarios.js';
import chalk from 'chalk';

async function runBulkScenarios(scenarioKeys, runsPerScenario = 3) {
    console.log(chalk.blue.bold('\n🚀 QUICK BULK RUNNER'));
    console.log(chalk.blue(`📊 Scenarios: ${scenarioKeys.length}`));
    console.log(chalk.blue(`🔄 Runs per scenario: ${runsPerScenario}`));
    console.log(chalk.blue(`📈 Total simulations: ${scenarioKeys.length * runsPerScenario}\n`));

    let successCount = 0;
    let failureCount = 0;

    for (const scenarioKey of scenarioKeys) {
        const scenario = SCENARIOS[scenarioKey];
        if (!scenario) {
            console.log(chalk.red(`❌ Scenario '${scenarioKey}' not found`));
            continue;
        }

        console.log(chalk.yellow(`\n📋 Running: ${scenario.name}`));

        for (let run = 1; run <= runsPerScenario; run++) {
            const simulator = new SimulationDriver({
                autoFeedback: true,
                logResults: false
            });

            try {
                process.env.SIMULATION_MODE = 'true';

                const startTime = Date.now();
                await simulator.runScenario(scenario, scenarioKey);
                const duration = Date.now() - startTime;

                console.log(chalk.green(`  ✓ Run ${run}/${runsPerScenario} - ${(duration / 1000).toFixed(1)}s`));
                successCount++;

            } catch (error) {
                console.log(chalk.red(`  ✗ Run ${run}/${runsPerScenario} - ${error.message}`));
                failureCount++;
            } finally {
                await simulator.cleanup();
                delete process.env.SIMULATION_MODE;

                // Small delay between runs
                if (run < runsPerScenario) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }
    }

    console.log(chalk.blue.bold('\n📊 SUMMARY'));
    console.log(chalk.green(`✅ Successful: ${successCount}`));
    console.log(chalk.red(`❌ Failed: ${failureCount}`));
    console.log(chalk.blue('🎯 Training data saved to simulation database!'));
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(chalk.blue.bold('\n🚀 Quick Bulk Runner'));
        console.log(chalk.blue('Run multiple simulations of specific scenarios\n'));
        console.log(chalk.yellow('Usage:'));
        console.log('  node cli/quick_bulk.js <scenario1> <scenario2> ... [--runs <number>]\n');
        console.log(chalk.yellow('Examples:'));
        console.log('  node cli/quick_bulk.js medication_nonadherent denial_prone --runs 5');
        console.log('  node cli/quick_bulk.js chest_pain_emergency suicidal_patient --runs 3');
        console.log('  node cli/quick_bulk.js full_care_circle --runs 10\n');
        console.log(chalk.yellow('Available scenarios:'));
        Object.entries(SCENARIOS).slice(0, 10).forEach(([key, scenario]) => {
            console.log(`  ${key} - ${scenario.name}`);
        });
        console.log(chalk.gray('  ... (run with --help to see all)'));
        return;
    }

    const runsPerScenario = (() => {
        const idx = args.indexOf('--runs');
        return idx !== -1 && args[idx + 1] ? parseInt(args[idx + 1]) : 3;
    })();

    const scenarioKeys = args.filter(arg => arg !== '--runs' && !arg.match(/^\d+$/));

    if (scenarioKeys.length === 0) {
        console.log(chalk.red('❌ No scenarios specified'));
        return;
    }

    try {
        await runBulkScenarios(scenarioKeys, runsPerScenario);
    } catch (error) {
        console.error(chalk.red('❌ Bulk run failed:'), error.message);
        process.exit(1);
    }
}

// Run if called directly
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` ||
    process.argv[1]?.includes('quick_bulk')) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

export { runBulkScenarios };
