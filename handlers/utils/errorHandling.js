/**
 * @fileoverview handlers/utils/errorHandling.js
 * Utility functions for error handling and broadcasting error replies
 */

import { findCircleById, findUserById } from '../../db/index.js';
import { getAgentName } from './agentIdentity.js';
import { events } from '../../orchestrator.js';

/**
 * Broadcast an error reply to a user
 */
export async function broadcastErrorReply(userId, circleId, reply) {
    const circle = await findCircleById(circleId);
    const patient = circle ? await findUserById(circle.primary_patient_id) : null;
    const agentName = await getAgentName(userId, circleId);
    events.emit('broadcast', {
        targetUsers: [userId],
        reply,
        from: agentName,
        circleId,
        patientUsername: patient?.username ?? userId
    });
}

/**
 * Format an error message for display to the user
 */
export function formatAnalysisErrorMessage(error) {
    if (!error) {
        return 'The AI service returned an unknown error. Please try again shortly.';
    }

    if (typeof error === 'string') {
        return `LLM error: ${error}`;
    }

    const provider = error.modelProvider || error.provider || error._modelProvider || 'LLM provider';
    const model = error.modelUsed || error.model || error._modelUsed || 'model';
    const details = error.message || error.toString() || 'no additional details';
    return `Unable to reach ${provider}:${model}. Details: ${details}`;
}

