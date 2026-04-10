/**
 * @fileoverview routes/business.js
 * Business and professional circle API routes
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { ProfessionalCircleManager } from '../agents/social/SpecializedCircleManagers.js';

const router = express.Router();

// GET /api/professional-circles/user/:userId
router.get('/professional-circles/user/:userId', authenticate, async (req, res) => {
    try {
        const { userId } = req.params;
        const manager = new ProfessionalCircleManager(userId);
        
        // Get all professional circles where user is a member
        const circles = await manager.getUserCircles(userId);
        const professionalCircles = circles.filter(c => c.circle_type === 'professional');
        
        // Format for GUI
        const formatted = professionalCircles.map(circle => ({
            id: circle.circle_id,
            circle_name: circle.organization_context ? JSON.parse(circle.organization_context).name : 'Unnamed Circle',
            purpose: circle.organization_context ? JSON.parse(circle.organization_context).description : '',
            user_role: circle.relationship_type, // target, support, expert
            member_count: 3, // TODO: Calculate actual count
            organization_context: circle.organization_context ? JSON.parse(circle.organization_context).scope : 'intra_org'
        }));
        
        res.json({ success: true, data: formatted });
    } catch (error) {
        console.error('[Business API] Error loading professional circles:', error);
        res.status(500).json({ error: 'Failed to load professional circles' });
    }
});

// POST /api/professional-circles/create
router.post('/professional-circles/create', authenticate, async (req, res) => {
    try {
        const { name, purpose, organizationContext, members } = req.body;
        const userId = req.user.id;
        
        const manager = new ProfessionalCircleManager(userId);
        
        const circleConfig = {
            name,
            description: purpose,
            organizationContext,
            members: {
                target: { userId: members.target, role: 'target' },
                support: { userId: members.support, role: 'support' }, 
                expert: { userId: members.expert, role: 'expert' }
            }
        };
        
        const circleId = await manager.createProfessionalCircle(circleConfig);
        
        res.json({ 
            success: true, 
            message: `Professional circle "${name}" created successfully`,
            circleId 
        });
    } catch (error) {
        console.error('[Business API] Error creating professional circle:', error);
        res.status(500).json({ error: 'Failed to create professional circle' });
    }
});

// GET /api/documents/user/:userId
router.get('/documents/user/:userId', authenticate, async (req, res) => {
    try {
        // TODO: Implement document loading from DocumentAgent
        res.json({ success: true, data: [] }); // Empty for now
    } catch (error) {
        res.status(500).json({ error: 'Failed to load documents' });
    }
});

// GET /api/negotiations/user/:userId  
router.get('/negotiations/user/:userId', authenticate, async (req, res) => {
    try {
        // TODO: Implement negotiation loading from NegotiationAgent
        res.json({ success: true, data: [] }); // Empty for now
    } catch (error) {
        res.status(500).json({ error: 'Failed to load negotiations' });
    }
});

export default router;