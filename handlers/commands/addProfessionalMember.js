/**
 * @fileoverview Handles professional circle commands '/target', '/support', '/expert'
 * Similar to medical '/care' and '/doc' but for professional relationships
 */

import { findUserByUsername } from '../../db/index.js';
import { ProfessionalCircleManager } from '../../agents/social/SpecializedCircleManagers.js';
import { events } from '../../orchestrator.js';

export async function handleProfessionalAddCommand(userId, circleId, message) {
    const parts = message.toLowerCase().split(' ');
    const command = parts[0];
    const targetUsername = parts[1];

    let role, relationship;

    if (command === '/target') {
        // Format: /target <username> as <role_description>
        if (parts.length < 4 || parts[2] !== 'as') {
            events.emit('broadcast', { 
                targetUsers: [userId], 
                reply: `Invalid format. Use: /target <username> as <role_description>`, 
                from: 'system', 
                circleId 
            });
            return;
        }
        role = 'target';
        relationship = parts.slice(3).join(' '); // e.g., "project_owner", "buyer", "client"
    } else if (command === '/support') {
        // Format: /support <username> as <role_description>
        if (parts.length < 4 || parts[2] !== 'as') {
            events.emit('broadcast', { 
                targetUsers: [userId], 
                reply: `Invalid format. Use: /support <username> as <role_description>`, 
                from: 'system', 
                circleId 
            });
            return;
        }
        role = 'support';
        relationship = parts.slice(3).join(' '); // e.g., "project_manager", "champion", "facilitator"
    } else if (command === '/expert') {
        // Format: /expert <username> as <expertise>
        if (parts.length < 4 || parts[2] !== 'as') {
            events.emit('broadcast', { 
                targetUsers: [userId], 
                reply: `Invalid format. Use: /expert <username> as <expertise>`, 
                from: 'system', 
                circleId 
            });
            return;
        }
        role = 'expert';
        relationship = parts.slice(3).join(' '); // e.g., "technical_architect", "legal_counsel", "domain_expert"
    } else {
        return; // Should not happen if routed correctly
    }

    if (!targetUsername) {
        events.emit('broadcast', { 
            targetUsers: [userId], 
            reply: `Invalid format. Please specify a username.`, 
            from: 'system', 
            circleId 
        });
        return;
    }

    if (circleId !== userId) {
        events.emit('broadcast', { 
            targetUsers: [userId], 
            reply: `You can only add members to your own professional circle.`, 
            from: 'system', 
            circleId 
        });
        return;
    }

    const targetUser = await findUserByUsername(targetUsername);
    if (!targetUser) {
        events.emit('broadcast', { 
            targetUsers: [userId], 
            reply: `Error: User '${targetUsername}' not found. They must log in once to create an account.`, 
            from: 'system', 
            circleId 
        });
        return;
    }

    try {
        // Use ProfessionalCircleManager to add member
        const manager = new ProfessionalCircleManager(userId);
        
        // Add member to user's professional circle
        await manager.addMemberToProfessionalCircle(userId, {
            userId: targetUser.user_id,
            role,
            relationship,
            username: targetUsername
        });

        events.emit('broadcast', { 
            targetUsers: [userId], 
            reply: `Added '${targetUsername}' to your professional circle as '${role}' (${relationship}).`, 
            from: 'system', 
            circleId 
        });

        // Send welcome message to the added member
        events.emit('broadcast', { 
            targetUsers: [targetUser.user_id], 
            reply: `You have been added to ${userId}'s professional circle as '${role}' (${relationship}).`, 
            from: 'system', 
            circleId: targetUser.user_id // Send to their personal circle
        });

    } catch (error) {
        console.error('[ProfessionalAdd] Error adding member:', error);
        events.emit('broadcast', { 
            targetUsers: [userId], 
            reply: `Error adding member: ${error.message}`, 
            from: 'system', 
            circleId 
        });
    }
}

/**
 * Show professional circle members - similar to /circle for medical
 */
export async function handleShowProfessionalCircle(userId, circleId) {
    try {
        const manager = new ProfessionalCircleManager(userId);
        const circles = await manager.getUserCircles(userId);
        const professionalCircles = circles.filter(c => c.circle_type === 'professional');

        if (professionalCircles.length === 0) {
            events.emit('broadcast', { 
                targetUsers: [userId], 
                reply: `You don't have any professional circles yet. Use /target, /support, or /expert commands to add members.`, 
                from: 'system', 
                circleId 
            });
            return;
        }

        let response = `🏢 **Your Professional Circle(s):**\n\n`;
        
        for (const circle of professionalCircles) {
            const members = await manager.getCircleMembers(circle.circle_id);
            response += `**Circle:** ${circle.organization_context ? JSON.parse(circle.organization_context).name : 'Unnamed'}\n`;
            
            const targets = members.filter(m => m.relationship_type === 'target' || m.role === 'target');
            const supports = members.filter(m => m.relationship_type === 'support' || m.role === 'support');
            const experts = members.filter(m => m.relationship_type === 'expert' || m.role === 'expert');

            if (targets.length > 0) {
                response += `**Targets:** ${targets.map(m => `${m.username} (${m.relationship_type || 'target'})`).join(', ')}\n`;
            }
            if (supports.length > 0) {
                response += `**Support:** ${supports.map(m => `${m.username} (${m.relationship_type || 'support'})`).join(', ')}\n`;
            }
            if (experts.length > 0) {
                response += `**Experts:** ${experts.map(m => `${m.username} (${m.relationship_type || 'expert'})`).join(', ')}\n`;
            }
            response += `\n`;
        }

        events.emit('broadcast', { 
            targetUsers: [userId], 
            reply: response, 
            from: 'system', 
            circleId 
        });

    } catch (error) {
        console.error('[ShowProfessionalCircle] Error:', error);
        events.emit('broadcast', { 
            targetUsers: [userId], 
            reply: `Error retrieving professional circle: ${error.message}`, 
            from: 'system', 
            circleId 
        });
    }
}