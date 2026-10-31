/**
 * @fileoverview handlers/message_logic/sharing/doctorRequests.js
 * Handles the case where a user explicitly requests to talk to or consult with the doctor.
 * This should trigger immediate escalation to the doctor.
 */

import { findUserById, findCircleById } from '../../../db/index.js';
import { escalateOrPropose } from '../../../services/escalationService.js';
import { escalationSharingResult } from './escalationTiers.js';

/**
 * Handles the case where a user explicitly requests to talk to or consult with the doctor.
 * This should trigger immediate escalation to the doctor.
 * @returns {Promise<object|false>} - Sharing result with the actions taken, or false if not a doctor request.
 */
export async function handleDoctorRequest(userId, circleId, analysis) {
    // Intent may be a pipe-separated list (e.g. "REPORTING_FACT|REQUESTING_DOCTOR")
    const intents = String(analysis.intent || '').split('|').map(i => i.trim().toUpperCase());
    if (!intents.includes('REQUESTING_DOCTOR')) {
        return false;
    }

    const currentUser = await findUserById(userId);
    const circle = await findCircleById(circleId);
    if (!circle) return null;
    
    console.log(`[DoctorRequest] User '${currentUser.username}' requesting doctor consultation`);

    // Create escalation for doctor request. It is recorded even without a doctor,
    // so a doctor who joins the circle later can see the request. In a HealthyMitra circle it
    // is proposed instead.
    const escalationDetails = `User '${currentUser.username}' requested doctor consultation: "${analysis.sharingSuggestion?.content_to_share || 'Patient wants to speak with doctor'}"`;
    const result = await escalateOrPropose({
        circleId,
        userId,
        type: 'DOCTOR_REQUEST',
        details: escalationDetails,
        messageId: analysis.message_id ?? null
    });

    // The user is not messaged here: messageHandler states what was done in its one reply.
    return escalationSharingResult(result, { escalation_type: 'DOCTOR_REQUEST' });
}
