#!/usr/bin/env node

/**
 * Enhanced Feedback Analysis CLI
 * Shows both simulation and real user feedback with advanced analysis
 * 
 * Usage: node view_feedback.js [--simulation|--real|--all|--failures|--goals|--prompts|--flags]
 */

import { getDb } from '../db/connection.js';
import chalk from 'chalk';

const command = process.argv[2] || '--all';

async function main() {
    console.log(chalk.blue.bold('📊 Enhanced Feedback Analysis CLI\n'));
    
    try {
        switch (command) {
            case '--all':
                await showAllFeedback();
                break;
            case '--simulation':
                await showSimulationFeedback();
                break;
            case '--real':
                await showRealFeedback();
                break;
            case '--failures':
                await showFailures();
                break;
            case '--goals':
                await showGoals();
                break;
            case '--prompts':
                await showPrompts();
                break;
            case '--flags':
                await showFlags();
                break;
            default:
                showHelp();
        }
    } catch (error) {
        console.error(chalk.red(`❌ Error: ${error.message}`));
        process.exit(1);
    }
}

async function showAllFeedback() {
    console.log(chalk.yellow.bold('📈 Overall Feedback Summary\n'));
    
    const db = await getDb();
    
    // Check if feedback table exists
    const tableExists = await db.get(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='feedback'
    `);
    
    if (!tableExists) {
        console.log('❌ No feedback table found. Run some simulations or provide feedback first.');
        return;
    }
    
    // Get all feedback
    let query = 'SELECT * FROM feedback ORDER BY timestamp DESC';
    let feedbackList = await db.all(query);
    
    if (feedbackList.length === 0) {
        console.log('📭 No feedback found yet.');
        console.log('\nTo generate feedback:');
        console.log('  • Run simulation: node run_simulation.js medication_nonadherent 3');
        console.log('  • Use GUI to chat and provide feedback');
        return;
    }
    
    // Categorize feedback
    const simulation = feedbackList.filter(f => 
        f.conversation_id.includes('sim') || f.comment?.includes('[Turn') || f.comment?.includes('[Overall]')
    );
    const real = feedbackList.filter(f => 
        !f.conversation_id.includes('sim') && !f.comment?.includes('[Turn') && !f.comment?.includes('[Overall]')
    );
    
    console.log(`📈 Total Feedback: ${feedbackList.length}`);
    console.log(`   🤖 Simulation: ${simulation.length}`);
    console.log(`   👤 Real: ${real.length}\n`);
    
    // Display based on filter
    if (filter === '--all' || filter === '--simulation') {
        if (simulation.length > 0) {
            console.log('🤖 Simulation Feedback:\n');
            console.log('='.repeat(80));
            
            simulation.forEach((item, idx) => {
                const scoreEmoji = item.score > 0 ? '👍' : item.score < 0 ? '👎' : '😐';
                const date = new Date(item.timestamp).toLocaleString();
                
                console.log(`\n${idx + 1}. ${scoreEmoji} Score: ${item.score} | ${date}`);
                console.log(`   User: ${item.user_id}`);
                console.log(`   Conversation: ${item.conversation_id}`);
                if (item.comment) {
                    console.log(`   Comment: ${item.comment}`);
                }
            });
            console.log('\n' + '='.repeat(80));
        }
    }
    
    if (filter === '--all' || filter === '--real') {
        if (real.length > 0) {
            console.log('\n👤 Real User Feedback:\n');
            console.log('='.repeat(80));
            
            real.forEach((item, idx) => {
                const scoreEmoji = item.score > 0 ? '👍' : item.score < 0 ? '👎' : '😐';
                const date = new Date(item.timestamp).toLocaleString();
                
                console.log(`\n${idx + 1}. ${scoreEmoji} Score: ${item.score} | ${date}`);
                console.log(`   User: ${item.user_id}`);
                console.log(`   Conversation: ${item.conversation_id}`);
                if (item.comment) {
                    console.log(`   Comment: ${item.comment}`);
                }
            });
            console.log('\n' + '='.repeat(80));
        }
    }
    
    // Statistics
    if (filter === '--all') {
        console.log('\n📊 Statistics:\n');
        
        const avgScore = feedbackList.reduce((sum, f) => sum + f.score, 0) / feedbackList.length;
        const positive = feedbackList.filter(f => f.score > 0).length;
        const negative = feedbackList.filter(f => f.score < 0).length;
        const neutral = feedbackList.filter(f => f.score === 0).length;
        
        console.log(`   Average Score: ${avgScore.toFixed(2)}`);
        console.log(`   👍 Positive: ${positive} (${(positive/feedbackList.length*100).toFixed(1)}%)`);
        console.log(`   👎 Negative: ${negative} (${(negative/feedbackList.length*100).toFixed(1)}%)`);
        console.log(`   😐 Neutral: ${neutral} (${(neutral/feedbackList.length*100).toFixed(1)}%)`);
        
        // Common issues from comments
        if (negative > 0) {
            console.log('\n🔍 Common Issues (from negative feedback):');
            const negativeComments = feedbackList.filter(f => f.score < 0 && f.comment);
            
            const keywords = {};
            negativeComments.forEach(f => {
                const comment = f.comment.toLowerCase();
                if (comment.includes('escalat')) keywords['escalation'] = (keywords['escalation'] || 0) + 1;
                if (comment.includes('empathy') || comment.includes('caring')) keywords['empathy'] = (keywords['empathy'] || 0) + 1;
                if (comment.includes('consent') || comment.includes('privacy')) keywords['consent'] = (keywords['consent'] || 0) + 1;
                if (comment.includes('dismissed') || comment.includes('ignored')) keywords['dismissive'] = (keywords['dismissive'] || 0) + 1;
            });
            
            Object.entries(keywords)
                .sort((a, b) => b[1] - a[1])
                .forEach(([issue, count]) => {
                    console.log(`   • ${issue}: ${count} mentions`);
                });
        }
    }
}

async function showFailures() {
    const db = await getDb();
    
    console.log(chalk.red.bold('🚨 Critical Failure Analysis\n'));
    
    const failures = await db.all(`
        SELECT 
            conversation_id,
            comment,
            timestamp,
            goal_adherence_score,
            goal_history_score,
            goal_conversation_score,
            prompt_version
        FROM feedback 
        WHERE critical_failure = 1 OR score <= -2
        ORDER BY timestamp DESC 
        LIMIT 20
    `);
    
    if (failures.length === 0) {
        console.log(chalk.green('✅ No critical failures found!'));
        return;
    }
    
    failures.forEach((failure, index) => {
        console.log(`${index + 1}. ${chalk.red(failure.comment)}`);
        console.log(`   Conversation: ${failure.conversation_id}`);
        console.log(`   Time: ${new Date(failure.timestamp).toLocaleString()}`);
        if (failure.prompt_version) {
            console.log(`   Prompt: ${failure.prompt_version}`);
        }
        if (failure.goal_adherence_score) {
            console.log(`   Goals: A:${formatScore(failure.goal_adherence_score)} H:${formatScore(failure.goal_history_score)} C:${formatScore(failure.goal_conversation_score)}`);
        }
        console.log('');
    });
}

async function showGoals() {
    const db = await getDb();
    
    console.log(chalk.blue.bold('🎯 Care Circle Goal Progress\n'));
    
    const goals = await db.all(`
        SELECT 
            conversation_id,
            AVG(goal_adherence_score) as adherence,
            AVG(goal_history_score) as history,
            AVG(goal_conversation_score) as conversation,
            COUNT(*) as interactions,
            AVG(score) as avg_score
        FROM feedback 
        WHERE source = "simulation" AND goal_adherence_score IS NOT NULL
        GROUP BY conversation_id
        ORDER BY adherence DESC, history DESC, conversation DESC
        LIMIT 15
    `);
    
    if (goals.length === 0) {
        console.log(chalk.yellow('📭 No goal assessment data found. Run simulations to generate goal metrics.'));
        return;
    }
    
    console.log('Top Performing Conversations:');
    goals.forEach((goal, index) => {
        console.log(`${index + 1}. ${goal.conversation_id}`);
        console.log(`   Adherence:    ${formatScore(goal.adherence)}`);
        console.log(`   History:      ${formatScore(goal.history)}`);
        console.log(`   Conversation: ${formatScore(goal.conversation)}`);
        console.log(`   Avg Score:    ${formatScore(goal.avg_score)}`);
        console.log(`   Interactions: ${goal.interactions}`);
        console.log('');
    });
}

async function showPrompts() {
    const db = await getDb();
    
    console.log(chalk.purple.bold('🤖 Prompt Performance Analysis\n'));
    
    const prompts = await db.all(`
        SELECT 
            prompt_version,
            COUNT(*) as interactions,
            AVG(score) as avg_score,
            COUNT(CASE WHEN critical_failure = 1 THEN 1 END) as failures,
            AVG(goal_adherence_score) as avg_adherence,
            AVG(goal_history_score) as avg_history,
            AVG(goal_conversation_score) as avg_conversation
        FROM feedback 
        WHERE source = "simulation" AND prompt_version IS NOT NULL
        GROUP BY prompt_version
        ORDER BY avg_score DESC
    `);
    
    if (prompts.length === 0) {
        console.log(chalk.yellow('📭 No prompt version data found. Run simulations to generate prompt metrics.'));
        return;
    }
    
    prompts.forEach(prompt => {
        const failureRate = ((prompt.failures / prompt.interactions) * 100).toFixed(1);
        const color = prompt.avg_score >= 0 ? chalk.green : chalk.red;
        
        console.log(`Prompt: ${prompt.prompt_version}`);
        console.log(`  Interactions: ${prompt.interactions}`);
        console.log(`  Avg Score:    ${color(prompt.avg_score.toFixed(2))}`);
        console.log(`  Failures:     ${prompt.failures} (${failureRate}%)`);
        console.log(`  Goals: A:${formatScore(prompt.avg_adherence)} H:${formatScore(prompt.avg_history)} C:${formatScore(prompt.avg_conversation)}`);
        console.log('');
    });
}

async function showFlags() {
    const db = await getDb();
    
    console.log(chalk.red.bold('🚩 Simulation Flags\n'));
    
    const flags = await db.all(`
        SELECT 
            conversation_id,
            flag_type,
            reason,
            timestamp,
            resolved,
            resolution_notes
        FROM simulation_flags
        ORDER BY timestamp DESC
        LIMIT 20
    `);
    
    if (flags.length === 0) {
        console.log(chalk.green('✅ No simulation flags found!'));
        return;
    }
    
    flags.forEach((flag, index) => {
        const status = flag.resolved ? chalk.green('✅ RESOLVED') : chalk.red('❌ PENDING');
        console.log(`${index + 1}. ${status} - ${flag.flag_type}`);
        console.log(`   Conversation: ${flag.conversation_id}`);
        console.log(`   Reason: ${flag.reason}`);
        console.log(`   Time: ${new Date(flag.timestamp).toLocaleString()}`);
        if (flag.resolution_notes) {
            console.log(`   Resolution: ${flag.resolution_notes}`);
        }
        console.log('');
    });
}

function formatScore(score) {
    if (score === null) return 'N/A';
    const color = score >= 0.8 ? chalk.green : score >= 0.6 ? chalk.yellow : chalk.red;
    return color(score.toFixed(2));
}

function showHelp() {
    console.log(`
📊 Enhanced Feedback Analysis CLI

Usage: node view_feedback.js [command]

Commands:
  --all          - Overall feedback summary (default)
  --simulation   - Simulation feedback only
  --real         - Real user feedback only
  --failures     - Critical failure analysis
  --goals        - Care circle goal progress
  --prompts      - Prompt performance analysis
  --flags        - Simulation flags review

Examples:
  node view_feedback.js --all
  node view_feedback.js --failures
  node view_feedback.js --goals
`);
}

// Keep existing functions for backward compatibility
async function showSimulationFeedback() {
    // Implementation from original viewFeedback function
    console.log('🤖 Simulation Feedback (legacy view)');
    // ... existing code ...
}

async function showRealFeedback() {
    // Implementation from original viewFeedback function  
    console.log('👤 Real User Feedback (legacy view)');
    // ... existing code ...
}

main().catch(error => {
    console.error(chalk.red(`❌ Error: ${error.message}`));
    process.exit(1);
});
