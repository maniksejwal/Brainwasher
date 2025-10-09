/**
 * @fileoverview /negotiate command - Start business negotiation
 * Usage: /negotiate start @bob "Product X purchase" min:5000 max:10000
 */

import sessionManager from '../../../sessions/sessionManager.js';
import { CRMAgent } from '../../../agents/business/crmAgent.js';
import { events } from '../../../orchestrator.js';
import { findUserByUsername } from '../../../db/index.js';

export async function handleNegotiateCommand(userId, parts, sendMessage) {
    if (parts.length < 4) {
        sendMessage(userId, 
            `💼 Start a business negotiation:\n\n` +
            `Usage: /negotiate start @username "topic" min:X max:Y\n\n` +
            `Example:\n` +
            `  /negotiate start @bob "Product licensing" min:5000 max:10000\n\n` +
            `Other commands:\n` +
            `  /negotiate list              - Show your active negotiations\n` +
            `  /negotiate status <id>       - Check negotiation status\n` +
            `  /negotiate terminate <id>    - End a negotiation`
        );
        return;
    }

    const subcommand = parts[1];

    if (subcommand === 'start') {
        await startNegotiation(userId, parts, sendMessage);
    } else if (subcommand === 'list') {
        await listNegotiations(userId, sendMessage);
    } else if (subcommand === 'status') {
        await showNegotiationStatus(userId, parts[2], sendMessage);
    } else if (subcommand === 'terminate') {
        await terminateNegotiation(userId, parts[2], sendMessage);
    }
}

async function startNegotiation(userId, parts, sendMessage) {
    // Parse: /negotiate start @username "topic" min:X max:Y
    const counterpartyMatch = parts.find(p => p.startsWith('@'));
    const topicMatch = parts.join(' ').match(/"([^"]+)"/);
    const minMatch = parts.find(p => p.startsWith('min:'));
    const maxMatch = parts.find(p => p.startsWith('max:'));

    if (!counterpartyMatch || !topicMatch) {
        sendMessage(userId, '❌ Missing required parameters. Check usage with /negotiate');
        return;
    }

    const counterpartyUsername = counterpartyMatch.substring(1);
    const topic = topicMatch[1];
    const minPrice = minMatch ? parseInt(minMatch.split(':')[1]) : 0;
    const maxPrice = maxMatch ? parseInt(maxMatch.split(':')[1]) : 100000;

    // Find counterparty
    const counterparty = await findUserByUsername(counterpartyUsername);
    if (!counterparty) {
        sendMessage(userId, `❌ User @${counterpartyUsername} not found`);
        return;
    }

    // Create CRM opportunity
    const crmAgent = new CRMAgent();
    const opportunityId = await crmAgent.convertToOpportunity(
        null, // No lead yet
        topic,
        (minPrice + maxPrice) / 2,
        userId,
        counterparty.user_id
    );

    // Create ephemeral session
    const session = await sessionManager.createSession(
        [userId, counterparty.user_id],
        topic,
        'negotiation',
        {
            opportunityId,
            constraints: {
                [userId]: { minPrice, maxPrice, BATNA: 0, deadline: Date.now() + 86400000 },
                [counterparty.user_id]: {} // They'll set their own
            },
            roles: {
                [userId]: 'buyer',
                [counterparty.user_id]: 'seller'
            }
        }
    );

    // Notify both parties
    sendMessage(userId, 
        `✅ Negotiation started!\n\n` +
        `Topic: ${topic}\n` +
        `Counterparty: @${counterpartyUsername}\n` +
        `Your range: $${minPrice} - $${maxPrice}\n` +
        `Session ID: ${session.id}\n\n` +
        `Use:\n` +
        `  /propose $X "explanation"  - Make an offer\n` +
        `  /counter $X                 - Counter their offer\n` +
        `  /accept                     - Accept current offer`
    );

    events.emit('broadcast', {
        targetUsers: [counterparty.user_id],
        message: `💼 Negotiation Request\n\n@${(await findUserById(userId)).username} wants to negotiate: "${topic}"\n\nSession: ${session.id}\n\nSet your constraints: /setrange min:X max:Y\nThen respond with: /propose $X`,
        from: 'system'
    });

    console.log(`[Business] Negotiation started: ${session.id}`);
}

async function listNegotiations(userId, sendMessage) {
    const sessions = await sessionManager.getUserSessions(userId);

    if (sessions.length === 0) {
        sendMessage(userId, '📋 No active negotiations');
        return;
    }

    let message = '💼 Your Active Negotiations:\n\n';
    for (const session of sessions) {
        const otherParty = session.participants.find(p => p !== userId);
        const otherUser = await findUserById(otherParty);
        message += `📌 ${session.topic}\n`;
        message += `   With: @${otherUser.username}\n`;
        message += `   Status: ${session.status}\n`;
        message += `   Session: ${session.id}\n\n`;
    }

    sendMessage(userId, message);
}

async function showNegotiationStatus(userId, sessionId, sendMessage) {
    const session = await sessionManager.getSession(sessionId);
    
    if (!session) {
        sendMessage(userId, '❌ Session not found');
        return;
    }

    if (!session.participants.includes(userId)) {
        sendMessage(userId, '❌ You are not part of this negotiation');
        return;
    }

    const messageCount = session.messages.length;
    const lastMessage = session.messages[session.messages.length - 1];

    sendMessage(userId, 
        `📊 Negotiation Status\n\n` +
        `Topic: ${session.topic}\n` +
        `Messages exchanged: ${messageCount}\n` +
        `Last activity: ${lastMessage ? new Date(lastMessage.timestamp).toLocaleString() : 'None'}\n` +
        `Status: ${session.status}`
    );
}

async function terminateNegotiation(userId, sessionId, sendMessage) {
    const agreement = await sessionManager.concludeSession(sessionId, 'terminated', null);
    
    if (agreement) {
        sendMessage(userId, 
            `✋ Negotiation terminated\n\n` +
            `All messages and agent data have been destroyed for privacy.\n` +
            `Session: ${sessionId}`
        );
    }
}

