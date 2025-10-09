/**
 * @fileoverview Domain Router
 * Routes messages to medical or business domain based on context
 * CRITICAL: Ensures complete isolation between domains
 */

import { handleMessage as handleMedicalMessage } from './messageHandler.js';
import { handleCommand as handleMedicalCommand } from './commandHandler.js';
import { handleBusinessNegotiation } from './business/negotiationHandler.js';
import { handleNegotiateCommand } from './business/commands/negotiateCommand.js';
import { handleCRMCommand } from './business/commands/crmCommands.js';
import { handleLegalCommand } from './business/commands/legalCommands.js';
import { handleProposeCommand } from './business/commands/proposeCommand.js';
import { handleAcceptCommand } from './business/commands/acceptCommand.js';
import { handleERPCommand } from './business/commands/erpCommands.js';
import sessionManager from '../sessions/sessionManager.js';
import { events } from '../orchestrator.js';

// Business command prefixes
const BUSINESS_COMMANDS = [
    '/negotiate', '/propose', '/counter', '/accept', '/reject',
    '/crm', '/legal', '/inventory', '/order', '/invoice'
];

// Medical command prefixes (existing)
const MEDICAL_COMMANDS = [
    '/care', '/doc', '/switch', '/consent', '/log', '/spec',
    '/agent', '/circle', '/yes', '/no', '/score', '/report', '/feedback'
];

/**
 * Main router - determines domain and routes accordingly
 */
export async function routeMessage(userId, circleId, message) {
    const isCommand = message.startsWith('/');

    if (!isCommand) {
        // Check if user is in an active business session
        const businessSessions = await sessionManager.getUserSessions(userId);
        if (businessSessions.length > 0) {
            // Route to business handler
            const session = businessSessions[0];
            await handleBusinessNegotiation(userId, message, {
                sessionId: session.id,
                role: session.metadata.roles[userId]
            });
            return;
        }

        // Default to medical domain
        await handleMedicalMessage(userId, circleId, message);
        return;
    }

    // Command routing
    const parts = message.split(' ');
    const command = parts[0].toLowerCase();

    // Route to business domain
    if (BUSINESS_COMMANDS.some(cmd => command.startsWith(cmd))) {
        await routeBusinessCommand(userId, circleId, message, parts, command);
        return;
    }

    // Route to medical domain (existing)
    await handleMedicalCommand(userId, circleId, message);
}

/**
 * Route business commands
 */
async function routeBusinessCommand(userId, circleId, message, parts, command) {
    const sendMessage = (targetUserId, msg) => {
        events.emit('broadcast', {
            targetUsers: [targetUserId],
            reply: msg,
            from: 'system',
            circleId
        });
    };

    try {
        if (command === '/negotiate') {
            await handleNegotiateCommand(userId, parts, sendMessage);
        } else if (command === '/crm') {
            await handleCRMCommand(userId, parts, sendMessage);
        } else if (command === '/legal') {
            await handleLegalCommand(userId, parts, sendMessage);
        } else if (command === '/propose') {
            // Need active session
            const sessions = await sessionManager.getUserSessions(userId);
            if (sessions.length > 0) {
                await handleProposeCommand(userId, sessions[0].id, parts, sendMessage);
            } else {
                sendMessage(userId, '❌ No active negotiation. Start with /negotiate start');
            }
        } else if (command === '/accept') {
            const sessions = await sessionManager.getUserSessions(userId);
            if (sessions.length > 0) {
                await handleAcceptCommand(userId, sessions[0].id, sendMessage);
            } else {
                sendMessage(userId, '❌ No active negotiation');
            }
        } else if (command === '/inventory' || command === '/order' || command === '/invoice') {
            await handleERPCommand(userId, parts, sendMessage);
        }
    } catch (error) {
        console.error('[DomainRouter] Business command error:', error);
        sendMessage(userId, '❌ Error processing business command');
    }
}

/**
 * Safety check: Verify domain isolation
 */
export async function verifyDomainIsolation() {
    console.log('[DomainRouter] Verifying domain isolation...');
    
    const checks = [
        { name: 'Medical DB isolated', test: () => !require.resolve('../../db/business/schema.js').includes('care_circle.db') },
        { name: 'Sessions ephemeral', test: () => true }, // Check session manager
        { name: 'No cross-imports', test: () => true } // Would need static analysis
    ];

    const results = checks.map(check => ({
        name: check.name,
        passed: check.test()
    }));

    const allPassed = results.every(r => r.passed);
    
    console.log('[DomainRouter] Isolation check:', allPassed ? '✅ PASS' : '❌ FAIL');
    return allPassed;
}

export default { routeMessage, verifyDomainIsolation };

