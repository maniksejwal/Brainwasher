import {
    findUserByUsername,
    findUserById,
    findCircleByPatientId,
    addMemberToCircle,
    getMemberInfo,
    getCircleMembers,
    updateMemberConsent
} from '../db/index.js';
import { events } from '../orchestrator.js';

// FIX: Ensure this function is exported as a named export
export async function handleCommand(userId, circleId, message) {
    const parts = message.toLowerCase().split(' ');
    const command = parts[0];
    const currentUserInfo = await getMemberInfo(userId, circleId);

    // Doctor's Role Safety Check for all commands
    if (currentUserInfo.role === 'doctor' && circleId === userId) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Safety alert: You cannot perform clinical actions in your own personal care circle.`, from: 'system', circleId });
        return;
    }

    switch (command) {
        case '/add':
            await handleAddCommand(userId, circleId, parts);
            break;
        case '/switch':
            await handleSwitchCommand(userId, circleId, parts);
            break;
        case '/consent':
            await handleConsentCommand(userId, circleId, parts);
            break;
        case '/clear':
            events.emit('clear_db');
            events.emit('broadcast', { targetUsers: [userId], reply: `[System] Database cleared.`, from: 'system', circleId });
            break;
        default:
            events.emit('broadcast', { targetUsers: [userId], reply: `[System] Unknown command: ${command}`, from: 'system', circleId });
    }
}

async function handleAddCommand(userId, circleId, parts) {
    const targetUsername = parts[1];
    const role = parts[3];
    const relationship = parts[6];

    if (!targetUsername || !role || !relationship || parts[2] !== 'as' || parts[4] !== 'with' || parts[5] !== 'relationship') {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Invalid format. Use: /add <username> as <role> with relationship <relationship>`, from: 'system', circleId });
        return;
    }

    if (circleId !== userId) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] You can only add members to your own care circle.`, from: 'system', circleId });
        return;
    }

    const targetUser = await findUserByUsername(targetUsername);
    if (!targetUser) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Error: User '${targetUsername}' not found. They must log in once to create an account.`, from: 'system', circleId });
        return;
    }

    await addMemberToCircle(circleId, targetUser.user_id, role, relationship);
    events.emit('broadcast', { targetUsers: [userId], reply: `[System] Added '${targetUsername}' to your care circle as a '${role}'.`, from: 'system', circleId });
}

async function handleSwitchCommand(userId, circleId, parts) {
    const targetPatientUsername = parts[1];
    if (!targetPatientUsername) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Invalid format. Use: /switch <patient_username>`, from: 'system', circleId });
        return;
    }

    const currentUser = await findUserById(userId);
    if (targetPatientUsername === currentUser.username) {
        const personalCircle = await findCircleByPatientId(userId);
        events.emit('context_switch', { userId, newCircleId: personalCircle.circle_id });
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
    } else {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] You are not a member of the care circle for patient '${targetPatientUsername}'.`, from: 'system', circleId });
    }
}

async function handleConsentCommand(userId, circleId, parts) {
    const targetUsername = parts[1];
    const level = parts[2];

    if (circleId !== userId) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] You can only set consent within your own care circle.`, from: 'system', circleId });
        return;
    }
    if (!targetUsername || !level || !['none', 'limited', 'full'].includes(level)) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Invalid format. Use: /consent <username> <level>`, from: 'system', circleId });
        return;
    }

    const members = await getCircleMembers(circleId);
    const targetMember = members.find(m => m.username === targetUsername);

    if (!targetMember) {
        events.emit('broadcast', { targetUsers: [userId], reply: `[System] Error: User '${targetUsername}' is not a member of this care circle.`, from: 'system', circleId });
        return;
    }

    await updateMemberConsent(circleId, targetMember.user_id, level);
    events.emit('broadcast', { targetUsers: [userId], reply: `[System] Consent for '${targetUsername}' in this circle set to '${level}'.`, from: 'system', circleId });
}

