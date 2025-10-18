#!/usr/bin/env node

/**
 * Simple Prompt Optimization CLI
 * Reuses existing simulation and analysis code
 * 
 * Usage: node optimize_prompts.js [prompt_path] [--version version]
 */

import { PromptOptimizer } from '../training/analysis/prompt_optimizer.js';
import chalk from 'chalk';

const args = process.argv.slice(2);
const promptPath = args[0];
const versionFlag = args.find(arg => arg.startsWith('--version='));
const promptVersion = versionFlag ? versionFlag.split('=')[1] : 'simulation_v1.0';

async function main() {
    console.log(chalk.blue.bold('🤖 Prompt Optimization\n'));
    
    if (!promptPath) {
        showHelp();
        return;
    }
    
    try {
        console.log(chalk.yellow(`📝 Optimizing: ${promptPath}`));
        console.log(chalk.yellow(`📊 Version: ${promptVersion}\n`));
        
        // Reuse existing optimization logic
        const optimizer = new PromptOptimizer();
        const result = await optimizer.optimizeFromSimulationFeedback(promptPath, promptVersion);
        
        if (!result) {
            console.log(chalk.yellow('📭 No optimization performed - insufficient feedback data'));
            console.log('Run simulations first: node cli/run_simulation.js medication_nonadherent 5');
            return;
        }
        
        // Show results
        console.log(chalk.green.bold('✅ Optimization Complete!\n'));
        console.log(`Original: ${result.originalPath}`);
        console.log(`Optimized: ${result.optimizedPath}`);
        console.log(`Version: ${result.originalVersion} → ${result.newVersion}`);
        
        // Show next steps
        console.log(chalk.blue.bold('\n📋 Next Steps\n'));
        console.log('1. Test the optimized prompt:');
        console.log(`   node cli/run_simulation.js medication_nonadherent 5`);
        console.log('\n2. Compare performance:');
        console.log(`   node cli/analyze_rewards.js --prompts`);
        console.log('\n3. If improved, replace production prompt');
        
    } catch (error) {
        console.error(chalk.red(`❌ Error: ${error.message}`));
        process.exit(1);
    }
}

function showHelp() {
    console.log(`
🤖 Prompt Optimization CLI

Usage: node optimize_prompts.js <prompt_path> [options]

Arguments:
  prompt_path    - Path to the prompt file to optimize

Options:
  --version=X    - Prompt version to analyze (default: simulation_v1.0)

Examples:
  node optimize_prompts.js prompts/unified_prompt.js
  node optimize_prompts.js prompts/doctor_prompts.js --version=simulation_v1.0

Prerequisites:
  • Run simulations first to generate feedback data
  • Use existing analysis tools to review results
`);
}

main().catch(error => {
    console.error(chalk.red(`❌ Error: ${error.message}`));
    process.exit(1);
});
