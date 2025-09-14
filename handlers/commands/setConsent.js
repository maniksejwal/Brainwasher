/**
 * @fileoverview Handles the '/consent' command logic.
 * This module allows a patient to set the consent level for another member
 * within their own personal care circle.
 */

import { getCircleMembers, updateMemberConsent } from '../../db/index.js';
import { events } from '../../orchestrator.js';

export async function handleConsentCommand(userId, circleId, parts) {
    const targetUsername = parts[1];
    const level = parts[2];

    // Business Rule: You can only set consent in your own personal care circle.
    if (circleId !== userId) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] You can only set consent within your own care circle.`, from: 'system', circleId });
        return;
    }

    if (!targetUsername || !level || !['none', 'limited', 'full'].includes(level)) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Invalid format. Use: /consent <username> <level>`, from: 'system', circleId });
        return;
    }

    const members = await getCircleMembers(circleId);
    const targetMember = members.find(m => m.username === targetUsername);

    if (!targetMember) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Error: User '${targetUsername}' is not a member of this care circle.`, from: 'system', circleId });
        return;
    }

    await updateMemberConsent(circleId, targetMember.user_id, level);
    events.emit('broadcast', { targetUsers: [userId], reply: `[System] Consent for '${targetUsername}' in this circle set to '${level}'.`, from: 'system', circleId });
}
