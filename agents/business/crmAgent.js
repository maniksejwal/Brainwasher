/**
 * @fileoverview CRM Agent - Sales pipeline and relationship management
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import config from '../../config.js';
import { CRM_AGENT_PROMPT } from '../../prompts/business/negotiation_prompts.js';
import { getDb } from '../../db/connection.js';
import { randomUUID } from 'crypto';

class CRMAgent {
    constructor() {
        if (config.CHAT_GPT_KEY) {
            this.openai = new OpenAI({ apiKey: config.CHAT_GPT_KEY });
            this.useOpenAI = true;
        } else if (config.API_KEYS?.length > 0) {
            this.genAI = new GoogleGenerativeAI(config.API_KEYS[0]);
            this.useOpenAI = false;
        }
    }

    /**
     * Analyze conversation for CRM signals
     */
    async analyzeConversation(userId, message, conversationHistory) {
        const prompt = `${CRM_AGENT_PROMPT}\n\nConversation:\n${message}\n\nExtract CRM insights (lead quality, budget, timeline, decision authority).`;

        const analysis = await this._callLLM(prompt);
        
        return {
            leadQuality: this._extractLeadQuality(analysis),
            budgetSignals: this._extractBudgetSignals(analysis),
            timeline: this._extractTimeline(analysis),
            nextAction: this._suggestNextAction(analysis)
        };
    }

    /**
     * Create or update lead
     */
    async createLead(companyName, contactUserId, valueEstimate, source) {
        const db = await getDb();
        const leadId = randomUUID();

        await db.run(`
            INSERT INTO crm_leads (id, company_name, contact_user_id, value_estimate, stage, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'prospect', ?, ?, ?)
        `, [leadId, companyName, contactUserId, valueEstimate, source, Date.now(), Date.now()]);

        console.log(`[CRM] Created lead: ${companyName} ($${valueEstimate})`);
        return leadId;
    }

    /**
     * Convert lead to opportunity
     */
    async convertToOpportunity(leadId, dealName, value, ownerUserId, counterpartyUserId) {
        const db = await getDb();
        const opportunityId = randomUUID();

        await db.run(`
            INSERT INTO crm_opportunities 
            (id, lead_id, deal_name, value, probability, stage, owner_user_id, counterparty_user_id, created_at)
            VALUES (?, ?, ?, ?, 0.5, 'proposal', ?, ?, ?)
        `, [opportunityId, leadId, dealName, value, ownerUserId, counterpartyUserId, Date.now()]);

        // Update lead stage
        await db.run(`UPDATE crm_leads SET stage = 'opportunity', updated_at = ? WHERE id = ?`, 
            [Date.now(), leadId]);

        console.log(`[CRM] Created opportunity: ${dealName} ($${value})`);
        return opportunityId;
    }

    /**
     * Update opportunity stage
     */
    async updateOpportunityStage(opportunityId, newStage) {
        const db = await getDb();

        // Log pipeline transition
        await db.run(`
            INSERT INTO crm_pipeline (id, opportunity_id, stage, entered_at)
            VALUES (?, ?, ?, ?)
        `, [randomUUID(), opportunityId, newStage, Date.now()]);

        // Update opportunity
        await db.run(`
            UPDATE crm_opportunities 
            SET stage = ?, updated_at = ?
            WHERE id = ?
        `, [newStage, Date.now(), opportunityId]);

        console.log(`[CRM] Opportunity ${opportunityId} → ${newStage}`);
    }

    /**
     * Get sales pipeline summary
     */
    async getPipelineSummary(userId) {
        const db = await getDb();
        
        const opportunities = await db.all(`
            SELECT stage, COUNT(*) as count, SUM(value) as total_value
            FROM crm_opportunities
            WHERE owner_user_id = ?
            GROUP BY stage
        `, [userId]);

        return opportunities;
    }

    async _callLLM(prompt) {
        try {
            if (this.useOpenAI) {
                const response = await this.openai.chat.completions.create({
                    model: 'gpt-4',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.3
                });
                return response.choices[0].message.content;
            } else {
                const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const result = await model.generateContent(prompt);
                return result.response.text();
            }
        } catch (error) {
            console.error('[CRM] LLM error:', error.message);
            return '';
        }
    }

    _extractLeadQuality(analysis) {
        if (analysis.toLowerCase().includes('high quality') || analysis.toLowerCase().includes('hot')) {
            return 'hot';
        } else if (analysis.toLowerCase().includes('warm') || analysis.toLowerCase().includes('qualified')) {
            return 'warm';
        }
        return 'cold';
    }

    _extractBudgetSignals(analysis) {
        const match = analysis.match(/\$?([\d,]+)/);
        return match ? parseInt(match[1].replace(/,/g, '')) : null;
    }

    _extractTimeline(analysis) {
        if (analysis.toLowerCase().includes('urgent') || analysis.toLowerCase().includes('asap')) {
            return 'immediate';
        } else if (analysis.toLowerCase().includes('month')) {
            return '1-3 months';
        }
        return 'long-term';
    }

    _suggestNextAction(analysis) {
        if (analysis.toLowerCase().includes('budget')) {
            return 'send_proposal';
        } else if (analysis.toLowerCase().includes('interested')) {
            return 'schedule_demo';
        }
        return 'follow_up';
    }
}

export { CRMAgent };

