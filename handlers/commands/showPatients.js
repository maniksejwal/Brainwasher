/**
 * @fileoverview handlers/commands/showPatients.js
 * Handles the '/patients' command logic. Shows all patients that the current doctor
 * is serving across different care circles.
 */

import { getUserCircles, findUserById } from '../../db/index.js';
import { events } from '../../orchestrator.js';

export async function handleShowPatientsCommand(userId, circleId) {
    try {
        const currentUser = await findUserById(userId);
        const userCircles = await getUserCircles(userId);
        
        // Filter to only circles where user is a doctor
        const doctorCircles = userCircles.filter(circle => {
            // Check if user is a doctor in this circle
            return circle.role === 'doctor';
        });

        console.log(`[ShowPatients] User ${userId} (${currentUser.username}) has ${userCircles.length} total circles:`, userCircles);
        console.log(`[ShowPatients] Filtered to ${doctorCircles.length} doctor circles:`, doctorCircles);
        
        // Debug: Show what we're getting from database
        console.log(`[ShowPatients] Raw userCircles data:`, JSON.stringify(userCircles, null, 2));

        if (doctorCircles.length === 0) {
            events.emit('broadcast', { 
                targetUsers: [userId], 
                reply: `You are not currently serving as a doctor in any care circles.`, 
                from: 'system', 
                circleId 
            });
            return;
        }

        let reply = `\n--- Your Patients (${doctorCircles.length}) ---\n`;
        reply += `You are: ${currentUser.username} (doctor)\n`;
        reply += `-----------------------------------\n`;

        doctorCircles.forEach((circle, index) => {
            reply += `\n${index + 1}. 👤 ${circle.patient_username}`;
            reply += `\n   Circle ID: ${circle.circle_id}`;
            reply += `\n   Your specialty: ${circle.relationship_type || 'General Physician'}`;
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
        console.error('[ShowPatients] Error:', error);
        events.emit('broadcast', { 
            targetUsers: [userId], 
            reply: `Error retrieving patient list: ${error.message}`, 
            from: 'system', 
            circleId 
        });
    }
}
