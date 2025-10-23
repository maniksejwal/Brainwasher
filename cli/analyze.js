#!/usr/bin/env node

/**
 * @fileoverview Unified CLI tool for all analysis operations
 * Frontend interface for backend analysis modules
 */

import { FeedbackAnalyzer } from '../training/analysis/feedback_analyzer.js';
import { IssueAnalyzer } from '../training/analysis/issue_analyzer.js';
import { PromptOptimizer } from '../training/analysis/prompt_optimizer.js';
import { getDb } from '../db/connection.js';
import chalk from 'chalk';

// Set simulation mode for analysis
process.env.SIMULATION_MODE = 'true';

const COMMANDS = {
    'prompts': 'Analyze prompt performance and versions',
    'rewards': 'Calculate reward backpropagation analysis', 
    'failures': 'Generate failure pattern reports',
    'optimize': 'Optimize prompts based on feedback',
    'all': 'Run all analysis types'
};

async function main() {
    const command = process.argv[2];
    
    if (!command || !COMMANDS[command]) {
        showUsage();
        return;
    }
    
    console.log(chalk.cyan.bold('🔍 UNIFIED ANALYSIS TOOL'));
    console.log('='.repeat(60));
    console.log(`Command: ${command} - ${COMMANDS[command]}`);
    console.log('-'.repeat(60));
    
    const db = await getDb();
    
    try {
        switch (command) {
            case 'prompts':
                await analyzePrompts(db);
                break;
            case 'rewards':
                await analyzeRewards(db);
                break;
            case 'failures':
                await analyzeFailures(db);
                break;
            case 'optimize':
                await optimizePrompts(db);
                break;
            case 'all':
                await runAllAnalysis(db);
                break;
        }
    } catch (error) {
        console.error(chalk.red('Analysis failed:'), error.message);
    } finally {
        await db.close();
    }
}

async function analyzePrompts(db) {
    console.log(chalk.green.bold('\n📊 PROMPT PERFORMANCE ANALYSIS'));
    
    const feedbackAnalyzer = new FeedbackAnalyzer(db);
    
    // Get prompt performance summary
    const promptAnalysis = await db.all(`
        SELECT 
            prompt_version,
            COUNT(*) as total_conversations,
            AVG(score) as avg_score,
            AVG(goal_adherence_score) as avg_adherence,
            AVG(goal_history_score) as avg_history,
            AVG(goal_conversation_score) as avg_conversation,
            SUM(CASE WHEN critical_failure = 1 THEN 1 ELSE 0 END) as critical_failures
        FROM feedback 
        WHERE source = 'simulation' AND prompt_version IS NOT NULL
        GROUP BY prompt_version
        ORDER BY avg_score DESC
    `);
    
    if (promptAnalysis.length === 0) {
        console.log(chalk.yellow('No prompt data found. Run simulations first.'));
        return;
    }
    
    promptAnalysis.forEach((prompt, index) => {
        const failureRate = ((prompt.critical_failures / prompt.total_conversations) * 100).toFixed(1);
        console.log(`\n${index + 1}. ${chalk.bold(prompt.prompt_version)}`);
        console.log(`   Conversations: ${prompt.total_conversations}`);
        console.log(`   Avg Score: ${prompt.avg_score?.toFixed(2) || 'N/A'}`);
        console.log(`   Goals - Adherence: ${prompt.avg_adherence?.toFixed(2) || 'N/A'}, History: ${prompt.avg_history?.toFixed(2) || 'N/A'}, Conversation: ${prompt.avg_conversation?.toFixed(2) || 'N/A'}`);
        console.log(`   Critical Failures: ${prompt.critical_failures} (${failureRate}%)`);
    });
}

