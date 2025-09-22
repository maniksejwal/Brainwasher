/**
 * @fileoverview handlers/commands/switchContext.js
 * This module handles the '/switch' command logic. It allows a user to change
 * their active care circle context to another circle they are a member of.
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

    const currentUser = await findUserById(userId);
    if (targetPatientUsername === currentUser.username) {
        const personalCircle = await findCircleByPatientId(userId);
        // FIX: Ensure correct payload is sent to prevent 'undefined' bug
        events.emit('context_switch', {
            userId,
            newCircleId: personalCircle.circle_id,
            patientUsername: currentUser.username,
            newRole: 'patient'
        });
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
        // FIX: Ensure correct payload is sent to prevent 'undefined' bug
        events.emit('context_switch', {
            userId,
            newCircleId: targetCircle.circle_id,
            patientUsername: targetPatient.username,
            newRole: memberInfo.role
        });
        if (memberInfo.role === 'doctor') {
            await generateAndSendSummary(userId, targetCircle.circle_id, targetPatient.username);
        }
    } else {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] You are not a member of the care circle for patient '${targetPatientUsername}'.`, from: 'system', circleId });
    }
}

