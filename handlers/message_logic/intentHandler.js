/**
 * @fileoverview handlers/message_logic/intentHandler.js
 * This module runs before the main AI analysis to detect high-priority,
 * explicit user directives, such as a request to talk to a doctor.
 */

import { classifyExplicitIntent } from '../../agents/index.js';
import { addEscalation, findCircleByPatientId } from '../../db/index.js';
import { events } from '../../orchestrator.js';
import { getAgentName } from '../utils/agentIdentity.js';

export async function handleExplicitIntent(userId, circleId, message) {
    const intentAnalysis = await classifyExplicitIntent(message);

    if (intentAnalysis.intent === 'REQUEST_CONSULTATION') {
        const details = `User '${userId}' requested to consult a doctor. Message: "${message}"`;
        await addEscalation(circleId, 'INFO', details); // Changed from CRITICAL to INFO for routine consultations
        events.emit('escalate', { circleId });
        
        // Provide more helpful response based on context
        let reply = "I understand you want to talk to the doctor. ";
        if (message.toLowerCase().includes('overwhelmed') || message.toLowerCase().includes('scared')) {
            reply += "It's completely normal to feel overwhelmed after a diagnosis. The doctor can help explain your options and answer your questions. ";
        }
        if (message.toLowerCase().includes('options')) {
            reply += "The doctor will discuss treatment options, lifestyle changes, and what to expect. ";
        }
        reply += "I'll help arrange that consultation for you.";
        
        const agentName = await getAgentName(userId, circleId);
        events.emit('broadcast', { targetUsers: [userId], reply, from: agentName, circleId });
        return true; // Indicates the message has been handled.
    }

    if (intentAnalysis.intent && intentAnalysis.intent.startsWith('SHARE_WITH_')) {
        const targetRole = intentAnalysis.intent.split('_')[2].toLowerCase();
        // This is a placeholder for the logic to find the target user and share.
        // For now, we confirm the intent was understood.
        const reply = `Okay, I will share this update with the ${targetRole}.`;
        const agentName = await getAgentName(userId, circleId);
        events.emit('broadcast', { targetUsers: [userId], reply, from: agentName, circleId });
        return true;
    }


    return false; // No high-priority intent was detected.
}

/**
 * Handle anonymous doctor consultation for cases without consent
 */
export async function handleAnonymousConsultation(userId, circleId, concern, reason = 'harmful behavior') {
    const anonymizedDetails = `Anonymous consultation requested for ${reason}. General concern: ${concern}. No patient identifiers disclosed.`;
    await addEscalation(circleId, 'CONSULT', anonymizedDetails);
    
    // Notify the requesting agent
    const agentName = await getAgentName(userId, circleId);
    const reply = `I've consulted with doc anonymously. They say: [Doctor's guidance will be provided here]`;
    events.emit('broadcast', { targetUsers: [userId], reply, from: agentName, circleId });
    
    return true;
}
