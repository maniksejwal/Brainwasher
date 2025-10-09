/**
 * @fileoverview Legal team commands
 * /legal review, /legal approve, /legal flag
 */

import { LegalAgent } from '../../../agents/business/legalAgent.js';
import { getDb } from '../../../db/connection.js';
import { events } from '../../../orchestrator.js';

export async function handleLegalCommand(userId, parts, sendMessage) {
    const legal = new LegalAgent(userId);

    if (parts.length < 2) {
        sendMessage(userId,
            `⚖️ Legal Team Commands:\n\n` +
            `  /legal review <contract_id>           - Review a contract\n` +
            `  /legal approve <contract_id>          - Approve contract\n` +
            `  /legal flag <contract_id> "clause"    - Flag problematic clause\n` +
            `  /legal pending                        - Show contracts pending review\n` +
            `  /legal create <opp_id> <type>         - Create contract for opportunity\n\n` +
            `Contract types: NDA, MSA, SOW, purchase_order`
        );
        return;
    }

    const subcommand = parts[1];

    if (subcommand === 'review') {
        await reviewContract(userId, parts[2], legal, sendMessage);
    } else if (subcommand === 'approve') {
        await approveContract(userId, parts[2], legal, sendMessage);
    } else if (subcommand === 'flag') {
        await flagClause(userId, parts, legal, sendMessage);
    } else if (subcommand === 'pending') {
        await showPending(userId, sendMessage);
    } else if (subcommand === 'create') {
        await createContract(userId, parts, legal, sendMessage);
    }
}

async function reviewContract(userId, contractId, legal, sendMessage) {
    const db = await getDb();
    
    const contract = await db.get('SELECT * FROM legal_contracts WHERE id = ?', [contractId]);
    if (!contract) {
        sendMessage(userId, '❌ Contract not found');
        return;
    }

    sendMessage(userId, '⏳ Reviewing contract...');

    const review = await legal.reviewContract(contract.content, contract.contract_type);

    // Update contract with risk assessment
    await db.run(`
        UPDATE legal_contracts 
        SET risk_level = ?, reviewed_at = ?
        WHERE id = ?
    `, [review.riskLevel, Date.now(), contractId]);

    sendMessage(userId,
        `⚖️ Legal Review Complete\n\n` +
        `Contract: ${contract.contract_type}\n` +
        `Risk Level: ${review.riskLevel}\n\n` +
        `${review.review}\n\n` +
        `${review.recommendation}\n\n` +
        `Flagged clauses: ${review.clauses.length}`
    );

    console.log(`[Legal] Contract ${contractId} reviewed: ${review.riskLevel} risk`);
}

async function approveContract(userId, contractId, legal, sendMessage) {
    await legal.approveContract(contractId);

    sendMessage(userId, 
        `✅ Contract approved!\n\n` +
        `Contract ID: ${contractId}\n` +
        `Approved by: Legal team\n` +
        `Timestamp: ${new Date().toLocaleString()}\n\n` +
        `Next: Parties can sign with /sign ${contractId}`
    );
}

async function flagClause(userId, parts, legal, sendMessage) {
    const contractId = parts[2];
    const clauseDesc = parts.join(' ').match(/"([^"]+)"/)?.[1];

    if (!clauseDesc) {
        sendMessage(userId, '❌ Specify clause in quotes: /legal flag <id> "problematic clause"');
        return;
    }

    const clauseId = await legal.flagClause(
        contractId,
        'custom',
        clauseDesc,
        'high',
        'Requires negotiation'
    );

    sendMessage(userId,
        `🚩 Clause flagged\n\n` +
        `Clause: "${clauseDesc}"\n` +
        `Risk: High\n` +
        `Action: Requires changes before approval`
    );
}

async function showPending(userId, sendMessage) {
    const db = await getDb();
    
    const pending = await db.all(`
        SELECT id, contract_type, created_at, risk_level
        FROM legal_contracts
        WHERE (assigned_legal = ? OR assigned_legal IS NULL) 
        AND status = 'in_review'
    `, [userId]);

    if (pending.length === 0) {
        sendMessage(userId, '📋 No contracts pending review');
        return;
    }

    let message = '⚖️ Contracts Pending Review:\n\n';
    for (const contract of pending) {
        message += `${riskEmoji(contract.risk_level)} ${contract.contract_type} - ${contract.id}\n`;
        message += `   Created: ${new Date(contract.created_at).toLocaleDateString()}\n\n`;
    }

    sendMessage(userId, message);
}

async function createContract(userId, parts, legal, sendMessage) {
    const oppId = parts[2];
    const contractType = parts[3] || 'MSA';

    const contractId = await legal.createContract(
        oppId,
        contractType,
        `[Contract template for ${contractType}]\n\n(Auto-generated, ready for editing)`,
        userId
    );

    sendMessage(userId,
        `✅ Contract created\n\n` +
        `Type: ${contractType}\n` +
        `Contract ID: ${contractId}\n\n` +
        `Next: Edit and submit for legal review`
    );
}

function riskEmoji(level) {
    return { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[level] || '⚪';
}

export { handleLegalCommand };

