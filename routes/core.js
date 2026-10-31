import express from 'express';
import { handleCommand, handleMessage } from '../orchestrator.js';
import { getUnreadEscalationsForUser, getAllPromptVersions } from '../db/index.js';
import { authenticate, authorize, requireSelf, requireCircleMember } from '../middleware/auth.js';
import { acknowledge } from '../services/escalationService.js';
import { handleProposalDecision } from '../handlers/message_logic/actionResponseHandler.js';
import { broadcast } from '../lib/sse.js';

const router = express.Router();

// Get unread escalations
router.get('/doctor/escalations/unread/:userId', authenticate, requireSelf(), async (req, res) => {
    const { userId } = req.params;
    const escalations = await getUnreadEscalationsForUser(userId);
    res.status(200).json(escalations);
});

// A doctor acknowledges one escalation sent to them; the user who raised it is told
router.post('/doctor/escalations/:escalationId/acknowledge', authenticate, async (req, res) => {
    const escalationId = Number.parseInt(req.params.escalationId, 10);
    if (!Number.isFinite(escalationId)) {
        return res.status(400).json({ error: 'Invalid escalation ID' });
    }
    try {
        const result = await acknowledge(escalationId, req.user.userId);
        if (!result.acknowledged) {
            return res.status(404).json({ error: 'No unacknowledged escalation sent to this user' });
        }
        res.status(200).json(result);
    } catch (error) {
        console.error('[API] Error acknowledging escalation:', error.message);
        res.status(500).json({ error: 'Failed to acknowledge escalation' });
    }
});

// Accept or reject a proposed alert (the Accept/Reject card). Only the user it was proposed
// to can decide, and it runs at most once.
router.post('/api/escalation-proposals/:actionId/decision', authenticate, async (req, res) => {
    const { accept } = req.body || {};
    if (typeof accept !== 'boolean') {
        return res.status(400).json({ error: 'Body must be { "accept": true | false }' });
    }
    try {
        const result = await handleProposalDecision(req.user.userId, req.params.actionId, accept);
        if (result.status === 'not_found') {
            return res.status(404).json({ error: 'No open proposal with this ID for this user' });
        }
        res.status(200).json(result);
    } catch (error) {
        console.error('[API] Error deciding escalation proposal:', error.message);
        res.status(500).json({ error: 'Failed to decide the proposal' });
    }
});

// Get prompts
router.get('/api/prompts', authenticate, authorize('training:view'), async (req, res) => {
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

// Command
// The sender is always the signed-in user, and must be a member of the circle
router.post('/command', authenticate, requireCircleMember, (req, res) => {
    const { circleId, message } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'Missing message' });
    }
    handleCommand(req.user.userId, circleId, message);
    res.status(202).send();
});

// Send Message
router.post('/send', authenticate, requireCircleMember, (req, res) => {
    const { circleId, message } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'Missing message' });
    }
    handleMessage(req.user.userId, circleId, message);
    res.status(202).send();
});

export default router;
