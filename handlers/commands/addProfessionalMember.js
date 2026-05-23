/**
 * @fileoverview Handles professional circle commands '/target', '/support', '/expert'
 * Similar to medical '/care' and '/doc' but for professional relationships
 */

import { findUserByUsername, getCircleMembers, getUserCircles } from '../../db/index.js';
import { ProfessionalCircleManager } from '../../agents/social/SpecializedCircleManagers.js';
import { events } from '../../orchestrator.js';

/**
 * Handle professional member addition commands: /target, /support, /expert
 * 
 * Professional circles require explicit context switching when multiple circles exist.
 * This ensures users consciously choose which project/department/topic they're adding members to.
 * 
 * @param {string} userId - ID of the user running the command
 * @param {string} circleId - Current circle context (may be null, care circle, or professional circle)
 * @param {string} message - Full command message (e.g., "/target alice as project_lead")
 * 
 * Command formats:
 * - /target <username> as <role_description>  (adds as 'target' role)
 * - /support <username> as <role_description> (adds as 'support' role) 
 * - /expert <username> as <expertise>        (adds as 'expert' role)
 * 
 * Multi-circle behavior:
 * - Single circle: Adds to that circle automatically
 * - Multiple circles: Requires user to switch context first with /switch <circle_id>
 * 
 * @returns {Promise<void>} Results sent via broadcast events
 */
