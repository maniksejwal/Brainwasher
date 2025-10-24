#!/usr/bin/env node

/**
 * @fileoverview RL Training CLI
 * Command-line interface for running reinforcement learning training cycles
 */

import { trainingPipeline } from '../training/rl/training_pipeline.js';
import { trainingDb } from '../training/core/database_manager.js';
import chalk from 'chalk';

const COMMANDS = {
    'run': 'Run a complete training cycle',
    'status': 'Show training pipeline status',
    'force': 'Force optimization regardless of thresholds',
    'help': 'Show this help message'
};

async function main() {
    const command = process.argv[2];
    
    console.log(`Debug: Command received: "${command}"`);
    console.log(`Debug: Available commands: ${Object.keys(COMMANDS).join(', ')}`);
    
    if (!command || !Object.keys(COMMANDS).includes(command)) {
        showUsage();
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
            case 'help':
                showUsage();
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
    
    await trainingPipeline.runTrainingCycle();
    
    console.log('');
    console.log(chalk.green('✅ Training cycle completed!'));
}

async function showStatus() {
    console.log(chalk.cyan('📊 Training Pipeline Status'));
    console.log('');
    
    const status = await trainingPipeline.getStatus();
    
    console.log(`📈 Conversations (last 7 days): ${chalk.bold(status.conversationCount)}`);
    console.log(`📊 Average Score: ${chalk.bold(status.performance.averageScore.toFixed(2))}`);
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
}

function showUsage() {
    console.log(chalk.cyan('🧠 RL Training Pipeline CLI'));
    console.log('');
    console.log('Usage: node cli/train.js <command>');
    console.log('');
    console.log('Commands:');
    console.log('  node cli/train.js run      # Run a complete training cycle');
    console.log('  node cli/train.js status   # Show training pipeline status');
    console.log('  node cli/train.js force    # Force optimization regardless of thresholds');
    console.log('  node cli/train.js help     # Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  node cli/train.js status   # Check if ready for optimization');
    console.log('  node cli/train.js run       # Run optimization if conditions are met');
    console.log('  node cli/train.js force     # Force optimization for testing');
}

// Run the CLI
main().catch(console.error);
