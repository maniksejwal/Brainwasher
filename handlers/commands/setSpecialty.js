/**
 * @fileoverview Handles the '/spec' command for doctors.
 * This allows a user with the 'doctor' role to define their clinical specialty,
 * which is then displayed to other users in the '/circle' command.
 */

import { updateMemberRelationship } from '../../db/index.js';
import { events } from '../../orchestrator.js';

export async function handleSetSpecialtyCommand(userId, circleId, parts) {
    const specialty = parts.slice(1).join(' '); // A specialty can have spaces, e.g., "General Surgery"
    if (!specialty) {
        events.emit('broadcast', { targetUsers: [userId], reply: `Invalid format. Use: /spec <your specialty>`, from: 'system', circleId });
        return;
    }

    // The 'relationship_type' column is used to store the specialty for doctors.
    await updateMemberRelationship(circleId, userId, specialty);
    events.emit('broadcast', { targetUsers: [userId], reply: `Your specialization in this circle has been set to: ${specialty}`, from: 'system', circleId });
}