export async function handleProfessionalAddCommand(userId, circleId, message) {
    const parts = message.split(' '); // Don't lowercase - preserve case for usernames
    const command = parts[0].toLowerCase();
    let targetUsername = parts[1];
    let role, relationship, explicitCircleName;

    // Parse explicit circle naming: "in circle_name", "@circle_name", or "#circle_name"
    const inIndex = parts.findIndex(p => p.toLowerCase() === 'in');
    const atIndex = parts.findIndex(p => p.startsWith('@'));
    const hashIndex = parts.findIndex(p => p.startsWith('#'));
    
    if (inIndex !== -1 && inIndex < parts.length - 1) {
        // Format: /target user as role in circle_name
        explicitCircleName = parts.slice(inIndex + 1).join(' ').toLowerCase();
        parts.splice(inIndex); // Remove "in circle_name" from parts for normal parsing
    } else if (atIndex !== -1) {
        // Format: /target user as role @circle_name
        explicitCircleName = parts[atIndex].substring(1).toLowerCase();
        parts.splice(atIndex, 1); // Remove "@circle_name" from parts
    } else if (hashIndex !== -1) {
        // Format: /target user as role #circle_name (hashtag style)
        explicitCircleName = parts[hashIndex].substring(1).toLowerCase();
        parts.splice(hashIndex, 1); // Remove "#circle_name" from parts
    }

    // Update targetUsername in case it was affected by parsing
    targetUsername = parts[1];

    if (command === '/target') {
        // Format: /target <username> as <role_description> [in <circle_name>|@<circle_name>]
        if (parts.length < 4 || parts[2].toLowerCase() !== 'as') {
            events.emit('broadcast', { 
                targetUsers: [userId], 
                reply: `Invalid format. Use: /target <username> as <role_description>\nOptional: add "in <circle_name>", "@<circle_name>", or "#<circle_name>" to specify circle`, 
                from: 'system', 
                circleId 
            });
            return;
        }
        role = 'target';
        // After removing circle specification, rebuild relationship from remaining parts
        relationship = parts.slice(3).join(' '); 
    } else if (command === '/support') {
        // Format: /support <username> as <role_description> [in <circle_name>|@<circle_name>]
        if (parts.length < 4 || parts[2].toLowerCase() !== 'as') {
            events.emit('broadcast', { 
                targetUsers: [userId], 
                reply: `Invalid format. Use: /support <username> as <role_description>\nOptional: add "in <circle_name>", "@<circle_name>", or "#<circle_name>" to specify circle`, 
                from: 'system', 
                circleId 
            });
            return;
        }
        role = 'support';
        relationship = parts.slice(3).join(' '); 
    } else if (command === '/expert') {
        // Format: /expert <username> as <expertise> [in <circle_name>|@<circle_name>]
        if (parts.length < 4 || parts[2].toLowerCase() !== 'as') {
            events.emit('broadcast', { 
                targetUsers: [userId], 
                reply: `Invalid format. Use: /expert <username> as <expertise>\nOptional: add "in <circle_name>", "@<circle_name>", or "#<circle_name>" to specify circle`, 
                from: 'system', 
                circleId 
            });
            return;
        }
        role = 'expert';
        relationship = parts.slice(3).join(' ');
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

    // Professional circles are user-owned, so we don't need to validate circleId context
    // Users can add members to their professional circles from any context

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
        
        // Find user's professional circles (where user is a member, not just owner)
        const allCircles = await getUserCircles(userId);
        const professionalCircles = allCircles.filter(c => c.circle_type === 'professional');
        
        if (professionalCircles.length === 0) {
            throw new Error('No professional circles found. Use /create-circle professional <name> to create one first.');
        }

        let targetCircle;
        
        // OPTION 2: Explicit Circle Naming - Check if user specified a circle
        if (explicitCircleName) {
            // Find circle by name
            targetCircle = professionalCircles.find(c => {
                const contextData = c.organization_context ? JSON.parse(c.organization_context) : {};
                const circName = contextData.name || '';
                return circName.toLowerCase().includes(explicitCircleName) || 
                       circName.toLowerCase().replace('professional_', '') === explicitCircleName ||
                       c.circle_id.toLowerCase().includes(explicitCircleName);
            });
            
            if (!targetCircle) {
                // Show available circles with names
                let reply = `❌ **Circle '${explicitCircleName}' not found.**\n\n`;
                reply += `📋 **Your Professional Circles:**\n`;
                professionalCircles.forEach((circle, index) => {
                    const contextData = circle.organization_context ? JSON.parse(circle.organization_context) : {};
                    const name = contextData.name ? contextData.name.replace('professional_', '') : `Circle ${index + 1}`;
                    reply += `${index + 1}. **${name}** (ID: ${circle.circle_id})\n`;
                });
                reply += `\n💡 **Try again with:**\n`;
                reply += `• \`${parts[0]} ${targetUsername} as ${relationship} in <circle_name>\`\n`;
                reply += `• \`${parts[0]} ${targetUsername} as ${relationship} @<circle_name>\`\n`;
                reply += `• Or use: \`/switch <circle_id>\` then \`${parts[0]} ${targetUsername} as ${relationship}\``;
                
                events.emit('broadcast', { 
                    targetUsers: [userId], 
                    reply, 
                    from: 'system', 
                    circleId 
                });
                return;
            }
        }
        // OPTION 1: Context-Based Selection
        else if (professionalCircles.length === 1) {
            // If only one professional circle, use it
            targetCircle = professionalCircles[0];
        } else {
            // Multiple professional circles exist - determine which one to use
            const currentCircle = allCircles.find(c => c.circle_id === circleId && c.circle_type === 'professional');
            
            if (currentCircle && currentCircle.primary_patient_id === userId) {
                // OPTION 1: User is in a professional circle context, use that circle
                targetCircle = currentCircle;
            } else {
                // OPTION 3: Interactive Selection - Show numbered list with all methods
                let reply = `❓ **Multiple Professional Circles Found:**\n\n`;
                professionalCircles.forEach((circle, index) => {
                    const contextData = circle.organization_context ? JSON.parse(circle.organization_context) : {};
                    const name = contextData.name ? contextData.name.replace('professional_', '') : `Circle ${index + 1}`;
                    reply += `${index + 1}. **${name}** (ID: ${circle.circle_id})\n`;
                });
                reply += `\n💡 **Choose your preferred method:**\n\n`;
                reply += `**Method 1 - Explicit Naming:**\n`;
                reply += `• \`${parts[0]} ${targetUsername} as ${relationship} in <circle_name>\`\n`;
                reply += `• \`${parts[0]} ${targetUsername} as ${relationship} @<circle_name>\`\n\n`;
                reply += `**Method 2 - Context Switch:**\n`;
                reply += `• \`/switch <circle_id>\`\n`;
                reply += `• \`${parts[0]} ${targetUsername} as ${relationship}\`\n\n`;
                reply += `**Method 3 - Interactive (coming soon):**\n`;
                reply += `• Will support: \`${parts[0]} ${targetUsername} as ${relationship} #<number>\``;
                
                events.emit('broadcast', { 
                    targetUsers: [userId], 
                    reply, 
                    from: 'system', 
                    circleId 
                });
                return;
            }
        }
        
        // Add member to user's professional circle using base class method
        await manager.addMember(targetCircle.circle_id, targetUser.user_id, role, relationship);

        events.emit('broadcast', { 
            targetUsers: [userId], 
            reply: `Added '${targetUsername}' to professional circle '${targetCircle.circle_name || 'Professional'}' as '${role}' (${relationship}).`, 
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
            const members = await getCircleMembers(circle.circle_id);
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