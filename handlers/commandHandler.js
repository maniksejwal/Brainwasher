/**
 * @fileoverview handlers/commandHandler.js
 * The main command dispatcher for the application. This module receives all
 * user commands and routes them to the appropriate handler. It now recognizes
 * response commands like /yes and /no.
 */

import { getMemberInfo, updateMemberRole } from '../db/index.js';
import { events } from '../orchestrator.js';
import { handleUserResponseToAction } from '../state_manager.js';
import { executeResolvedAction } from './message_logic/actionExecutor.js';

import { handleAddCommand } from './commands/addMember.js';
import { handleSwitchCommand } from './commands/switchContext.js';
import { handleConsentCommand } from './commands/setConsent.js';
import { handleDirectiveCommand } from './commands/logDirective.js';
import { handleAgentDelegateCommand } from './commands/agentDelegate.js';
import { handleShowCircleCommand } from './commands/showCircle.js';
import { handleSetSpecialtyCommand } from './commands/setSpecialty.js';
import { handleScoreCommand } from './commands/scoreCommand.js';
import { handleReportCommand } from './commands/reportCommand.js';
import { handleFeedbackCommand } from './commands/feedbackCommand.js';

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
        case '/yes':
        case '/no':
            const actionResult = await handleUserResponseToAction(userId, circleId, message);
            if (actionResult) {
                await executeResolvedAction(actionResult, userId, circleId);
            } else {
                events.emit('broadcast', { targetUsers: [userId], reply: `[System] There are no pending questions for you to answer right now.`, from: 'system', circleId });
            }
            break;
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
             if (currentUserInfo.role !== 'doctor') {
                await updateMemberRole(circleId, userId, 'doctor');
                events.emit('broadcast', { targetUsers: [userId], reply: `[System] Your role in this circle has been updated to 'doctor'.`, from: 'system', circleId });
             }
            await handleSetSpecialtyCommand(userId, circleId, parts);
            break;
        case '/clear':
            events.emit('clear_db');
            break;
        case '/score':
            // Helper function to send message back to user
            const sendMessageToUser = (targetUserId, msg) => {
                events.emit('broadcast', { 
                    targetUsers: [targetUserId], 
                    reply: msg, 
                    from: 'system', 
                    circleId 
                });
            };
            await handleScoreCommand(userId, circleId, parts, sendMessageToUser);
            break;
        case '/report':
            // Reuse the same helper function
            const sendReportMessage = (targetUserId, msg) => {
                events.emit('broadcast', { 
                    targetUsers: [targetUserId], 
                    reply: msg, 
                    from: 'system', 
                    circleId 
                });
            };
            await handleReportCommand(userId, circleId, parts, sendReportMessage);
            break;
        case '/feedback':
            // Unified feedback command
            const sendFeedbackMessage = (targetUserId, msg) => {
                events.emit('broadcast', { 
                    targetUsers: [targetUserId], 
                    reply: msg, 
                    from: 'system', 
                    circleId 
                });
            };
            await handleFeedbackCommand(userId, circleId, parts, sendFeedbackMessage);
            break;
        default:
            events.emit('broadcast', { targetUsers: [userId], reply: `[System] Unknown command: ${command}`, from: 'system', circleId });
    }
}

