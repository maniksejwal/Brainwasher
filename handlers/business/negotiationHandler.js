/**
 * @fileoverview Business negotiation handler
 * Manages multi-party business negotiations with game theory
 */

import { NegotiationAgent } from '../../agents/business/negotiationAgent.js';
import { CRMAgent } from '../../agents/business/crmAgent.js';
import { LegalAgent } from '../../agents/business/legalAgent.js';
import sessionManager from '../../sessions/sessionManager.js';
import { events } from '../../orchestrator.js';
import { findUserById } from '../../db/index.js';

export async function handleBusinessNegotiation(userId, message, context) {
    const { sessionId, role } = context;

    // Get or create session
    let session = await sessionManager.getSession(sessionId);
    
    if (!session) {
        console.log(`[BusinessHandler] No active session for ${userId}`);
        return;
    }

    // Route to appropriate handler based on role
    if (role === 'legal') {
        await handleLegalReview(userId, message, session);
    } else {
        await handleNegotiationMessage(userId, message, session);
    }
}

async function handleNegotiationMessage(userId, message, session) {
    // Create agent for user if not exists
    if (!session.agents) {
        session.agents = {};
    }

    if (!session.agents[userId]) {
        const constraints = session.metadata.constraints[userId];
        const role = session.metadata.roles[userId];
        session.agents[userId] = new NegotiationAgent(userId, constraints, role);
    }

    const agent = session.agents[userId];

    // Parse user intent
    const intent = await parseNegotiationIntent(message);

    if (intent.type === 'PROPOSE') {
        const proposal = await agent.generateOpeningProposal({
            topic: session.topic,
            marketInfo: session.metadata.marketInfo || {}
        });

        await sessionManager.addMessage(session.id, userId, 'proposal', proposal.message, {
            value: proposal.value,
            reasoning: proposal.reasoning
        });

        // Notify counterparty
        const counterpartyId = session.participants.find(p => p !== userId);
        const counterpartyUser = await findUserById(counterpartyId);
        
        events.emit('broadcast', {
            targetUsers: [counterpartyId],
            message: `💼 ${counterpartyUser.username} proposed: ${proposal.message}`,
            from: 'NegotiationAgent',
            sessionId: session.id
        });
    } else if (intent.type === 'COUNTER') {
        // Handle counter-offer logic
        // ... (similar structure)
    }

    // Update session
    await sessionManager.updateAgentState(session.id, userId, agent.getInternalState());
}

async function handleLegalReview(userId, message, session) {
    const legalAgent = new LegalAgent(userId);

    // Check if there's a contract to review
    if (session.metadata.contractId) {
        const review = await legalAgent.reviewContract(
            session.metadata.contractText,
            session.metadata.contractType
        );

        // Send review back to user
        const user = await findUserById(userId);
        events.emit('broadcast', {
            targetUsers: [userId],
            message: `⚖️ Legal Review:\n${review.review}\n\nRisk: ${review.riskLevel}\nRecommendation: ${review.recommendation}`,
            from: 'LegalAgent',
            sessionId: session.id
        });

        // Update contract status based on review
        if (review.riskLevel === 'low') {
            await legalAgent.approveContract(session.metadata.contractId);
        } else {
            await legalAgent.requestChanges(session.metadata.contractId, review.clauses);
        }
    }
}

async function parseNegotiationIntent(message) {
    // Simple intent parsing (can be enhanced with NLP)
    const lower = message.toLowerCase();
    
    if (lower.includes('propose') || lower.includes('offer')) {
        const match = message.match(/\$?([\d,]+)/);
        return {
            type: 'PROPOSE',
            value: match ? parseInt(match[1].replace(/,/g, '')) : null
        };
    } else if (lower.includes('counter')) {
        const match = message.match(/\$?([\d,]+)/);
        return {
            type: 'COUNTER',
            value: match ? parseInt(match[1].replace(/,/g, '')) : null
        };
    } else if (lower.includes('accept') || lower.includes('deal')) {
        return { type: 'ACCEPT' };
    } else if (lower.includes('reject') || lower.includes('decline')) {
        return { type: 'REJECT' };
    }

    return { type: 'QUESTION' };
}

export { handleBusinessNegotiation };

