/**
 * @fileoverview /accept command - Accept negotiation offer
 */

import sessionManager from '../../../sessions/sessionManager.js';
import { CRMAgent } from '../../../agents/business/crmAgent.js';
import { events } from '../../../orchestrator.js';
import { findUserById } from '../../../db/index.js';

export async function handleAcceptCommand(userId, sessionId, sendMessage) {
    const session = await sessionManager.getSession(sessionId);
    if (!session || !session.participants.includes(userId)) {
        sendMessage(userId, '❌ No active negotiation');
        return;
    }

    // Get last offer
    const lastOffer = session.messages
        .filter(m => m.type === 'proposal' || m.type === 'counter')
        .pop();

    if (!lastOffer) {
        sendMessage(userId, '❌ No offer to accept');
        return;
    }

    const agreedValue = lastOffer.terms.value;

    // Create final agreement
    const finalTerms = {
        agreedValue,
        buyer: session.metadata.roles[userId] === 'buyer' ? userId : session.participants.find(p => p !== userId),
        seller: session.metadata.roles[userId] === 'seller' ? userId : session.participants.find(p => p !== userId),
        topic: session.topic,
        timestamp: Date.now()
    };

    // Conclude session and destroy ephemeral data
    const agreement = await sessionManager.concludeSession(session.id, 'success', finalTerms);

    // Update CRM
    const crmAgent = new CRMAgent();
    if (session.metadata.opportunityId) {
        await crmAgent.updateOpportunityStage(session.metadata.opportunityId, 'closed_won');
    }

    // Notify both parties
    const counterpartyId = session.participants.find(p => p !== userId);
    const acceptorUser = await findUserById(userId);
    const counterpartyUser = await findUserById(counterpartyId);

    const dealMessage = 
        `🎉 DEAL CLOSED!\n\n` +
        `Topic: ${session.topic}\n` +
        `Agreed Value: $${agreedValue.toLocaleString()}\n` +
        `Parties: @${acceptorUser.username} ↔ @${counterpartyUser.username}\n\n` +
        `✅ Agreement saved\n` +
        `🔒 All negotiation messages destroyed for privacy\n` +
        `🤖 Agent data erased\n\n` +
        `Next: /legal review to create contract`;

    sendMessage(userId, dealMessage);
    events.emit('broadcast', {
        targetUsers: [counterpartyId],
        message: dealMessage,
        from: 'system'
    });

    console.log(`[Business] Deal closed: ${session.topic} for $${agreedValue}`);
}

export { handleAcceptCommand };

