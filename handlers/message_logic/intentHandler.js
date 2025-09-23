/**
 * @fileoverview handlers/message_logic/intentHandler.js
 * This module runs before the main AI analysis to detect high-priority,
 * explicit user directives, such as a request to talk to a doctor.
 */

import { classifyExplicitIntent } from '../../agents/index.js';
import { addEscalation } from '../../db/index.js';
import { events } from '../../orchestrator.js';

export async function handleExplicitIntent(userId, circleId, message) {
    const intentAnalysis = await classifyExplicitIntent(message);

    if (intentAnalysis.intent === 'REQUEST_CONSULTATION') {
        const details = `User '${userId}' explicitly requested to consult a doctor. Message: "${message}"`;
        await addEscalation(circleId, 'CRITICAL', details);
        events.emit('escalate', { circleId });
        const reply = "I understand you want to talk to the doctor. I have sent them an urgent notification.";
        events.emit('broadcast', { targetUsers: [userId], reply, from: 'personal-agent', circleId });
        return true; // Indicates the message has been handled.
    }

    if (intentAnalysis.intent && intentAnalysis.intent.startsWith('SHARE_WITH_')) {
        const targetRole = intentAnalysis.intent.split('_')[2].toLowerCase();
        // This is a placeholder for the logic to find the target user and share.
        // For now, we confirm the intent was understood.
        const reply = `Okay, I will share this update with the ${targetRole}.`;
        events.emit('broadcast', { targetUsers: [userId], reply, from: 'personal-agent', circleId });
        return true;
    }


    return false; // No high-priority intent was detected.
}
