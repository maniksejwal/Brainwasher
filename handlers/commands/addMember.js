/**
 * @fileoverview Handles the simplified '/care' and '/doc' command logic.
 * This module is responsible for parsing the commands and adding a new user
 * to the patient's personal care circle with the correct role.
 */

import { findUserByUsername, addMemberToCircle } from '../../db/index.js';
import { events } from '../../orchestrator.js';

export async function handleAddCommand(userId, circleId, message) {
    const parts = message.toLowerCase().split(' ');
    const command = parts[0];
    const targetUsername = parts[1];

    let role, relationship;

    if (command === '/care') {
        // Format: /care <username> as <relationship>
        if (parts.length < 4 || parts[2] !== 'as') {
            events.emit('broadcast', { targetUsers: [userId], reply: `[System] Invalid format. Use: /care <username> as <relationship>`, from: 'system', circleId });
            return;
        }
        role = 'caregiver';
        relationship = parts.slice(3).join(' '); // Allow multi-word relationships
    } else if (command === '/doc') {
        // Format: /doc <username>
        role = 'doctor';
        relationship = 'Physician'; // Default relationship for a doctor
    } else {
        return; // Should not happen if routed correctly
    }

    if (!targetUsername) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Invalid format. Please specify a username.`, from: 'system', circleId });
        return;
    }

    if (circleId !== userId) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] You can only add members to your own care circle.`, from: 'system', circleId });
        return;
    }

    const targetUser = await findUserByUsername(targetUsername);
    if (!targetUser) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Error: User '${targetUsername}' not found. They must log in once to create an account.`, from: 'system', circleId });
        return;
    }

    await addMemberToCircle(circleId, targetUser.user_id, role, relationship);
    events.emit('broadcast', { targetUsers: [userId], reply: `[System] Added '${targetUsername}' to your care circle as a '${role}'.`, from: 'system', circleId });
}

