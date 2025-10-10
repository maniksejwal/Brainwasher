/**
 * @fileoverview handlers/commands/showCircle.js
 * Handles the '/circle' command logic. This module fetches and displays a
 * structured list of all members in the user's currently active care circle,
 * now including their consent status.
 */

import { getCircleMembers, findUserById, findCircleByPatientId } from '../../db/index.js';
import { events } from '../../orchestrator.js';

export async function handleShowCircleCommand(userId, circleId) {
    const members = await getCircleMembers(circleId);
    const circle = await findCircleByPatientId(circleId);
    if (!circle) {
        events.emit('broadcast', { targetUsers: [userId], reply: 'Error: Could not find the active care circle.', from: 'system', circleId });
        return;
    }
    const patient = await findUserById(circle.primary_patient_id);
    if (!patient) {
        events.emit('broadcast', { targetUsers: [userId], reply: 'Error: Could not find the patient for this circle.', from: 'system', circleId });
        return;
    }

    // Find current user's info in this circle
    const currentUser = await findUserById(userId);
    const currentUserMember = members.find(m => m.user_id === userId);
    const myRole = currentUserMember ? currentUserMember.role : 'unknown';
    const myRelationship = currentUserMember ? currentUserMember.relationship_type : 'unknown';

    // Header showing context
    let header = `\n--- Care Circle for ${patient.username} ---\n`;
    if (userId === circle.primary_patient_id) {
        header += `You are: ${patient.username} (patient - this is your circle)\n`;
    } else {
        header += `You are: ${currentUser.username} (${myRole}`;
        if (myRelationship && myRelationship !== 'null') {
            header += ` - ${myRelationship}`;
        }
        header += `)\n`;
    }
    header += `-----------------------------------\n`;

    // List all members with relationship context
    const patientMember = members.find(m => m.role === 'patient');
    const caregivers = members.filter(m => m.role === 'caregiver');
    const doctors = members.filter(m => m.role === 'doctor');

    let memberList = '';
    
    if (patientMember) {
        memberList += `\n👤 Patient: ${patientMember.username}`;
    }

    if (caregivers.length > 0) {
        memberList += `\n\n👥 Caregivers:`;
        caregivers.forEach(c => {
            memberList += `\n  • ${c.username}`;
            if (c.relationship_type && c.relationship_type !== 'null') {
                memberList += ` (${c.relationship_type} of ${patient.username})`;
            }
            memberList += ` [consent: ${c.consent_level || 'none'}]`;
        });
    }

    if (doctors.length > 0) {
        memberList += `\n\n🩺 Doctors:`;
        doctors.forEach(d => {
            memberList += `\n  • ${d.username}`;
            if (d.relationship_type && d.relationship_type !== 'null') {
                memberList += ` (${d.relationship_type})`;
            }
        });
    }

    const footer = `\n-----------------------------------`;
    const reply = header + memberList + footer;
    events.emit('broadcast', { targetUsers: [userId], reply, from: 'system', circleId });
}