async function analyzeRewards(db) {
    console.log(chalk.green.bold('\n🎯 REWARD BACKPROPAGATION ANALYSIS'));
    
    const feedbackAnalyzer = new FeedbackAnalyzer(db);
    const rewardAnalysis = await feedbackAnalyzer.calculateRewardBackpropagation();
    
    if (!rewardAnalysis || !rewardAnalysis.reward_signals || rewardAnalysis.reward_signals.length === 0) {
        console.log(chalk.yellow('No reward data found.'));
        return;
    }
    
    rewardAnalysis.reward_signals.forEach((reward, index) => {
        console.log(`\n${index + 1}. ${chalk.bold(reward.prompt_version)}`);
        console.log(`   Conversations: ${reward.conversationCount}`);
        console.log(`   Avg Score: ${reward.averageScore?.toFixed(2) || 'N/A'}`);
        console.log(`   Goal Adherence: ${reward.goalAdherence?.toFixed(2) || 'N/A'}`);
        console.log(`   Failure Rate: ${reward.failureRate?.toFixed(1) || 'N/A'}%`);
        console.log(`   Reward Signal: ${reward.rewardSignal || 'N/A'}`);
    });
}

async function analyzeFailures(db) {
    console.log(chalk.green.bold('\n🚨 FAILURE PATTERN ANALYSIS'));
    
    const issueAnalyzer = new IssueAnalyzer(db);
    const failureReport = await issueAnalyzer.generateFailurePatternReport();
    
    if (!failureReport || failureReport.patterns.length === 0) {
        console.log(chalk.yellow('No failure patterns found.'));
        return;
    }
    
    console.log(`\nTotal Critical Failures: ${failureReport.totalFailures}`);
    console.log(`Most Common Pattern: ${failureReport.patterns[0]?.pattern} (${failureReport.patterns[0]?.count} times)`);
    
    console.log(chalk.red.bold('\nTop Failure Patterns:'));
    failureReport.patterns.slice(0, 5).forEach((pattern, index) => {
        console.log(`${index + 1}. ${pattern.pattern}: ${pattern.count} times`);
    });
    
    if (failureReport.recommendations.length > 0) {
        console.log(chalk.blue.bold('\nRecommendations:'));
        failureReport.recommendations.forEach((rec, index) => {
            console.log(`${index + 1}. ${rec}`);
        });
    }
}

async function optimizePrompts(db) {
    console.log(chalk.green.bold('\n🚀 PROMPT OPTIMIZATION'));
    
    const promptOptimizer = new PromptOptimizer();
    const optimizationResult = await promptOptimizer.optimizeFromSimulationFeedback();
    
    if (!optimizationResult) {
        console.log(chalk.yellow('No optimization data available.'));
        return;
    }
    
    console.log(`\nOptimization Status: ${optimizationResult.status}`);
    if (optimizationResult.newPromptVersion) {
        console.log(`New Prompt Version: ${optimizationResult.newPromptVersion}`);
    }
    if (optimizationResult.improvements) {
        console.log(chalk.blue.bold('\nImprovements Made:'));
        optimizationResult.improvements.forEach((improvement, index) => {
            console.log(`${index + 1}. ${improvement}`);
        });
    }
}

async function runAllAnalysis(db) {
    console.log(chalk.cyan.bold('\n🔄 RUNNING ALL ANALYSIS TYPES'));
    
    await analyzePrompts(db);
    await analyzeRewards(db);
    await analyzeFailures(db);
    await optimizePrompts(db);
    
    console.log(chalk.green.bold('\n✅ ALL ANALYSIS COMPLETE'));
}

function showUsage() {
    console.log(chalk.cyan.bold('🔍 UNIFIED ANALYSIS TOOL'));
    console.log('='.repeat(60));
    console.log('Usage: node cli/analyze.js <command>');
    console.log('\nAvailable commands:');
    
    Object.entries(COMMANDS).forEach(([cmd, desc]) => {
        console.log(`  ${cmd.padEnd(12)} - ${desc}`);
    });
    
    console.log('\nExamples:');
    console.log('  node cli/analyze.js prompts    # Analyze prompt performance');
    console.log('  node cli/analyze.js rewards    # Calculate reward backpropagation');
    console.log('  node cli/analyze.js failures   # Generate failure pattern reports');
    console.log('  node cli/analyze.js optimize   # Optimize prompts');
    console.log('  node cli/analyze.js all        # Run all analysis types');
}

// Run the analysis
main().catch(console.error);
