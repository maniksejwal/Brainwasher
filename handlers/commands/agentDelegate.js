/**
 * @fileoverview Handles the '/agent' command for doctor delegation.
 * This allows a doctor to delegate a conversational task to their personal agent,
 * such as asking a patient or caregiver a specific question.
 */

import { getCircleMembers } from '../../db/index.js';
import { generateDelegatedProbe } from '../../agents/index.js';
import { events } from '../../orchestrator.js';

export async function handleAgentDelegateCommand(userId, circleId, message) {
    // Expected format: /agent ask <target_role> "question topic"
    const match = message.match(/^\/agent ask (\w+) "(.*)"/);
    if (!match) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Invalid format. Use: /agent ask <role> "your question"`, from: 'system', circleId });
        return;
    }

    const [, targetRole, topic] = match;

    const members = await getCircleMembers(circleId);
    const targetMember = members.find(m => m.role === targetRole);

    if (!targetMember) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Error: No user with the role '${targetRole}' found in this care circle.`, from: 'system', circleId });
        return;
    }

    // Generate the natural language probe for the target user
    const probeMessage = await generateDelegatedProbe(targetMember.username, topic);

    // Send the probe from the "personal-agent" to the target
    events.emit('broadcast', {
        targetUsers: [targetMember.user_id],
        message: probeMessage,
        from: 'personal-agent',
        circleId
    });

    // Confirm the action to the doctor
    events.emit('broadcast', { targetUsers: [userId], reply: `[System] I have asked the ${targetRole} about "${topic}" on your behalf.`, from: 'system', circleId });
}
