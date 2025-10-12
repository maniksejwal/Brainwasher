#!/usr/bin/env node

/**
 * Analyze Feedback and Generate Action Items
 * Identifies patterns in feedback and suggests improvements
 * 
 * Usage: node analyze_feedback.js
 */

import { getDb } from '../db/connection.js';

async function analyzeFeedback() {
    console.log('🔍 Analyzing Collected Feedback\n');
    
    const db = await getDb();
    
    // Get all feedback
    const feedback = await db.all(`
        SELECT * FROM feedback 
        ORDER BY timestamp DESC
    `);
    
    if (feedback.length === 0) {
        console.log('📭 No feedback to analyze.');
        return;
    }
    
    console.log(`📊 Analyzing ${feedback.length} feedback entries...\n`);
    console.log('='.repeat(80));
    
    // 1. Overall Performance
    const avgScore = feedback.reduce((sum, f) => sum + f.score, 0) / feedback.length;
    const trend = avgScore > 0.3 ? '📈 Improving' : avgScore < -0.3 ? '📉 Declining' : '➡️  Stable';
    
    console.log('\n📈 OVERALL PERFORMANCE');
    console.log(`   Average Score: ${avgScore.toFixed(2)} ${trend}`);
    console.log(`   Total Feedback: ${feedback.length}`);
    
    const positive = feedback.filter(f => f.score > 0).length;
    const negative = feedback.filter(f => f.score < 0).length;
    const neutral = feedback.filter(f => f.score === 0).length;
    
    console.log(`   👍 Positive: ${positive} (${(positive/feedback.length*100).toFixed(1)}%)`);
    console.log(`   👎 Negative: ${negative} (${(negative/feedback.length*100).toFixed(1)}%)`);
    console.log(`   😐 Neutral: ${neutral} (${(neutral/feedback.length*100).toFixed(1)}%)`);
    
    // 2. Issue Categories
    console.log('\n🔍 ISSUE CATEGORIES (from negative feedback)');
    const negativeWithComments = feedback.filter(f => f.score < 0 && f.comment);
    
    const categories = {
        escalation: 0,
        empathy: 0,
        consent: 0,
        dismissive: 0,
        clarity: 0,
        other: 0
    };
    
    negativeWithComments.forEach(f => {
        const comment = f.comment.toLowerCase();
        let categorized = false;
        
        if (comment.includes('escalat')) { categories.escalation++; categorized = true; }
        if (comment.includes('empathy') || comment.includes('caring') || comment.includes('cold')) { categories.empathy++; categorized = true; }
        if (comment.includes('consent') || comment.includes('privacy') || comment.includes('unauthorized')) { categories.consent++; categorized = true; }
        if (comment.includes('dismiss') || comment.includes('ignored') || comment.includes('brushed off')) { categories.dismissive++; categorized = true; }
        if (comment.includes('unclear') || comment.includes('confusing') || comment.includes('explain')) { categories.clarity++; categorized = true; }
        if (!categorized) categories.other++;
    });
    
    Object.entries(categories)
        .filter(([_, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .forEach(([category, count]) => {
            const percentage = (count / negativeWithComments.length * 100).toFixed(1);
            console.log(`   • ${category}: ${count} (${percentage}%)`);
        });
    
    // 3. Specific Issues (sample negative feedback)
    console.log('\n❌ EXAMPLE NEGATIVE FEEDBACK');
    const sampleNegative = negativeWithComments.slice(0, 5);
    sampleNegative.forEach((f, idx) => {
        console.log(`   ${idx + 1}. "${f.comment}"`);
    });
    
    // 4. Success Patterns (sample positive feedback)
    const positiveWithComments = feedback.filter(f => f.score > 0 && f.comment);
    if (positiveWithComments.length > 0) {
        console.log('\n✅ EXAMPLE POSITIVE FEEDBACK');
        const samplePositive = positiveWithComments.slice(0, 5);
        samplePositive.forEach((f, idx) => {
            console.log(`   ${idx + 1}. "${f.comment}"`);
        });
    }
    
    // 5. Action Items
    console.log('\n🎯 RECOMMENDED ACTION ITEMS\n');
    
    const actions = [];
    
    if (categories.escalation > 2) {
        actions.push({
            priority: '🔴 HIGH',
            issue: 'Escalation Handling',
            action: 'Review escalation logic in handlers/message_logic/conflictHandler.js',
            details: `${categories.escalation} feedback items mention missed escalations`
        });
    }
    
    if (categories.empathy > 2) {
        actions.push({
            priority: '🟡 MEDIUM',
            issue: 'Empathy/Tone',
            action: 'Improve empathy in prompts/unified_prompt.js',
            details: `${categories.empathy} feedback items mention lack of empathy`
        });
    }
    
    if (categories.consent > 2) {
        actions.push({
            priority: '🔴 HIGH',
            issue: 'Consent Violations',
            action: 'Review consent checking in handlers/commands/setConsent.js',
            details: `${categories.consent} feedback items mention privacy/consent issues`
        });
    }
    
    if (categories.dismissive > 2) {
        actions.push({
            priority: '🟡 MEDIUM',
            issue: 'Dismissive Responses',
            action: 'Add follow-up questions in agent prompts',
            details: `${categories.dismissive} feedback items mention agent dismissing concerns`
        });
    }
    
    if (avgScore < -0.2) {
        actions.push({
            priority: '🔴 HIGH',
            issue: 'Overall Quality',
            action: 'General prompt improvement needed',
            details: `Average score is negative (${avgScore.toFixed(2)})`
        });
    }
    
    if (actions.length === 0) {
        console.log('   ✅ No critical issues detected!');
        console.log('   💡 Continue monitoring feedback for patterns.');
    } else {
        actions.forEach((action, idx) => {
            console.log(`${idx + 1}. ${action.priority} ${action.issue}`);
            console.log(`   📝 Action: ${action.action}`);
            console.log(`   📊 Details: ${action.details}\n`);
        });
    }
    
    // 6. Next Steps
    console.log('='.repeat(80));
    console.log('\n📋 NEXT STEPS:\n');
    console.log('1. Review the action items above');
    console.log('2. Make changes to prompts or handlers');
    console.log('3. Run simulations to test improvements');
    console.log('4. Compare new feedback to see if issues are resolved');
    console.log('\n💡 Tip: Focus on the highest priority items first!\n');
}

analyzeFeedback().catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
});
