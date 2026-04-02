/**
 * @fileoverview Negotiation-Document Integration Agent
 * Enables companions to negotiate document terms autonomously while maintaining privacy controls
 */

import { AutonomousDocumentCompanion } from './autonomousDocumentCompanion.js';
import { NegotiationAgent } from './negotiationAgent.js';
import { GameTheoryEngine } from './gameTheoryEngine.js';
import { DocumentAgent } from './documentAgent.js';
import sessionManager from '../../sessions/sessionManager.js';
import { getDb } from '../../db/connection.js';
import { events } from '../../orchestrator.js';

class NegotiationDocumentIntegrator {
    constructor(userId, userProfile, companionContext = {}) {
        this.userId = userId;
        this.userProfile = userProfile;
        this.companionContext = companionContext;
        
        // Initialize component agents
        this.documentCompanion = new AutonomousDocumentCompanion(userId, userProfile, companionContext);
        this.negotiationAgent = new NegotiationAgent(userId, companionContext.constraints || {}, companionContext.role || 'participant');
        this.documentAgent = new DocumentAgent(userId, userProfile);
        
        this.gameTheory = new GameTheoryEngine(companionContext.constraints || {});
    }

    /**
     * Start document-based negotiation session
     */
    async startDocumentNegotiation(docId, counterpartyUserId, negotiationContext = {}) {
        const db = await getDb();
        
        // Get document for negotiation context
        const document = await this.documentAgent.getDocument(docId);
        if (!document) throw new Error('Document not found');
        
        // Create negotiation session linked to document
        const session = await sessionManager.createSession(
            [this.userId, counterpartyUserId],
            `Document Negotiation: ${document.title}`,
            'document_negotiation',
            {
                documentId: docId,
                documentVersion: document.version,
                negotiationType: 'document_terms',
                privacyLevel: negotiationContext.privacyLevel || 'internal',
                constraints: negotiationContext.constraints || {},
                roles: {
                    [this.userId]: negotiationContext.myRole || 'proposer',
                    [counterpartyUserId]: negotiationContext.counterpartyRole || 'reviewer'
                }
            }
        );
        
        // Extract negotiable terms from document
        const negotiableTerms = await this.extractNegotiableTerms(document);
        
        // Log negotiation initiation
        await this.logNegotiationAction('negotiation_started', {
            sessionId: session.id,
            documentId: docId,
            negotiableTerms: negotiableTerms.length,
            privacyLevel: negotiationContext.privacyLevel
        });
        
        return {
            sessionId: session.id,
            documentId: docId,
            negotiableTerms,
            status: 'active',
            participants: [this.userId, counterpartyUserId]
        };
    }

    /**
     * Autonomous companion-to-companion document negotiation
     */
    async negotiateDocumentTerms(sessionId, proposedChanges, counterpartyCompanion) {
        const session = await sessionManager.getSession(sessionId);
        if (!session || session.type !== 'document_negotiation') {
            throw new Error('Invalid document negotiation session');
        }
        
        const docId = session.metadata.documentId;
        const document = await this.documentAgent.getDocument(docId);
        
        // Analyze proposed changes for strategic implications
        const changeAnalysis = await this.analyzeProposedChanges(proposedChanges, document, session);
        
        // Generate game-theoretic response
        const negotiationResponse = await this.generateNegotiationResponse(
            changeAnalysis, 
            session.metadata.constraints,
            counterpartyCompanion
        );
        
        // Apply privacy filtering to response
        const filteredResponse = await this.applyNegotiationPrivacyFilters(
            negotiationResponse,
            session.metadata.privacyLevel
        );
        
        // Execute autonomous negotiation decision
        const result = await this.executeNegotiationDecision(docId, filteredResponse, session);
        
        // Log autonomous negotiation action
        await this.logNegotiationAction('autonomous_negotiation', {
            sessionId,
            documentId: docId,
            decision: result.decision,
            termsModified: result.termsModified?.length || 0,
            privacyFiltered: filteredResponse.privacyFiltered
        });
        
        return result;
    }

