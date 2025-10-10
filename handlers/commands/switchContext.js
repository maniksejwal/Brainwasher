/**
 * @fileoverview handlers/commands/switchContext.js
 * This module handles the '/switch' command logic, ensuring the client receives
 * the complete and correct context upon switching circles.
 */

import { findUserByUsername, findUserById, findCircleByPatientId, getMemberInfo } from '../../db/index.js';
import { events } from '../../orchestrator.js';
import { generateAndSendSummary } from './commandHelpers.js';

export async function handleSwitchCommand(userId, circleId, parts) {
    const targetPatientUsername = parts[1];
    if (!targetPatientUsername) {
        events.emit('broadcast', { targetUsers: [userId], reply: `Invalid format. Use: /switch <patient_username>`, from: 'system', circleId });
        return;
    }

    const currentUser = await findUserById(userId);
    if (targetPatientUsername === currentUser.username) {
        const personalCircle = await findCircleByPatientId(userId);
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
        events.emit('broadcast', { targetUsers: [userId], reply: `Error: Patient '${targetPatientUsername}' not found.`, from: 'system', circleId });
        return;
    }

    const targetCircle = await findCircleByPatientId(targetPatient.user_id);
    if (!targetCircle) {
        events.emit('broadcast', { targetUsers: [userId], reply: `No care circle found for patient '${targetPatientUsername}'.`, from: 'system', circleId });
        return;
    }

    const memberInfo = await getMemberInfo(userId, targetCircle.circle_id);
    if (memberInfo) {
        // FIX: This payload is now complete, fixing the 'undefined' bug.
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
        events.emit('broadcast', { targetUsers: [userId], reply: `You are not a member of the care circle for patient '${targetPatientUsername}'.`, from: 'system', circleId });
    }
}

