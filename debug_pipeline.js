
import { trainingPipeline } from './training/rl/training_pipeline.js';
import { trainingDb } from './training/core/database_manager.js';

async function debug() {
    await trainingPipeline.initialize();
    console.log('--- Debugging Conversation Count ---');
    try {
        const count = await trainingPipeline.getConversationCount();
        console.log(`Pipeline reported count: ${count}`);
        
        console.log('--- Debugging DB values ---');
        const db = trainingDb.getDb();
        const days = 7;
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        const result = await db.get(`SELECT COUNT(DISTINCT conversation_id) as count FROM feedback WHERE timestamp > ?`, [cutoff]);
        console.log(`Direct DB Query (Recent): ${result?.count}`);
        
        const allResult = await db.get(`SELECT COUNT(DISTINCT conversation_id) as count FROM feedback`);
        console.log(`Direct DB Query (Total): ${allResult?.count}`);
        
    } catch (e) {
        console.error(e);
    }
}

debug();
