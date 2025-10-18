#!/usr/bin/env node

/**
 * CLI for Reward Backpropagation Analysis
 * Analyzes feedback to identify prompt optimization opportunities
 * 
 * Usage: node analyze_rewards.js [--signals|--opportunities|--performance|--all]
 */

import { FeedbackAnalyzer } from '../training/analysis/feedback_analyzer.js';
import chalk from 'chalk';

const command = process.argv[2] || '--all';

async function main() {
    console.log(chalk.blue.bold('🎯 Reward Backpropagation Analysis\n'));
    
    try {
        const analyzer = new FeedbackAnalyzer();
        const analysis = await analyzer.calculateRewardBackpropagation();
        
        if (!analysis) {
            console.log(chalk.yellow('📭 No feedback data available for analysis.'));
            console.log('Run simulations to generate feedback data first.');
            return;
        }
        
        switch (command) {
            case '--all':
                await showAllAnalysis(analysis);
                break;
            case '--signals':
                await showRewardSignals(analysis);
                break;
            case '--opportunities':
                await showOptimizationOpportunities(analysis);
                break;
            case '--performance':
                await showPromptPerformance(analysis);
                break;
            default:
                showHelp();
        }
        
    } catch (error) {
        console.error(chalk.red(`❌ Error: ${error.message}`));
        process.exit(1);
    }
}

async function showAllAnalysis(analysis) {
    console.log(chalk.green.bold(`📊 Analysis Summary (${analysis.total_feedback_points} feedback points)\n`));
    
    await showPromptPerformance(analysis);
    console.log('\n' + '='.repeat(80) + '\n');
    await showRewardSignals(analysis);
    console.log('\n' + '='.repeat(80) + '\n');
    await showOptimizationOpportunities(analysis);
}

async function showPromptPerformance(analysis) {
    console.log(chalk.purple.bold('🤖 Prompt Performance Analysis\n'));
    
    const performances = Object.entries(analysis.prompt_performance)
        .sort((a, b) => b[1].reward_signal - a[1].reward_signal);
    
    if (performances.length === 0) {
        console.log(chalk.yellow('📭 No prompt performance data available.'));
        return;
    }
    
    performances.forEach(([version, perf]) => {
        const rewardColor = perf.reward_signal >= 0.5 ? chalk.green : 
                           perf.reward_signal >= 0 ? chalk.yellow : chalk.red;
        const failureColor = perf.failure_rate > 0.1 ? chalk.red : chalk.green;
        
        console.log(`Prompt: ${chalk.bold(version)}`);
        console.log(`  Reward Signal: ${rewardColor(perf.reward_signal.toFixed(3))}`);
        console.log(`  Avg Score:     ${formatScore(perf.avg_score)}`);
        console.log(`  Adherence:     ${formatScore(perf.avg_adherence)}`);
        console.log(`  History:       ${formatScore(perf.avg_history)}`);
        console.log(`  Conversation:  ${formatScore(perf.avg_conversation)}`);
        console.log(`  Failure Rate:  ${failureColor((perf.failure_rate * 100).toFixed(1))}%`);
        console.log(`  Interactions:  ${perf.total_interactions}`);
        console.log('');
    });
}

async function showRewardSignals(analysis) {
    console.log(chalk.red.bold('🚨 Reward Signals & Alerts\n'));
    
    if (analysis.reward_signals.length === 0) {
        console.log(chalk.green('✅ No critical reward signals detected!'));
        return;
    }
    
    analysis.reward_signals.forEach((signal, index) => {
        const severityColor = signal.severity === 'high' ? chalk.red : chalk.yellow;
        
        console.log(`${index + 1}. ${severityColor.bold(signal.type.toUpperCase())} - ${signal.prompt_version}`);
        console.log(`   ${signal.message}`);
        console.log(`   Recommendations:`);
        signal.recommendations.forEach(rec => {
            console.log(`     • ${rec}`);
        });
        console.log('');
    });
}

async function showOptimizationOpportunities(analysis) {
    console.log(chalk.blue.bold('🔧 Optimization Opportunities\n'));
    
    if (analysis.optimization_opportunities.length === 0) {
        console.log(chalk.green('✅ No optimization opportunities identified.'));
        return;
    }
    
    analysis.optimization_opportunities.forEach((opp, index) => {
        const priorityColor = opp.priority === 'high' ? chalk.red : chalk.yellow;
        
        console.log(`${index + 1}. ${priorityColor.bold(opp.priority.toUpperCase())} - ${opp.pattern.replace('_', ' ')}`);
        console.log(`   Frequency: ${opp.frequency} occurrences`);
        console.log(`   Description: ${opp.description}`);
        console.log(`   Suggested Changes:`);
        opp.suggested_prompt_changes.forEach(change => {
            console.log(`     • ${change}`);
        });
        console.log('');
    });
}

function formatScore(score) {
    if (score === null || score === undefined) return chalk.gray('N/A');
    const color = score >= 0.8 ? chalk.green : score >= 0.6 ? chalk.yellow : chalk.red;
    return color(score.toFixed(3));
}

function showHelp() {
    console.log(`
🎯 Reward Backpropagation Analysis CLI

Usage: node analyze_rewards.js [command]

Commands:
  --all           - Complete analysis (default)
  --performance   - Prompt performance metrics
  --signals       - Reward signals and alerts
  --opportunities - Optimization opportunities

Examples:
  node analyze_rewards.js --all
  node analyze_rewards.js --signals
  node analyze_rewards.js --opportunities

This tool analyzes feedback data to:
• Calculate reward signals for each prompt version
• Identify optimization opportunities
• Generate actionable recommendations
• Track progress towards care circle goals
`);
}

main().catch(error => {
    console.error(chalk.red(`❌ Error: ${error.message}`));
    process.exit(1);
});
