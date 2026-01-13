import express from 'express';
import { findUserById, getUserCircles, getCircleMembers } from '../db/index.js';

const router = express.Router();

// Get Circle Members
router.get('/circle/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // Get user's circles
        const circles = await getUserCircles(userId);

        if (!circles || circles.length === 0) {
            return res.json({ members: [], circleId: null });
        }

        // Get the primary circle (where user is patient)
        const primaryCircle = circles.find(c => c.circle_id === userId) || circles[0];

        // Get members of that circle
        const members = await getCircleMembers(primaryCircle.circle_id);

        res.json({
            members: members || [],
            circleId: primaryCircle.circle_id,
            patientUsername: primaryCircle.patient_username
        });
    } catch (error) {
        console.error('[API] Circle API error:', error);
        res.status(500).json({ error: error.message, members: [] });
    }
});

// Get User
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await findUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user });
    } catch (error) {
        console.error('[API] User API error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get My Circles
router.get('/mycircles/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const circles = await getUserCircles(userId);
        res.json({ circles });
    } catch (error) {
        console.error('[API] MyCircles API error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get Patients for Doctor
router.get('/patients/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const allCircles = await getUserCircles(userId);
        const doctorCircles = allCircles.filter(circle => circle.role === 'doctor');
        res.json({ patients: doctorCircles });
    } catch (error) {
        console.error('[API] Patients API error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
