/**
 * @fileoverview Legal Agent - Contract review and risk assessment
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import config from '../../config.js';
import { LEGAL_REVIEW_PROMPT } from '../../prompts/business/negotiation_prompts.js';
import { getDb } from '../../db/connection.js';
import { randomUUID } from 'crypto';

class LegalAgent {
    constructor(userId) {
        this.userId = userId;
        
        if (config.CHAT_GPT_KEY) {
            this.openai = new OpenAI({ apiKey: config.CHAT_GPT_KEY });
            this.useOpenAI = true;
        } else if (config.API_KEYS?.length > 0) {
            this.genAI = new GoogleGenerativeAI(config.API_KEYS[0]);
            this.useOpenAI = false;
        }
    }

    /**
     * Review contract for risks
     */
    async reviewContract(contractText, contractType) {
        const prompt = `${LEGAL_REVIEW_PROMPT}\n\nContract Type: ${contractType}\n\nContract:\n${contractText}\n\nProvide risk assessment and recommendations.`;

        const review = await this._callLLM(prompt);
        
        // Extract risk level
        const riskLevel = this._assessRiskLevel(review);
        
        // Parse clauses
        const clauses = this._identifyKeyClauses(contractText);

        return {
            riskLevel,
            review,
            clauses,
            recommendation: this._generateRecommendation(riskLevel, review)
        };
    }

    /**
     * Create contract record in database
     */
    async createContract(opportunityId, contractType, content, createdBy) {
        const db = await getDb();
        const contractId = randomUUID();

        await db.run(`
            INSERT INTO legal_contracts 
            (id, opportunity_id, contract_type, version, content, status, created_by, created_at)
            VALUES (?, ?, ?, 1, ?, 'draft', ?, ?)
        `, [contractId, opportunityId, contractType, content, createdBy, Date.now()]);

        console.log(`[Legal] Created contract: ${contractType} for opportunity ${opportunityId}`);
        return contractId;
    }

    /**
     * Assign contract to legal team member
     */
    async assignForReview(contractId, legalUserId, priority = 'normal') {
        const db = await getDb();

        await db.run(`
            UPDATE legal_contracts 
            SET assigned_legal = ?, status = 'in_review', risk_level = ?
            WHERE id = ?
        `, [legalUserId, priority, contractId]);

        console.log(`[Legal] Contract ${contractId} assigned to ${legalUserId} (${priority} priority)`);
    }

    /**
     * Flag problematic clause
     */
    async flagClause(contractId, clauseType, clauseText, riskAssessment, proposedChange) {
        const db = await getDb();
        const clauseId = randomUUID();

        await db.run(`
            INSERT INTO legal_clauses 
            (id, contract_id, clause_type, clause_text, risk_assessment, proposed_change, status)
            VALUES (?, ?, ?, ?, ?, ?, 'flagged')
        `, [clauseId, contractId, clauseType, clauseText, riskAssessment, proposedChange]);

        console.log(`[Legal] Flagged clause: ${clauseType} (${riskAssessment})`);
        return clauseId;
    }

    /**
     * Approve contract
     */
    async approveContract(contractId) {
        const db = await getDb();

        await db.run(`
            UPDATE legal_contracts 
            SET status = 'legal_approved', approved_at = ?
            WHERE id = ?
        `, [Date.now(), contractId]);

        console.log(`[Legal] Contract ${contractId} approved`);
    }

    /**
     * Request changes to contract
     */
    async requestChanges(contractId, changes) {
        const db = await getDb();

        await db.run(`
            UPDATE legal_contracts 
            SET status = 'counter_proposed', reviewed_at = ?
            WHERE id = ?
        `, [Date.now(), contractId]);

        console.log(`[Legal] Changes requested for contract ${contractId}`);
    }

    async _callLLM(prompt) {
        try {
            if (this.useOpenAI) {
                const response = await this.openai.chat.completions.create({
                    model: 'gpt-4',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.2 // Lower temp for legal precision
                });
                return response.choices[0].message.content;
            } else {
                const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const result = await model.generateContent(prompt);
                return result.response.text();
            }
        } catch (error) {
            console.error('[Legal] LLM error:', error.message);
            return 'Error in legal review';
        }
    }

    _assessRiskLevel(review) {
        const text = review.toLowerCase();
        if (text.includes('critical') || text.includes('unacceptable')) return 'critical';
        if (text.includes('high risk') || text.includes('significant')) return 'high';
        if (text.includes('medium') || text.includes('some concerns')) return 'medium';
        return 'low';
    }

    _identifyKeyClauses(contractText) {
        // Simple clause identification (can be enhanced with NLP)
        const clauses = [];
        const sections = contractText.split(/\n\n+/);
        
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            if (section.length > 50) {
                clauses.push({
                    index: i,
                    preview: section.substring(0, 100) + '...',
                    type: this._guessClauseType(section)
                });
            }
        }

        return clauses;
    }

    _guessClauseType(text) {
        const lower = text.toLowerCase();
        if (lower.includes('liability') || lower.includes('indemnif')) return 'liability';
        if (lower.includes('payment') || lower.includes('invoice')) return 'payment';
        if (lower.includes('termination') || lower.includes('cancel')) return 'termination';
        if (lower.includes('intellectual property') || lower.includes(' ip ')) return 'ip';
        if (lower.includes('confidential')) return 'confidentiality';
        return 'general';
    }

    _generateRecommendation(riskLevel, review) {
        if (riskLevel === 'critical') {
            return '🔴 DO NOT SIGN - Critical issues must be resolved';
        } else if (riskLevel === 'high') {
            return '🟠 REQUEST CHANGES - Significant risks identified';
        } else if (riskLevel === 'medium') {
            return '🟡 NEGOTIATE - Some terms should be improved';
        }
        return '🟢 APPROVE - Standard terms, acceptable risk';
    }
}

export { CRMAgent };

