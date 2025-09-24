/**
 * @fileoverview handlers/message_logic/sharing/doctorRequests.js
 * Handles the case where a user explicitly requests to talk to or consult with the doctor.
 * This should trigger immediate escalation to the doctor.
 */

import { addEscalation, findUserById, findCircleByPatientId } from '../../../db/index.js';
import { events } from '../../../orchestrator.js';
import { getAgentName } from '../../utils/agentIdentity.js';

/**
 * Handles the case where a user explicitly requests to talk to or consult with the doctor.
 * This should trigger immediate escalation to the doctor.
 * @returns {boolean} - True if the doctor request was handled, otherwise false.
 */
export async function handleDoctorRequest(userId, circleId, analysis) {
    if (analysis.intent !== 'REQUESTING_DOCTOR') {
        return false;
    }

    const currentUser = await findUserById(userId);
    const patient = await findUserById((await findCircleByPatientId(circleId)).primary_patient_id);
    
    console.log(`[DoctorRequest] User '${currentUser.username}' requesting doctor consultation`);

    // Create escalation for doctor request
    const escalationDetails = `User '${currentUser.username}' requested doctor consultation: "${analysis.sharingSuggestion?.content_to_share || 'Patient wants to speak with doctor'}"`;
    await addEscalation(circleId, 'DOCTOR_REQUEST', escalationDetails);
    events.emit('escalate', { circleId });

    // Confirm to the requesting user that doctor has been notified
    const confirmationReply = `I've notified the doctor that you'd like to speak with them. They should respond soon.`;
    const agentName = await getAgentName(userId, circleId);
    events.emit('broadcast', {
        targetUsers: [userId],
        reply: confirmationReply,
        from: agentName,
        circleId,
        patientUsername: patient.username
    });

    return true;
}
