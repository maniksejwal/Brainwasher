
import express from 'express';
import {
    getNotificationHistory,
    getUserNotificationPreferences,
    setNotificationPreference
} from '../db/index.js';

const router = express.Router();

// Get notification history (logs) for a user
router.get('/notifications/history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit) || 20;
        const history = await getNotificationHistory(userId, limit);
        res.json({ success: true, history });
    } catch (error) {
        console.error('[API] Failed to fetch notification history:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Get user preferences
router.get('/notifications/preferences/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const prefs = await getUserNotificationPreferences(userId);
        res.json({ success: true, preferences: prefs });
    } catch (error) {
        console.error('[API] Failed to fetch notification preferences:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

// Update user preferences
router.post('/notifications/preferences/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { channel, eventType, enabled, config } = req.body;

        if (!channel || !eventType) {
            return res.status(400).json({ success: false, error: 'Missing channel or eventType' });
        }

        await setNotificationPreference(userId, channel, eventType, enabled, config);
        res.json({ success: true, message: 'Preferences updated' });
    } catch (error) {
        console.error('[API] Failed to update notification preferences:', error);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

export default router;
