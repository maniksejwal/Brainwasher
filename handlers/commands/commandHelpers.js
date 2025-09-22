/**
 * @fileoverview handlers/commands/commandHelpers.js
 * Contains helper functions shared across different command handlers,
 * particularly for complex, reusable actions like generating a doctor's summary.
 */

import { getUnreadEscalationsForCircle, getRecentMessages, markCircleEscalationsAsRead, findUserById, findCircleByPatientId } from '../../db/index.js';
import { generateDoctorSummary } from '../../agents/index.js';
import { events } from '../../orchestrator.js';

/**
 * Generates a clinical summary for a specific care circle and broadcasts it to the doctor.
 * @param {string} doctorId - The user ID of the doctor receiving the summary.
 * @param {string} circleId - The ID of the care circle to summarize.
 * @param {string} patientUsername - The username of the patient for context in the summary.
 */
export async function generateAndSendSummary(doctorId, circleId, patientUsername) {
    const escalations = await getUnreadEscalationsForCircle(circleId);
    const messages = await getRecentMessages(circleId, 5);
    const circle = await findCircleByPatientId(circleId);
    // FIX: Ensure we have a valid patient object before proceeding
    if (!circle) {
        console.error(`[CommandHelpers] Could not generate summary, circle not found: ${circleId}`);
        return;
    }
    const patient = await findUserById(circle.primary_patient_id);
    if (!patient) {
        console.error(`[CommandHelpers] Could not generate summary, patient not found for circle: ${circleId}`);
        return;
    }


    if (escalations.length === 0 && messages.length === 0) {
        events.emit('broadcast', { targetUsers: [doctorId], reply: `[Clinical Summary] No new events in the circle for ${patient.username}.`, from: 'system', circleId, patientUsername: patient.username });
        return;
    }

    const summary = await generateDoctorSummary(patient.username, escalations, messages);
    // FIX: Ensure the correct patient username from the database is passed in the event
    events.emit('broadcast', { targetUsers: [doctorId], reply: `[Clinical Summary for ${patient.username}]\n${summary}`, from: 'system', circleId, patientUsername: patient.username });

    if (escalations.length > 0) {
        await markCircleEscalationsAsRead(circleId);
    }
}

