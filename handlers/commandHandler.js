/**
 * @fileoverview The main command dispatcher.
 * This module receives all user commands, parses them, and routes them to the
 * appropriate specialized handler file in the 'commands' subdirectory.
 */

import { getMemberInfo } from '../db/index.js';
import { events } from '../orchestrator.js';

// Import the specialized command handlers
import { handleAddCommand } from './commands/addMember.js';
import { handleSwitchCommand } from './commands/switchContext.js';
import { handleConsentCommand } from './commands/setConsent.js';
import { handleDirectiveCommand } from './commands/logDirective.js';
import { handleAgentDelegateCommand } from './commands/agentDelegate.js';

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
        case '/clear':
            events.emit('clear_db');
            events.emit('broadcast', { targetUsers: [userId], reply: `[System] Database cleared.`, from: 'system', circleId });
            break;
        default:
            events.emit('broadcast', { targetUsers: [userId], reply: `[System] Unknown command: ${command}`, from: 'system', circleId });
    }
}

