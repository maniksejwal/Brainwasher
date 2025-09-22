/**
 * @fileoverview Handles the '/circle' command logic.
 * This module fetches and displays a structured list of all members in the
 * user's currently active care circle, grouped by their role.
 */

import { getCircleMembers, findUserById, findCircleByPatientId } from '../../db/index.js';
import { events } from '../../orchestrator.js';

export async function handleShowCircleCommand(userId, circleId) {
    const members = await getCircleMembers(circleId);
    const circle = await findCircleByPatientId(circleId);
    if (!circle) {
        events.emit('broadcast', { targetUsers: [userId], reply: '[System] Error: Could not find the active care circle.', from: 'system', circleId });
        return;
    }
    const patient = await findUserById(circle.primary_patient_id);
    if (!patient) {
        events.emit('broadcast', { targetUsers: [userId], reply: '[System] Error: Could not find the patient for this circle.', from: 'system', circleId });
        return;
    }

    const patientInfo = `Patient: ${patient.username}`;
    const caregivers = members.filter(m => m.role === 'caregiver');
    const doctors = members.filter(m => m.role === 'doctor');

    let caregiverInfo = 'Caregivers: None';
    if (caregivers.length > 0) {
        caregiverInfo = 'Caregivers: ' + caregivers.map(c => `${c.username} (${c.relationship_type})`).join(', ');
    }

    let doctorInfo = 'Doctors: None';
    if (doctors.length > 0) {
        // For doctors, the 'relationship_type' stores their specialization.
        doctorInfo = 'Doctors: ' + doctors.map(d => `${d.username} (${d.relationship_type || 'General Physician'})`).join(', ');
    }

    const reply = `\n--- Care Circle for ${patient.username} ---\n${patientInfo}\n${caregiverInfo}\n${doctorInfo}\n-----------------------------------`;
    events.emit('broadcast', { targetUsers: [userId], reply, from: 'system', circleId });
}

