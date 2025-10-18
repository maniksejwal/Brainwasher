#!/usr/bin/env node

/**
 * CLI for Failure Pattern Reports
 * Analyzes critical failures and generates actionable reports
 * 
 * Usage: node analyze_failures.js [--patterns|--prompts|--recommendations|--all]
 */

import { IssueAnalyzer } from '../training/analysis/issue_analyzer.js';
import chalk from 'chalk';

const command = process.argv[2] || '--all';

async function main() {
    console.log(chalk.red.bold('🚨 Failure Pattern Analysis\n'));
    
    try {
        const analyzer = new IssueAnalyzer();
        const report = await analyzer.generateFailurePatternReport();
        
        if (!report) {
            console.log(chalk.yellow('📭 No failure data available for analysis.'));
            console.log('Run simulations to generate failure data first.');
            return;
        }
        
        if (report.summary.total_failures === 0) {
            console.log(chalk.green('✅ No critical failures detected!'));
            return;
        }
        
        switch (command) {
            case '--all':
                await showAllReport(report);
                break;
            case '--patterns':
                await showFailurePatterns(report);
                break;
            case '--prompts':
                await showPromptAnalysis(report);
                break;
            case '--recommendations':
                await showRecommendations(report);
                break;
            default:
                showHelp();
        }
        
    } catch (error) {
        console.error(chalk.red(`❌ Error: ${error.message}`));
        process.exit(1);
    }
}

async function showAllReport(report) {
    console.log(chalk.red.bold(`🚨 Failure Analysis Summary (${report.summary.total_failures} critical failures)\n`));
    
    if (report.summary.time_range) {
        console.log(`Time Range: ${report.summary.time_range.earliest} to ${report.summary.time_range.latest}`);
        console.log(`Duration: ${report.summary.time_range.duration_days} days\n`);
    }
    
    await showFailurePatterns(report);
    console.log('\n' + '='.repeat(80) + '\n');
    await showPromptAnalysis(report);
    console.log('\n' + '='.repeat(80) + '\n');
    await showRecommendations(report);
}

async function showFailurePatterns(report) {
    console.log(chalk.yellow.bold('📊 Failure Pattern Analysis\n'));
    
    if (report.summary.patterns.length === 0) {
        console.log(chalk.green('✅ No clear patterns detected in failures.'));
        return;
    }
    
    report.summary.patterns.forEach((pattern, index) => {
        const severityColor = pattern.severity === 'high' ? chalk.red : 
                             pattern.severity === 'medium' ? chalk.yellow : chalk.green;
        
        console.log(`${index + 1}. ${severityColor.bold(pattern.pattern.replace('_', ' ').toUpperCase())}`);
        console.log(`   Occurrences: ${pattern.count} (${pattern.percentage}%)`);
        console.log(`   Severity: ${severityColor(pattern.severity)}`);
        console.log('');
    });
}

async function showPromptAnalysis(report) {
    console.log(chalk.purple.bold('🤖 Prompt Failure Analysis\n'));
    
    const prompts = Object.entries(report.prompt_analysis)
        .sort((a, b) => b[1].failure_rate - a[1].failure_rate);
    
    if (prompts.length === 0) {
        console.log(chalk.yellow('📭 No prompt-specific failure data available.'));
        return;
    }
    
    prompts.forEach(([version, data]) => {
        const failureColor = data.failure_rate > 0.3 ? chalk.red : 
                            data.failure_rate > 0.1 ? chalk.yellow : chalk.green;
        
        console.log(`Prompt: ${chalk.bold(version)}`);
        console.log(`  Failure Rate: ${failureColor((data.failure_rate * 100).toFixed(1))}%`);
        console.log(`  Total Failures: ${data.total_count}`);
        console.log(`  Top Category: ${data.top_category}`);
        
        // Show category breakdown
        const categories = Object.entries(data.categories)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
        
        if (categories.length > 0) {
            console.log(`  Categories:`);
            categories.forEach(([category, count]) => {
                console.log(`    • ${category}: ${count}`);
            });
        }
        console.log('');
    });
}

async function showRecommendations(report) {
    console.log(chalk.blue.bold('🔧 Actionable Recommendations\n'));
    
    if (report.recommendations.length === 0) {
        console.log(chalk.green('✅ No specific recommendations generated.'));
        return;
    }
    
    report.recommendations.forEach((rec, index) => {
        const priorityColor = rec.priority === 'high' ? chalk.red : chalk.yellow;
        
        console.log(`${index + 1}. ${priorityColor.bold(rec.priority.toUpperCase())} - ${rec.type.replace('_', ' ')}`);
        console.log(`   ${rec.description}`);
        console.log(`   Actions:`);
        rec.actions.forEach(action => {
            console.log(`     • ${action}`);
        });
        console.log('');
    });
}

function showHelp() {
    console.log(`
🚨 Failure Pattern Analysis CLI

Usage: node analyze_failures.js [command]

Commands:
  --all            - Complete failure analysis (default)
  --patterns       - Failure pattern breakdown
  --prompts        - Prompt-specific failure analysis
  --recommendations - Actionable recommendations

Examples:
  node analyze_failures.js --all
  node analyze_failures.js --patterns
  node analyze_failures.js --recommendations

This tool analyzes critical failures to:
• Identify systematic failure patterns
• Analyze prompt-specific failure rates
• Generate actionable improvement recommendations
• Track failure trends over time
`);
}

main().catch(error => {
    console.error(chalk.red(`❌ Error: ${error.message}`));
    process.exit(1);
});
