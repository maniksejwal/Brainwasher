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
            events.emit('broadcast', { targetUsers: [userId], reply: `Invalid format. Use: /care <username> as <relationship>`, from: 'system', circleId });
            return;
        }
        role = 'caregiver';
        relationship = parts.slice(3).join(' '); // Allow multi-word relationships
    } else if (command === '/doc') {
        // Format: /doc <username> or /doc <username> as <specialty>
        role = 'doctor';
        // If 'as' is provided, use specialty as relationship, otherwise null (will be set via /spec)
        if (parts.length >= 4 && parts[2] === 'as') {
            relationship = parts.slice(3).join(' ');
        } else {
            relationship = null; // Will be set when doctor uses /spec command
        }
    } else {
        return; // Should not happen if routed correctly
    }

    if (!targetUsername) {
        events.emit('broadcast', { targetUsers: [userId], reply: `Invalid format. Please specify a username.`, from: 'system', circleId });
        return;
    }

    if (circleId !== userId) {
        events.emit('broadcast', { targetUsers: [userId], reply: `You can only add members to your own care circle.`, from: 'system', circleId });
        return;
    }

    const targetUser = await findUserByUsername(targetUsername);
    if (!targetUser) {
        events.emit('broadcast', { targetUsers: [userId], reply: `Error: User '${targetUsername}' not found. They must log in once to create an account.`, from: 'system', circleId });
        return;
    }

    await addMemberToCircle(circleId, targetUser.user_id, role, relationship);
    events.emit('broadcast', { targetUsers: [userId], reply: `Added '${targetUsername}' to your care circle as a '${role}'.`, from: 'system', circleId });
}

