/**
 * @fileoverview handlers/commands/showMyCircles.js
 * Handles the '/mycircles' command logic. Shows all care circles that the current user
 * is a member of, regardless of role.
 */

import { getUserCircles, findUserById } from '../../db/index.js';
import { events } from '../../orchestrator.js';

export async function handleShowMyCirclesCommand(userId, circleId) {
    try {
        const currentUser = await findUserById(userId);
        const userCircles = await getUserCircles(userId);

        if (userCircles.length === 0) {
            events.emit('broadcast', { 
                targetUsers: [userId], 
                reply: `You are not currently a member of any care circles.`, 
                from: 'system', 
                circleId 
            });
            return;
        }

        let reply = `\n--- Your Care Circles (${userCircles.length}) ---\n`;
        reply += `You are: ${currentUser.username}\n`;
        reply += `-----------------------------------\n`;

        // Debug logging
        console.log(`[ShowMyCircles] User ${userId} (${currentUser.username}) has ${userCircles.length} circles:`, userCircles);

        userCircles.forEach((circle, index) => {
            const roleEmoji = circle.role === 'patient' ? '👤' : 
                            circle.role === 'doctor' ? '🩺' : '👥';
            
            reply += `\n${index + 1}. ${roleEmoji} ${circle.patient_username}'s Circle`;
            reply += `\n   Your role: ${circle.role}`;
            if (circle.relationship_type && circle.relationship_type !== 'null') {
                reply += ` (${circle.relationship_type})`;
            }
            reply += `\n   Circle ID: ${circle.circle_id}`;
            reply += `\n   Switch with: /switch ${circle.patient_username}`;
            
            // Show consent level if available
            if (circle.consent_level) {
                reply += `\n   Your consent: ${circle.consent_level}`;
            }
            reply += `\n`;
        });

        reply += `\n-----------------------------------`;
        reply += `\n💡 Use /switch <patient> to join their circle`;
        reply += `\n💡 Use /circle to see members of current circle`;

        events.emit('broadcast', { targetUsers: [userId], reply, from: 'system', circleId });
    } catch (error) {
        console.error('[ShowMyCircles] Error:', error);
        events.emit('broadcast', { 
            targetUsers: [userId], 
            reply: `Error retrieving your circles: ${error.message}`, 
            from: 'system', 
            circleId 
        });
    }
}
