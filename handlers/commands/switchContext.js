/**
 * @fileoverview Handles the '/switch' command logic.
 * This module allows a user to change their active care circle context to another
 * circle they are a member of.
 */

import { findUserByUsername, findUserById, findCircleByPatientId, getMemberInfo } from '../../db/index.js';
import { events } from '../../orchestrator.js';
import { generateAndSendSummary } from './commandHelpers.js';

export async function handleSwitchCommand(userId, circleId, parts) {
    const targetPatientUsername = parts[1];
    if (!targetPatientUsername) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Invalid format. Use: /switch <patient_username>`, from: 'system', circleId });
        return;
    }

    // Allow switching back to the user's own personal circle.
    const currentUser = await findUserById(userId);
    if (targetPatientUsername === currentUser.username) {
        const personalCircle = await findCircleByPatientId(userId);
        events.emit('context_switch', { userId, newCircleId: personalCircle.circle_id });
        await generateAndSendSummary(userId, personalCircle.circle_id, currentUser.username);
        return;
    }

    const targetPatient = await findUserByUsername(targetPatientUsername);
    if (!targetPatient) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Error: Patient '${targetPatientUsername}' not found.`, from: 'system', circleId });
        return;
    }

    const targetCircle = await findCircleByPatientId(targetPatient.user_id);
    if (!targetCircle) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] No care circle found for patient '${targetPatientUsername}'.`, from: 'system', circleId });
        return;
    }

    const memberInfo = await getMemberInfo(userId, targetCircle.circle_id);
    if (memberInfo) {
        events.emit('context_switch', { userId, newCircleId: targetCircle.circle_id });
        // If the user is a doctor switching into a patient's circle, provide a summary.
        if (memberInfo.role === 'doctor') {
            await generateAndSendSummary(userId, targetCircle.circle_id, targetPatient.username);
        }
    } else {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] You are not a member of the care circle for patient '${targetPatientUsername}'.`, from: 'system', circleId });
    }
}