    /**
     * Real-time companion collaboration on document during negotiation
     */
    async collaborateDuringNegotiation(sessionId, collaborationAction, counterpartyCompanion) {
        const session = await sessionManager.getSession(sessionId);
        const docId = session.metadata.documentId;
        
        switch (collaborationAction.type) {
            case 'propose_edit':
                return await this.handleProposeEdit(docId, collaborationAction, session);
                
            case 'counter_edit':
                return await this.handleCounterEdit(docId, collaborationAction, session, counterpartyCompanion);
                
            case 'accept_terms':
                return await this.handleAcceptTerms(docId, collaborationAction, session);
                
            case 'add_comment':
                return await this.handleNegotiationComment(docId, collaborationAction, session);
                
            default:
                throw new Error(`Unknown collaboration action: ${collaborationAction.type}`);
        }
    }

    /**
     * Extract negotiable terms from document content
     */
    async extractNegotiableTerms(document) {
        const content = document.content;
        const negotiableTerms = [];
        
        // Parse document for negotiable patterns
        const patterns = [
            // Price/Amount patterns
            { type: 'price', regex: /\$?[\d,]+(\.\d{2})?/g, priority: 'high' },
            // Date patterns  
            { type: 'date', regex: /\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}-\d{1,2}-\d{4}|\d{1,2} days?|\d{1,2} weeks?|\d{1,2} months?/g, priority: 'medium' },
            // Percentage patterns
            { type: 'percentage', regex: /\d+(\.\d+)?%/g, priority: 'medium' },
            // Quantity patterns
            { type: 'quantity', regex: /\d+ units?|\d+ pieces?|\d+ items?/g, priority: 'low' },
            // Terms marked for approval
            { type: 'approval_required', regex: /\[REQUIRES_APPROVAL\](.*?)\[\/REQUIRES_APPROVAL\]/gs, priority: 'critical' },
            // Sensitive terms
            { type: 'sensitive', regex: /\[SENSITIVE\](.*?)\[\/SENSITIVE\]/gs, priority: 'critical' }
        ];
        
        patterns.forEach(pattern => {
            const matches = content.match(pattern.regex) || [];
            matches.forEach((match, index) => {
                negotiableTerms.push({
                    type: pattern.type,
                    value: match.trim(),
                    priority: pattern.priority,
                    position: content.indexOf(match),
                    negotiable: pattern.priority !== 'critical' || this.hasNegotiationPermission(pattern.type)
                });
            });
        });
        
