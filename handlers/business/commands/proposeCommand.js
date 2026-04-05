/**
 * @fileoverview /propose command - Make negotiation offer
 * Usage: /propose $10000 "explanation"
 */

import sessionManager from '../../../sessions/sessionManager.js';
import { NegotiationAgent } from '../../../agents/business/negotiationAgent.js';
import { events } from '../../../orchestrator.js';
import { findUserById } from '../../../db/index.js';

export async function handleProposeCommand(userId, sessionId, parts, sendMessage) {
    const session = await sessionManager.getSession(sessionId);
    if (!session || !session.participants.includes(userId)) {
        sendMessage(userId, '❌ No active negotiation session');
        return;
    }

    // Parse value
    const valueMatch = parts.join(' ').match(/\$?([\d,]+)/);
    if (!valueMatch) {
        sendMessage(userId, '❌ Specify a value: /propose $10000 "explanation"');
        return;
    }

    const value = parseInt(valueMatch[1].replace(/,/g, ''));
    const explanation = parts.join(' ').match(/"([^"]+)"/)?.[1] || '';

    // Get user's agent
    const userConstraints = session.metadata.constraints[userId];
    const role = session.metadata.roles[userId];
    const agent = new NegotiationAgent(userId, userConstraints, role);

    // Add to session
    await sessionManager.addMessage(session.id, userId, 'proposal', explanation, {
        value,
        type: 'PROPOSE'
    });

    // Notify counterparty
    const counterpartyId = session.participants.find(p => p !== userId);
    const counterpartyUser = await findUserById(counterpartyId);
    const proposerUser = await findUserById(userId);

    events.emit('broadcast', {
        targetUsers: [counterpartyId],
        message: `💰 @${proposerUser.username} proposed: $${value.toLocaleString()}\n"${explanation}"\n\nRespond with:\n  /counter $X  - Counter-offer\n  /accept      - Accept this offer`,
        from: 'NegotiationAgent',
        sessionId: session.id
    });

    sendMessage(userId, `✅ Proposal sent: $${value.toLocaleString()}`);
    
    console.log(`[Business] ${proposerUser.username} proposed $${value} in session ${session.id}`);
}

