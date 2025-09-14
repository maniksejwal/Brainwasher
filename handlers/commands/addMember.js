/**
 * @fileoverview Handles the '/add' command logic.
 * This module is responsible for parsing the command, validating the inputs,
 * and adding a new user to the patient's personal care circle.
 */

import { findUserByUsername, addMemberToCircle, findCircleByPatientId } from '../../db/index.js';
import { events } from '../../orchestrator.js';

export async function handleAddCommand(userId, circleId, parts) {
    // Expected format: /add <username> as <role> with relationship <relationship>
    const targetUsername = parts[1];
    const role = parts[3];
    const relationship = parts[6];

    if (!targetUsername || !role || !relationship || parts[2] !== 'as' || parts[4] !== 'with' || parts[5] !== 'relationship') {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Invalid format. Use: /add <username> as <role> with relationship <relationship>`, from: 'system', circleId });
        return;
    }

    // Business Rule: You can only add members to your own personal care circle.
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
