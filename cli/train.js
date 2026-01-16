#!/usr/bin/env node

/**
 * @fileoverview RL Training CLI
 * Command-line interface for running reinforcement learning training cycles
 */

import { trainingPipeline } from '../training/rl/training_pipeline.js';
import { trainingDb } from '../training/core/database_manager.js';
import { getProductionDb } from '../db/connection.js';
import chalk from 'chalk';

const COMMANDS = {
    'run': 'Run a complete training cycle',
    'status': 'Show training pipeline status',
    'force': 'Force optimization regardless of thresholds',
    'analyze-only': 'Run analysis on existing data without running simulations',
    'help': 'Show this help message'
};

async function main() {
    const command = process.argv[2];

    console.log(`Debug: Command received: "${command}"`);
    console.log(`Debug: Available commands: ${Object.keys(COMMANDS).join(', ')}`);

    if (!command || !Object.keys(COMMANDS).includes(command)) {
        showUsage();
        process.exit(0);
        return;
    }

    try {
        await trainingDb.initialize(true); // Use simulation database
        await trainingPipeline.initialize();

        switch (command) {
            case 'run':
                await runTrainingCycle();
                break;
            case 'status':
                await showStatus();
                break;
            case 'force':
                await forceOptimization();
                break;
            case 'analyze-only':
                await runAnalysisOnly();
                break;
            case 'help':
                showUsage();
                process.exit(0);
                break;
        }
    } catch (error) {
        console.error(chalk.red(`❌ Error: ${error.message}`));
        process.exit(1);
    }
}

async function runTrainingCycle() {
    console.log(chalk.cyan('🚀 Starting RL Training Cycle...'));
    console.log('');

    // Parse options
    const args = process.argv.slice(3);

    // Parse scenario filtering
    const scenarioFilterIndex = args.indexOf('--scenarios');
    const maxScenarios = scenarioFilterIndex !== -1 && args[scenarioFilterIndex + 1] ?
        parseInt(args[scenarioFilterIndex + 1]) : null;

    if (maxScenarios) {
        trainingPipeline.maxScenariosPerTest = maxScenarios;
        console.log(chalk.yellow(`📊 Limiting A/B tests to ${maxScenarios} scenarios`));
    }

    // Parse prompt types to optimize
    const promptsIndex = args.indexOf('--prompts');
    const promptsValue = promptsIndex !== -1 && args[promptsIndex + 1] ?
        args[promptsIndex + 1] : 'all';

    if (promptsValue === 'all') {
        trainingPipeline.optimizePrompts = 'all';
        console.log(chalk.yellow('📝 Optimizing all prompt types (unified, doctor, enrichment, etc.)'));
    } else if (promptsValue.includes(',')) {
        trainingPipeline.optimizePrompts = promptsValue.split(',').map(p => p.trim());
        console.log(chalk.yellow(`📝 Optimizing prompts: ${trainingPipeline.optimizePrompts.join(', ')}`));
    } else {
        trainingPipeline.optimizePrompts = promptsValue;
        console.log(chalk.yellow(`📝 Optimizing: ${promptsValue} prompt only`));
    }

    await trainingPipeline.runTrainingCycle();

    console.log('');
    console.log(chalk.green('✅ Training cycle completed!'));
    process.exit(0);
}

