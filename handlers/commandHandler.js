/**
 * @fileoverview handlers/commandHandler.js
 * The main command dispatcher for the application. This module receives all
 * user commands that begin with a '/', parses them, and routes them to the
 * appropriate specialized handler file in the 'commands' subdirectory.
 */

import { getMemberInfo, updateMemberRole } from '../db/index.js';
import { events } from '../orchestrator.js';

import { handleAddCommand } from './commands/addMember.js';
import { handleSwitchCommand } from './commands/switchContext.js';
import { handleConsentCommand } from './commands/setConsent.js';
import { handleDirectiveCommand } from './commands/logDirective.js';
import { handleAgentDelegateCommand } from './commands/agentDelegate.js';
import { handleShowCircleCommand } from './commands/showCircle.js';
import { handleSetSpecialtyCommand } from './commands/setSpecialty.js';

export async function handleCommand(userId, circleId, message) {
    const parts = message.toLowerCase().split(' ');
    const command = parts[0];
    const currentUserInfo = await getMemberInfo(userId, circleId);

    if (!currentUserInfo) {
        console.error(`[CommandHandler] Could not find member info for user ${userId} in circle ${circleId}`);
        return;
    }

    if (currentUserInfo.role === 'doctor' && circleId === userId) {
        if (!['/switch', '/spec', '/circle'].includes(command)) {
            events.emit('broadcast', { targetUsers: [userId], reply: `[System] Safety alert: You can only use /switch, /circle, or /spec in your personal circle.`, from: 'system', circleId });
            return;
        }
    }

    switch (command) {
        case '/care':
        case '/doc':
            await handleAddCommand(userId, circleId, message);
            break;
        case '/switch':
            await handleSwitchCommand(userId, circleId, parts);
            break;
        case '/consent':
            await handleConsentCommand(userId, circleId, parts);
            break;
        case '/log':
        case '/order':
            if (currentUserInfo.role !== 'doctor') {
                events.emit('broadcast', { targetUsers: [userId], reply: `[System] This command is only available to doctors.`, from: 'system', circleId });
                return;
            }
            await handleDirectiveCommand(userId, circleId, message, command);
            break;
        case '/agent':
             if (currentUserInfo.role !== 'doctor') {
                events.emit('broadcast', { targetUsers: [userId], reply: `[System] This command is only available to doctors.`, from: 'system', circleId });
                return;
            }
            await handleAgentDelegateCommand(userId, circleId, message);
            break;
        case '/circle':
            await handleShowCircleCommand(userId, circleId);
            break;
        case '/spec':
             // FIX: Permissive logic to allow any user to become a doctor.
             if (currentUserInfo.role !== 'doctor') {
                await updateMemberRole(circleId, userId, 'doctor');
                events.emit('broadcast', { targetUsers: [userId], reply: `[System] Your role in this circle has been updated to 'doctor'.`, from: 'system', circleId });
             }
            await handleSetSpecialtyCommand(userId, circleId, parts);
            break;
        case '/clear':
            events.emit('clear_db');
            break;
        default:
            events.emit('broadcast', { targetUsers: [userId], reply: `[System] Unknown command: ${command}`, from: 'system', circleId });
    }
}

