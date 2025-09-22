/**
 * @fileoverview Contains helper functions shared across different command handlers.
 * This helps to keep the main command files clean and focused on their specific logic,
 * particularly for complex, reusable actions like generating a doctor's summary.
 */

import { getUnreadEscalationsForCircle, getRecentMessages, markCircleEscalationsAsRead } from '../../db/index.js';
import { generateDoctorSummary } from '../../agents/index.js';
import { events } from '../../orchestrator.js';

/**
 * Generates a clinical summary for a specific care circle and broadcasts it to the doctor.
 * It fetches unread escalations and recent messages to provide context.
 * @param {string} doctorId - The user ID of the doctor receiving the summary.
 * @param {string} circleId - The ID of the care circle to summarize.
 * @param {string} patientUsername - The username of the patient for context in the summary.
 */
export async function generateAndSendSummary(doctorId, circleId, patientUsername) {
    const escalations = await getUnreadEscalationsForCircle(circleId);
    const messages = await getRecentMessages(circleId, 5);

    if (escalations.length === 0 && messages.length === 0) {
        const currentPatientUsername = patientUsername || (await findById(circleId)).username;
        events.emit('broadcast', { targetUsers: [doctorId], reply: `[Clinical Summary] No new events in the circle for ${currentPatientUsername}.`, from: 'system', circleId, patientUsername: currentPatientUsername });
        return;
    }

    const summary = await generateDoctorSummary(patientUsername, escalations, messages);
    events.emit('broadcast', { targetUsers: [doctorId], reply: `[Clinical Summary for ${patientUsername}]\n${summary}`, from: 'system', circleId, patientUsername });

    if (escalations.length > 0) {
        await markCircleEscalationsAsRead(circleId);
    }
}

