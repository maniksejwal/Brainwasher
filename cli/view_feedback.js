#!/usr/bin/env node

/**
 * View All Collected Feedback
 * Shows both simulation and real user feedback
 * 
 * Usage: node view_feedback.js [--simulation|--real|--all]
 */

import { getDb } from '../db/connection.js';

const filter = process.argv[2] || '--all';

async function viewFeedback() {
    console.log('📊 Viewing Collected Feedback\n');
    
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

viewFeedback().catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
});
