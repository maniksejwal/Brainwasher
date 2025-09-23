/**
 * @fileoverview handlers/commands/agentDelegate.js
 * Handles the '/agent' command for doctor delegation. This allows a doctor to
 * delegate a conversational task to their personal agent, such as asking a
 * patient or caregiver a specific question. It creates a pending action to
 * track the delegated task.
 */

// FIX: Corrected imports. This handler interacts directly with the database
// to log a pending action, it does not use the higher-level state manager.
import { getCircleMembers, findUserByUsername, findUserById, addPendingAction } from '../../db/index.js';
import { generateDelegatedProbe } from '../../agents/index.js';
import { events } from '../../orchestrator.js';
import { randomUUID } from 'crypto';

export async function handleAgentDelegateCommand(userId, circleId, message) {
    const match = message.match(/^\/agent ask (\w+) "(.*)"/);
    if (!match) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Invalid format. Use: /agent ask <username> "your question"`, from: 'system', circleId });
        return;
    }

    const [, targetUsername, topic] = match;

    const members = await getCircleMembers(circleId);
    const targetMember = members.find(m => m.username === targetUsername);
    const doctor = await findUserById(userId);
    const circle = await findCircleByPatientId(circleId);
    const patient = await findUserById(circle.primary_patient_id);


    if (!targetMember) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Error: No user with the name '${targetUsername}' found in this care circle.`, from: 'system', circleId });
        return;
    }

    const probeMessage = await generateDelegatedProbe(doctor.username, patient.username, targetMember.username, topic);

    // Create a pending action so the system knows the doctor is waiting for this user's reply.
    // This is a direct database action.
    await addPendingAction(
        randomUUID(),
        circleId,
        userId, // The action is assigned to the DOCTOR, who is waiting for the reply.
        'delegated_probe_response',
        { topic, target_user_id: targetMember.user_id }
    );
    
    events.emit('broadcast', {
        targetUsers: [targetMember.user_id],
        message: probeMessage,
        from: 'personal-agent',
        circleId,
        patientUsername: patient.username
    });

    events.emit('broadcast', { targetUsers: [userId], reply: `[System] I have asked ${targetUsername} about "${topic}" on your behalf. I will notify you when they respond.`, from: 'system', circleId });
}

