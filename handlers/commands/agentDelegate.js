/**
 * @fileoverview handlers/commands/agentDelegate.js
 * Handles the '/agent' command for doctor delegation. This allows a doctor to
 * delegate a conversational task to their personal agent, such as asking a
 * patient or caregiver a specific question. It creates a pending action to
 * track the delegated task.
 */

// This handler interacts directly with the database to log a pending action, it does not use the higher-level state manager.
import { getCircleMembers, findUserByUsername, findUserById, addPendingAction, findCircleByPatientId } from '../../db/index.js';
import { generateDelegatedProbe } from '../../agents/index.js';
import { events } from '../../orchestrator.js';
import { randomUUID } from 'crypto';
import { getAgentName } from '../utils/agentIdentity.js';

export async function handleAgentDelegateCommand(userId, circleId, message) {
    const match = message.match(/^\/agent ask (\w+) "(.*)"/);
    if (!match) {
        events.emit('broadcast', { targetUsers: [userId], reply: `Invalid format. Use: /agent ask <username_or_role> "your question"`, from: 'system', circleId });
        return;
    }

    const [, targetIdentifier, topic] = match;

    const members = await getCircleMembers(circleId);
    const doctor = await findUserById(userId);
    const circle = await findCircleByPatientId(circleId);
    const patient = await findUserById(circle.primary_patient_id);

    // Try to find target by username first, then by role
    let targetMember = members.find(m => m.username === targetIdentifier);
    
    if (!targetMember) {
        // If not found by username, try to find by role
        targetMember = members.find(m => m.role === targetIdentifier);
    }

    if (!targetMember) {
        events.emit('broadcast', { targetUsers: [userId], reply: `Error: No user with the name or role '${targetIdentifier}' found in this care circle.`, from: 'system', circleId });
        return;
    }

    const probeMessage = await generateDelegatedProbe(targetMember.username, topic);

    // Create a pending action so the system knows the doctor is waiting for this user's reply.
    // This is a direct database action.
    await addPendingAction(
        randomUUID(),
        circleId,
        userId, // The action is assigned to the DOCTOR, who is waiting for the reply.
        'delegated_probe_response',
        { topic, target_user_id: targetMember.user_id }
    );
    
    const agentName = await getAgentName(targetMember.user_id, circleId);
    events.emit('broadcast', {
        targetUsers: [targetMember.user_id],
        message: probeMessage,
        from: agentName,
        circleId,
        patientUsername: patient.username
    });

    events.emit('broadcast', { targetUsers: [userId], reply: `I have asked ${targetMember.username} (${targetMember.role}) about "${topic}" on your behalf. I will notify you when they respond.`, from: 'system', circleId });
}