async function showStatus() {
    console.log(chalk.cyan('📊 Training Pipeline Status'));
    console.log('');

    const status = await trainingPipeline.getStatus();

    // Fetch Production Stats
    let prodScore = 0;
    try {
        const prodDb = await getProductionDb();
        const result = await prodDb.get("SELECT AVG(score) as avgScore FROM feedback");
        prodScore = result?.avgScore || 0;
        await prodDb.close();
    } catch (e) {
        // Ignore errors, prod db might be locked or empty
    }

    console.log(`📈 Conversations (last 7 days): ${chalk.bold(status.conversationCount)}`);
    console.log(`📊 Average Score (Sim): ${chalk.bold(status.performance.averageScore.toFixed(2))}`);
    console.log(`📊 Average Score (Prod): ${chalk.bold(prodScore.toFixed(2))}`);
    console.log(`🎯 Adherence Score: ${chalk.bold(status.performance.adherenceScore.toFixed(2))}`);
    console.log(`💬 Conversation Score: ${chalk.bold(status.performance.conversationScore.toFixed(2))}`);
    console.log('');

    if (status.lastOptimization) {
        console.log(`⏰ Last Optimization: ${chalk.yellow(new Date(status.lastOptimization).toLocaleString())}`);
    } else {
        console.log(`⏰ Last Optimization: ${chalk.yellow('Never')}`);
    }

    console.log(`⏰ Next Optimization: ${chalk.yellow(status.nextOptimization.toLocaleString())}`);
    console.log('');

    if (status.shouldOptimize) {
        console.log(chalk.green('✅ Ready for optimization!'));
    } else {
        console.log(chalk.yellow('⏳ Not ready for optimization yet'));
    }

    // Exit after showing status
    process.exit(0);
}

async function forceOptimization() {
    console.log(chalk.yellow('⚠️  Forcing optimization (ignoring thresholds)...'));
    console.log('');

    // Temporarily lower thresholds
    trainingPipeline.minConversationsForOptimization = 1;
    trainingPipeline.minScoreThreshold = 1.0;

    await trainingPipeline.runTrainingCycle();

    console.log('');
    console.log(chalk.green('✅ Forced optimization completed!'));
    process.exit(0);
}

async function runAnalysisOnly() {
    console.log(chalk.cyan('🔍 Running analysis on existing data (no new simulations)...'));
    console.log('');

    // Enable skip simulations mode
    trainingPipeline.skipSimulations = true;

    await trainingPipeline.runTrainingCycle();

    console.log('');
    console.log(chalk.green('✅ Analysis completed using existing conversation data!'));
    process.exit(0);
}

function showUsage() {
    console.log(chalk.cyan('🧠 RL Training Pipeline CLI'));
    console.log('');
    console.log('Usage: node cli/train.js <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('  node cli/train.js run          # Run a complete training cycle');
    console.log('  node cli/train.js status       # Show training pipeline status');
    console.log('  node cli/train.js force        # Force optimization regardless of thresholds');
    console.log('  node cli/train.js analyze-only # Analyze existing data without running simulations');
    console.log('  node cli/train.js help         # Show this help message');
    console.log('');
    console.log('Options:');
    console.log('  --scenarios <number>     Limit number of scenarios used in A/B testing');
    console.log('                          (default: all scenarios, uses maxRunsPerTest for diversity)');
    console.log('  --prompts <types>        Which prompts to optimize (default: all)');
    console.log('                          Options: unified, all, or comma-separated list');
    console.log('                          Examples: --prompts unified, --prompts all, --prompts unified,doctor_summary');
    console.log('');
    console.log('Examples:');
    console.log('  node cli/train.js status                              # Check if ready for optimization');
    console.log('  node cli/train.js run                                  # Optimize all prompts (default)');
    console.log('  node cli/train.js run --prompts unified               # Optimize unified prompt only');
    console.log('  node cli/train.js run --prompts unified,doctor_summary # Optimize specific prompts');
    console.log('  node cli/train.js run --scenarios 5                    # Limit A/B tests to 5 scenarios');
    console.log('  node cli/train.js force                                # Force optimization for testing');
    console.log('');
    console.log('Note: maxRunsPerTest controls how many runs per version (default: 5)');
    console.log('      This means 5 baseline + 5 challenger = 10 conversations per A/B test');
    console.log('');
    console.log('Prompt Types:');
    console.log('  - unified: Main conversational agent (default, tested in A/B tests)');
    console.log('  - doctor_summary: Clinical summary generation');
    console.log('  - doctor_probe: Question generation from doctor requests');
    console.log('  - enrichment: Context re-evaluation after entity resolution');
    console.log('  - intent: Intent classification');
}

// Run the CLI
main().catch(console.error);
