import express from 'express';
import { handleLogin, handleCommand, handleMessage } from '../orchestrator.js';
import { getUnreadEscalationsForUser, getAllPromptVersions } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';
import { broadcast } from '../lib/sse.js';

const router = express.Router();

// Get unread escalations
router.get('/doctor/escalations/unread/:userId', async (req, res) => {
    const { userId } = req.params;
    const escalations = await getUnreadEscalationsForUser(userId);
    res.status(200).json(escalations);
});

// Get prompts
router.get('/api/prompts', async (req, res) => {
    try {
        const limit = Number.parseInt(req.query.limit, 10);
        const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 100;
        const prompts = await getAllPromptVersions(safeLimit);
        res.json({ prompts });
    } catch (error) {
        console.error('[API] Error fetching prompts:', error.message);
        res.status(500).json({ error: 'Failed to load prompts' });
    }
});

// Legacy Login (Keep for backward compatibility? Or deprecated?)
// The client/network.js might still use /login. The new Client uses /api/auth/login.
// We'll keep it for now.
router.post('/login', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: 'Missing username' });
    }
    const result = await handleLogin(username);
    res.status(200).json(result);
});

// Command
router.post('/command', (req, res) => {
    const { userId, circleId, message } = req.body;
    if (!userId || !circleId || !message) {
        return res.status(400).json({ error: 'Missing userId, circleId, or message' });
    }
    handleCommand(userId, circleId, message);
    res.status(202).send();
});

// Send Message
router.post('/send', (req, res) => {
    const { userId, circleId, message } = req.body;
    if (!userId || !circleId || !message) {
        return res.status(400).json({ error: 'Missing userId, circleId, or message' });
    }
    handleMessage(userId, circleId, message);
    res.status(202).send();
});

// Context Switch API - GUI buttons use this, manual commands use CLI
router.post('/api/context/switch', authenticate, async (req, res) => {
    try {
        const { circleId, circleType } = req.body;
        const userId = req.user.id;

        if (!circleId) {
            return res.status(400).json({ error: 'Missing circleId' });
        }

        // Use the existing CLI command internally - this maintains consistency
        // GUI buttons → API → CLI command → Same processing as manual commands
        const command = `/switch ${circleId}`;
        handleCommand(userId, null, command);
        
        res.status(202).json({ 
            success: true, 
            message: `Context switch initiated for ${circleType || 'circle'} ${circleId}` 
        });
        
    } catch (error) {
        console.error('[API] Context switch error:', error);
        res.status(500).json({ error: 'Failed to switch context' });
    }
});

export default router;
