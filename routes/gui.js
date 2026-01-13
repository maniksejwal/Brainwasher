import express from 'express';
import { getDb } from '../db/index.js';
import fs from 'fs/promises';

const router = express.Router();

// Get conversation history (grouped by conversation_id)
router.get('/conversations/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // Read training log
        try {
            const logData = await fs.readFile('./training/training_log.jsonl', 'utf-8');
            const lines = logData.trim().split('\n').filter(line => line);

            // Parse and filter by user
            const allLogs = lines.map(line => JSON.parse(line));
            const userLogs = allLogs.filter(log => log.user_id === userId);

            // Group by conversation_id
            const conversations = {};
            userLogs.forEach(log => {
                const convId = log.conversation_id;
                if (!conversations[convId]) {
                    conversations[convId] = {
                        conversation_id: convId,
                        messages: [],
                        start_time: log.timestamp,
                        end_time: log.timestamp
                    };
                }
                conversations[convId].messages.push(log);
                conversations[convId].end_time = Math.max(conversations[convId].end_time, log.timestamp);
            });

            // Convert to array and sort by most recent
            const result = Object.values(conversations).sort((a, b) => b.start_time - a.start_time);

            res.json(result);
        } catch (err) {
            // Log file might not exist yet
            res.json([]);
        }
    } catch (error) {
        res.status(500).json({ error: error.message, conversations: [] });
    }
});

// Get user's feedback history from database
router.get('/feedback/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const db = await getDb();

        // Check if feedback table exists
        const tableExists = await db.get(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='feedback'
        `);

        if (!tableExists) {
            // Table doesn't exist yet - return empty array
            return res.json([]);
        }

        const feedback = await db.all(`
            SELECT * FROM feedback 
            WHERE user_id = ? 
            ORDER BY timestamp DESC 
            LIMIT 100
        `, [userId]);

        res.json(feedback || []);
    } catch (error) {
        console.error('[API] Feedback error:', error.message);
        res.status(500).json({ error: error.message, feedback: [] });
    }
});

// POST endpoint to submit feedback
router.post('/feedback', async (req, res) => {
    try {
        const { userId, conversationId, score, comment } = req.body;
        const db = await getDb();

        await db.run(`
            INSERT INTO feedback (conversation_id, user_id, circle_id, score, comment, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            conversationId,
            userId,
            userId, // circle_id same as user_id for now
            score,
            comment || null,
            Date.now()
        ]);

        res.json({ success: true, message: 'Feedback saved' });
    } catch (error) {
        console.error('[API] Save feedback error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Companion Components
// Note: Moving this here as it's GUI related
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Correct path to companion components relative to ROUTES directory
const BASE_PROJECT_DIR = path.resolve(__dirname, '..');

async function collectJsModulesRecursive(baseDir, options = {}) {
    // ... Simplified implementation for now, or import from utils? 
    // This function was 60 lines in server.js. Maybe move to utils/files.js?
    // User asked to modularize.
    return []; // Placeholder until fileUtils is created
}
// Actually, let's skip the complex companion manifest logic refactor for this specific step to avoid breaking it if I don't move the utility.
// I'll leave the `/api/companion-components` in server.js or move utility first?
// I'll keep it in server.js for now or move to lib.

export default router;
