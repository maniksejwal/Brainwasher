/**
 * @fileoverview CRM commands - Lead and opportunity management
 * /crm lead, /crm pipeline, /crm convert
 */

import { CRMAgent } from '../../../agents/business/crmAgent.js';
import { randomUUID } from 'crypto';

export async function handleCRMCommand(userId, parts, sendMessage) {
    const crm = new CRMAgent();

    if (parts.length < 2) {
        sendMessage(userId,
            `📊 CRM Commands:\n\n` +
            `  /crm lead add "Company" @contact value:10000    - Add new lead\n` +
            `  /crm pipeline                                    - Show your sales pipeline\n` +
            `  /crm convert <lead_id> "Deal Name"              - Convert lead to opportunity\n` +
            `  /crm stage <opp_id> <stage>                     - Update opportunity stage\n\n` +
            `Stages: proposal, negotiation, legal_review, closed_won, closed_lost`
        );
        return;
    }

    const subcommand = parts[1];

    if (subcommand === 'lead' && parts[2] === 'add') {
        await addLead(userId, parts, crm, sendMessage);
    } else if (subcommand === 'pipeline') {
        await showPipeline(userId, crm, sendMessage);
    } else if (subcommand === 'convert') {
        await convertLead(userId, parts, crm, sendMessage);
    } else if (subcommand === 'stage') {
        await updateStage(userId, parts, crm, sendMessage);
    }
}

async function addLead(userId, parts, crm, sendMessage) {
    const companyMatch = parts.join(' ').match(/"([^"]+)"/);
    const contactMatch = parts.find(p => p.startsWith('@'));
    const valueMatch = parts.find(p => p.startsWith('value:'));

    if (!companyMatch) {
        sendMessage(userId, '❌ Specify company name in quotes');
        return;
    }

    const company = companyMatch[1];
    const value = valueMatch ? parseInt(valueMatch.split(':')[1]) : 10000;
    
    const leadId = await crm.createLead(company, null, value, 'manual');

    sendMessage(userId, 
        `✅ Lead created!\n\n` +
        `Company: ${company}\n` +
        `Estimated value: $${value.toLocaleString()}\n` +
        `Lead ID: ${leadId}\n\n` +
        `Next: Qualify and convert to opportunity`
    );
}

async function showPipeline(userId, crm, sendMessage) {
    const pipeline = await crm.getPipelineSummary(userId);

    if (pipeline.length === 0) {
        sendMessage(userId, '📊 Your pipeline is empty. Add leads with /crm lead add');
        return;
    }

    let message = '📊 Your Sales Pipeline:\n\n';
    let totalValue = 0;

    for (const stage of pipeline) {
        message += `${stageEmoji(stage.stage)} ${stage.stage}: ${stage.count} deals ($${stage.total_value.toLocaleString()})\n`;
        totalValue += stage.total_value;
    }

    message += `\n💰 Total pipeline value: $${totalValue.toLocaleString()}`;

    sendMessage(userId, message);
}

async function convertLead(userId, parts, crm, sendMessage) {
    const leadId = parts[2];
    const dealName = parts.join(' ').match(/"([^"]+)"/)?.[1];

    if (!leadId || !dealName) {
        sendMessage(userId, '❌ Usage: /crm convert <lead_id> "Deal Name"');
        return;
    }

    const opportunityId = await crm.convertToOpportunity(leadId, dealName, 10000, userId, null);

    sendMessage(userId,
        `✅ Lead converted to opportunity!\n\n` +
        `Deal: ${dealName}\n` +
        `Opportunity ID: ${opportunityId}\n` +
        `Stage: proposal\n\n` +
        `Next: Start negotiation with /negotiate start @counterparty`
    );
}

async function updateStage(userId, parts, crm, sendMessage) {
    const oppId = parts[2];
    const newStage = parts[3];

    if (!oppId || !newStage) {
        sendMessage(userId, '❌ Usage: /crm stage <opp_id> <stage>');
        return;
    }

    await crm.updateOpportunityStage(oppId, newStage);
    sendMessage(userId, `✅ Opportunity updated to: ${newStage}`);
}

function stageEmoji(stage) {
    const emojis = {
        'proposal': '📝',
        'negotiation': '💬',
        'legal_review': '⚖️',
        'closed_won': '🎉',
        'closed_lost': '❌'
    };
    return emojis[stage] || '📌';
}

