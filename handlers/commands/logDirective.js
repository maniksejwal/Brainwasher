/**
 * @fileoverview Handles the '/log' and '/order' commands for confidential directives.
 * This allows a doctor to log private notes or actions in a patient's record
 * without notifying other members of the care circle.
 */

import { addDirective } from '../../db/index.js';
import { events } from '../../orchestrator.js';

export async function handleDirectiveCommand(userId, circleId, message, command) {
    // Expected format: /log "details" or /order "details"
    const details = message.match(/"(.*?)"/)?.[1];
    if (!details) {
        events.emit('broadcast', { targetUsers: [userId], reply: `Invalid format. Use: ${command} "details in quotes"`, from: 'system', circleId });
        return;
    }

    // Map the command to a directive type
    const directiveType = command === '/log' ? 'confidential_note' : 'order_request';

    await addDirective(circleId, userId, directiveType, details);
    events.emit('broadcast', { targetUsers: [userId], reply: `Confidential directive of type '${directiveType}' was logged successfully.`, from: 'system', circleId });
}