        return negotiableTerms.sort((a, b) => {
            const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        });
    }

    /**
     * Analyze proposed changes for strategic implications
     */
    async analyzeProposedChanges(proposedChanges, document, session) {
        const analysis = {
            financialImpact: 0,
            strategicRisk: 'low',
            privacyImplications: [],
            recommendedResponse: 'accept',
            reasoning: [],
            alternativeProposals: []
        };
        
        for (const change of proposedChanges) {
            // Analyze financial impact
            if (change.type === 'price' || change.type === 'percentage') {
                const impact = this.calculateFinancialImpact(change, session.metadata.constraints);
                analysis.financialImpact += impact.amount;
                analysis.reasoning.push(`Financial impact: ${impact.description}`);
            }
            
            // Analyze strategic risk
            if (change.type === 'sensitive' || change.type === 'approval_required') {
                analysis.strategicRisk = 'high';
                analysis.privacyImplications.push(change.type);
                analysis.reasoning.push(`High-risk change: ${change.type}`);
            }
            
            // Analyze timeline impact
            if (change.type === 'date') {
                const timelineRisk = this.analyzeTimelineChange(change, session.metadata.constraints);
                analysis.reasoning.push(`Timeline impact: ${timelineRisk.description}`);
            }
        }
        
        // Generate strategic recommendation
        analysis.recommendedResponse = this.generateStrategicRecommendation(analysis);
        
        return analysis;
    }

    /**
     * Generate game-theoretic response to negotiation
     */
    async generateNegotiationResponse(changeAnalysis, constraints, counterpartyCompanion) {
        const gameTheoryAnalysis = await this.gameTheory.analyzeNegotiationPosition({
            myConstraints: constraints,
            proposedChanges: changeAnalysis,
            negotiationHistory: [], // Would include historical context
            counterpartyProfile: counterpartyCompanion?.companionContext
        });
        
        const response = {
            decision: gameTheoryAnalysis.recommendedAction, // 'accept', 'counter', 'reject'
            counterProposal: gameTheoryAnalysis.counterProposal,
            reasoning: gameTheoryAnalysis.reasoning,
            confidenceLevel: gameTheoryAnalysis.confidence,
            strategicPosition: gameTheoryAnalysis.position
        };
        
        // Add autonomous decision logic
        if (response.decision === 'counter') {
            response.counterProposal = await this.generateCounterProposal(changeAnalysis, constraints);
        }
        
        return response;
    }

    /**
     * Apply privacy filtering to negotiation responses
     */
    async applyNegotiationPrivacyFilters(response, privacyLevel) {
        const filteredResponse = { ...response };
        
        if (privacyLevel === 'confidential') {
            // Remove sensitive reasoning details
            filteredResponse.reasoning = filteredResponse.reasoning?.map(r => 
                r.includes('internal') ? '[REASONING_CONFIDENTIAL]' : r
            );
            
            // Filter strategic position details
            if (filteredResponse.strategicPosition) {
                delete filteredResponse.strategicPosition.internalConstraints;
                delete filteredResponse.strategicPosition.walkAwayPoint;
            }
        }
        
        filteredResponse.privacyFiltered = privacyLevel !== 'public';
        return filteredResponse;
    }

    /**
     * Execute autonomous negotiation decision
     */
    async executeNegotiationDecision(docId, negotiationResponse, session) {
        const result = {
            decision: negotiationResponse.decision,
            documentUpdated: false,
            termsModified: [],
            requiresHumanApproval: false,
            nextActions: []
        };
        
        switch (negotiationResponse.decision) {
            case 'accept':
                result.documentUpdated = true;
                result.termsModified = await this.applyAcceptedTerms(docId, session);
                result.nextActions = ['document_updated', 'notify_counterparty'];
                break;
                
            case 'counter':
                if (negotiationResponse.counterProposal) {
                    result.documentUpdated = true;
                    result.termsModified = await this.applyCounterProposal(docId, negotiationResponse.counterProposal);
                    result.nextActions = ['counter_proposal_sent', 'await_response'];
                }
                break;
                
            case 'reject':
                result.requiresHumanApproval = true;
                result.nextActions = ['human_review_required', 'escalate_decision'];
                break;
        }
        
        // Check if human approval is needed for any sensitive changes
        if (this.requiresHumanApproval(result.termsModified, session.metadata.privacyLevel)) {
            result.requiresHumanApproval = true;
            result.nextActions.push('human_approval_pending');
        }
        
        return result;
    }

    /**
     * Handle collaborative editing actions during negotiation
     */
    async handleProposeEdit(docId, action, session) {
        const { lineNumber, originalText, proposedText, reasoning } = action;
        
        // Create negotiation-specific document comment
        await this.addNegotiationComment(docId, {
            type: 'proposal',
            lineNumber,
            originalText,
            proposedText,
            reasoning,
            userId: this.userId,
            sessionId: session.id,
            requiresResponse: true
        });
        
        return {
            status: 'proposal_added',
            commentId: `proposal_${Date.now()}`,
            requiresCounterpartyResponse: true
        };
    }

    async handleCounterEdit(docId, action, session, counterpartyCompanion) {
        const { proposalId, response, counterProposal } = action;
        
        if (response === 'accept') {
            // Apply the proposed change
            const document = await this.documentAgent.getDocument(docId);
            const updatedContent = this.applyTextChange(document.content, action);
            
            await this.documentAgent.updateDocument(
                docId,
                updatedContent,
                `Negotiation agreement: ${action.reasoning || 'Terms accepted'}`,
                this.documentAgent.generateDiff(document.content, updatedContent)
            );
            
            return { status: 'change_applied', documentVersion: document.version + 1 };
        } else if (response === 'counter') {
            return await this.handleProposeEdit(docId, counterProposal, session);
        }
        
        return { status: 'proposal_rejected', reason: action.reasoning };
    }

    async handleAcceptTerms(docId, action, session) {
        // Finalize negotiation and apply all agreed terms
        await sessionManager.concludeSession(session.id, 'agreement_reached', {
            finalDocumentVersion: action.documentVersion,
            agreedTerms: action.terms,
            timestamp: Date.now()
        });
        
        return {
            status: 'negotiation_completed',
            finalDocument: docId,
            agreedTerms: action.terms
        };
    }

    async handleNegotiationComment(docId, action, session) {
        const commentId = await this.addNegotiationComment(docId, {
            type: 'discussion',
            comment: action.comment,
            userId: this.userId,
            sessionId: session.id,
            lineNumber: action.lineNumber
        });
        
        return { status: 'comment_added', commentId };
    }

    /**
     * Add negotiation-specific comments to documents
     */
    async addNegotiationComment(docId, commentData) {
        const db = await getDb();
        const commentId = `nego_comment_${Date.now()}`;
        
        await db.run(`
            INSERT INTO doc_comments (
                id, doc_id, version_id, user_id, comment, line_number, 
                created_at, resolved
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            commentId, docId, null, commentData.userId, 
            JSON.stringify({
                type: commentData.type,
                sessionId: commentData.sessionId,
                content: commentData.comment || commentData.reasoning,
                originalText: commentData.originalText,
                proposedText: commentData.proposedText,
                requiresResponse: commentData.requiresResponse || false
            }),
            commentData.lineNumber, Date.now(), 0
        ]);
        
        return commentId;
    }

    /**
     * Utility methods
     */
    async logNegotiationAction(action, metadata) {
        const db = await getDb();
        
        await db.run(`
            INSERT INTO autonomous_actions (
                id, user_id, action_type, metadata, privacy_level, 
                autonomy_level, timestamp, requires_human_review
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            `nego_${Date.now()}`,
            this.userId,
            action,
            JSON.stringify(metadata),
            metadata.privacyLevel || 'internal',
            this.companionContext.autonomyLevel || 'supervised',
            Date.now(),
            metadata.requiresHumanReview ? 1 : 0
        ]);
    }
    
    hasNegotiationPermission(termType) {
        const permissions = this.companionContext.autonomousPermissions || [];
        return permissions.includes('negotiate_terms') || 
               permissions.includes('all') ||
               permissions.includes(`negotiate_${termType}`);
    }
    
    calculateFinancialImpact(change, constraints) {
        // Simplified financial impact calculation
        const amount = parseFloat(change.value.replace(/[$,]/g, '')) || 0;
        const maxBudget = constraints.maxBudget || 0;
        
        return {
            amount: amount,
            percentage: maxBudget ? (amount / maxBudget) * 100 : 0,
            description: `${change.type} change of $${amount.toLocaleString()}`
        };
    }
    
    analyzeTimelineChange(change, constraints) {
        return {
            description: `Timeline change: ${change.value}`,
            impact: 'medium' // Would be more sophisticated in practice
        };
    }
    
    generateStrategicRecommendation(analysis) {
        if (analysis.strategicRisk === 'high') return 'reject';
        if (analysis.financialImpact > 0.1) return 'counter'; // 10% threshold
        return 'accept';
    }
    
    async generateCounterProposal(changeAnalysis, constraints) {
        // Generate counter-proposal based on constraints and game theory
        return {
            type: 'counter_proposal',
            changes: [], // Would generate specific counter-changes
            reasoning: 'Strategic counter-proposal based on analysis'
        };
    }
    
    requiresHumanApproval(termsModified, privacyLevel) {
        return privacyLevel === 'confidential' || 
               termsModified.some(term => term.type === 'sensitive');
    }
    
    applyTextChange(content, action) {
        // Apply text change at specific line/position
        const lines = content.split('\n');
        if (action.lineNumber && action.lineNumber <= lines.length) {
            lines[action.lineNumber - 1] = lines[action.lineNumber - 1].replace(
                action.originalText, 
                action.proposedText
            );
        }
        return lines.join('\n');
    }
}

export { NegotiationDocumentIntegrator };