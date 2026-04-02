/**
 * @fileoverview Autonomous Document Companion
 * Enables companions to autonomously draft, edit, and collaborate on documents
 * with context-awareness and privacy controls
 */

import { DocumentAgent } from './documentAgent.js';
import { NegotiationAgent } from './negotiationAgent.js';
import { getDb } from '../../db/connection.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import config from '../../config.js';

class AutonomousDocumentCompanion {
    constructor(userId, userProfile, companionContext = {}) {
        this.userId = userId;
        this.userProfile = userProfile;
        this.companionContext = companionContext;
        this.documentAgent = new DocumentAgent(userId, userProfile);
        
        // Initialize LLM for autonomous drafting
        if (config.CHAT_GPT_KEY) {
            this.openai = new OpenAI({ apiKey: config.CHAT_GPT_KEY });
            this.useOpenAI = true;
        } else if (config.API_KEYS && config.API_KEYS.length > 0) {
            this.genAI = new GoogleGenerativeAI(config.API_KEYS[0]);
            this.useOpenAI = false;
        }
        
        this.privacyLevel = companionContext.privacyLevel || 'standard';
        this.autonomyLevel = companionContext.autonomyLevel || 'assisted';
    }

    /**
     * Autonomously draft a document based on context and user intent
     */
    async autonomousDraft(intent, context = {}) {
        const { documentType, topic, urgency, stakeholders, privacyLevel } = context;
        
        // Build context-aware prompt
        const draftingPrompt = this.buildDraftingPrompt(intent, context);
        
        // Check privacy constraints before accessing sensitive data
        const allowedContext = await this.filterContextByPrivacy(context, privacyLevel);
        
        // Generate document draft
        const draftContent = await this.generateDraftContent(draftingPrompt, allowedContext);
        
        // Apply privacy filtering to generated content
        const filteredContent = await this.applyPrivacyFiltering(draftContent, privacyLevel);
        
        // Create document with privacy metadata
        const docId = await this.documentAgent.createDocument(
            this.generateDocumentTitle(intent, context),
            filteredContent,
            context.orgId
        );
        
        // Log autonomous action for audit
        await this.logAutonomousAction('draft_created', {
            docId,
            intent,
            privacyLevel,
            autonomyLevel: this.autonomyLevel,
            contextFiltered: Object.keys(context).length !== Object.keys(allowedContext).length
        });
        
        return {
            docId,
            title: this.generateDocumentTitle(intent, context),
            privacyLevel,
            requiresHumanReview: this.shouldRequireHumanReview(context, filteredContent),
            autonomousActions: ['drafted', 'privacy_filtered']
        };
    }

    /**
     * Autonomously suggest edits to existing document based on context
     */
    async suggestAutonomousEdits(docId, context = {}) {
        const document = await this.documentAgent.getDocument(docId);
        if (!document) throw new Error('Document not found');
        
        // Check if companion has permission to suggest edits
        const hasPermission = await this.checkAutonomousPermission(docId, 'suggest_edits');
        if (!hasPermission) {
            return { error: 'Insufficient autonomous permissions', requiresHumanApproval: true };
        }
        
        // Analyze document for improvement opportunities
        const analysisPrompt = this.buildAnalysisPrompt(document, context);
        const suggestions = await this.generateEditSuggestions(analysisPrompt);
        
        // Apply privacy filtering to suggestions
        const filteredSuggestions = await this.filterSuggestionsByPrivacy(suggestions, context.privacyLevel);
        
        // If high-confidence and low-risk, apply autonomous edits
        if (this.shouldApplyAutonomously(filteredSuggestions, context)) {
            const updatedContent = await this.applySelectedSuggestions(document.content, filteredSuggestions.autoApply);
            
            await this.documentAgent.updateDocument(
                docId,
                updatedContent,
                `Autonomous companion suggestions applied: ${filteredSuggestions.autoApply.map(s => s.type).join(', ')}`,
                this.documentAgent.generateDiff(document.content, updatedContent)
            );
            
            await this.logAutonomousAction('autonomous_edit', {
                docId,
                suggestionsApplied: filteredSuggestions.autoApply.length,
                requiresHumanReview: filteredSuggestions.humanReview.length > 0
            });
            
            return {
                autonomousEditsApplied: filteredSuggestions.autoApply,
                humanReviewRequired: filteredSuggestions.humanReview,
                newVersion: document.version + 1
            };
        }
        
        // Return suggestions for human review
        return {
            suggestions: filteredSuggestions,
            requiresHumanApproval: true,
            reason: 'Suggestions require human review due to complexity/privacy/risk'
        };
    }

    /**
     * Companion-to-companion document collaboration
     */
    async collaborateWithCompanion(docId, partnerCompanion, collaborationContext = {}) {
        const document = await this.documentAgent.getDocument(docId);
        if (!document) throw new Error('Document not found');
        
        // Establish collaboration protocol
        const collaborationId = `collab_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        // Exchange filtered context with partner companion
        const myContext = await this.prepareCollaborationContext(docId, collaborationContext);
        const partnerContext = await partnerCompanion.prepareCollaborationContext(docId, collaborationContext);
        
        // Find common ground and negotiation points
        const collaborationPlan = await this.generateCollaborationPlan(myContext, partnerContext, document);
        
        // Execute collaborative editing
        const results = await this.executeCollaborativeEditing(docId, partnerCompanion, collaborationPlan);
        
        await this.logAutonomousAction('companion_collaboration', {
            docId,
            collaborationId,
            partnerUserId: partnerCompanion.userId,
            plan: collaborationPlan,
            results
        });
        
        return results;
    }

    /**
     * Context-aware document drafting prompt generation
     */
    buildDraftingPrompt(intent, context) {
        const roleContext = this.getUserRoleContext();
        const orgContext = this.getOrganizationalContext();
        
        let prompt = `You are an autonomous document drafting companion for ${roleContext}. `;
        prompt += `Your task is to draft a ${context.documentType || 'document'} about ${intent}.\n\n`;
        
        prompt += `Context:\n`;
        prompt += `- Organization: ${orgContext.name || 'Not specified'}\n`;
        prompt += `- Your role behavior: ${roleContext.behaviorMode}\n`;
        prompt += `- Document type: ${context.documentType || 'General'}\n`;
        prompt += `- Stakeholders: ${context.stakeholders?.join(', ') || 'Not specified'}\n`;
        prompt += `- Urgency: ${context.urgency || 'Normal'}\n`;
        prompt += `- Privacy level: ${context.privacyLevel || 'Standard'}\n\n`;
        
        if (context.relatedNegotiation) {
            prompt += `This document is related to an active negotiation. Consider:\n`;
            prompt += `- Negotiation position and constraints\n`;
            prompt += `- Strategic information disclosure\n`;
            prompt += `- Competitive advantage preservation\n\n`;
        }
        
        prompt += `Requirements:\n`;
        prompt += `- Use clear, professional markdown formatting\n`;
        prompt += `- Include appropriate sections for the document type\n`;
        prompt += `- Mark any sections that may require approval with [REQUIRES_APPROVAL]\n`;
        prompt += `- Mark sensitive information with [SENSITIVE] tags\n`;
        prompt += `- Include placeholder approval checkboxes where appropriate\n\n`;
        
        prompt += `Generate a complete, professional document draft:`;
        
        return prompt;
    }

    /**
     * Filter context based on privacy level and consent chains
     */
    async filterContextByPrivacy(context, privacyLevel = 'standard') {
        const filteredContext = { ...context };
        const db = await getDb();
        
        // Check consent chains for sensitive information
        if (privacyLevel === 'restricted' || privacyLevel === 'confidential') {
            // Remove database secrets without explicit approval
            delete filteredContext.internalMetrics;
            delete filteredContext.competitorIntelligence;
            delete filteredContext.financialDetails;
            
            // Check if user has consent to access cross-domain information
            if (!await this.hasConsentForCrossDomainAccess(context.targetDomain)) {
                delete filteredContext.medicalContext;
                delete filteredContext.businessContext;
            }
        }
        
        // Apply organizational privacy rules
        const orgPrivacyRules = await this.getOrganizationalPrivacyRules(context.orgId);
        return this.applyPrivacyRules(filteredContext, orgPrivacyRules);
    }

    /**
     * Generate document content using LLM
     */
    async generateDraftContent(prompt, context) {
        try {
            let response;
            
            if (this.useOpenAI) {
                const completion = await this.openai.chat.completions.create({
                    model: 'gpt-4',
                    messages: [
                        { role: 'system', content: 'You are an autonomous document drafting companion. Generate professional, context-aware documents with proper markdown formatting.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 2000
                });
                response = completion.choices[0].message.content;
            } else {
                const model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
                const result = await model.generateContent(prompt);
                response = result.response.text();
            }
            
            return response;
            
        } catch (error) {
            console.error('[AutonomousDocumentCompanion] LLM generation failed:', error);
            return this.generateFallbackContent(context);
        }
    }

    /**
     * Apply privacy filtering to generated content
     */
    async applyPrivacyFiltering(content, privacyLevel) {
        if (privacyLevel === 'public') return content;
        
        // Remove or mask sensitive patterns
        let filteredContent = content;
        
        // Mask financial figures if not approved
        if (privacyLevel !== 'internal') {
            filteredContent = filteredContent.replace(/\$[\d,]+(\.\d{2})?/g, '$[AMOUNT_REDACTED]');
        }
        
        // Mask sensitive sections
        filteredContent = filteredContent.replace(/\[SENSITIVE\](.*?)\[\/SENSITIVE\]/gs, '[SENSITIVE_CONTENT_REQUIRES_APPROVAL]');
        
        // Add privacy notice
        if (privacyLevel === 'confidential') {
            filteredContent = `**⚠️ CONFIDENTIAL DOCUMENT**\n*This document contains confidential information. Distribution limited to authorized personnel only.*\n\n${filteredContent}`;
        }
        
        return filteredContent;
    }

    /**
     * Determine if document should require human review
     */
    shouldRequireHumanReview(context, content) {
        // Always require human review for:
        if (context.privacyLevel === 'confidential') return true;
        if (context.documentType === 'contract' || context.documentType === 'legal') return true;
        if (content.includes('[REQUIRES_APPROVAL]')) return true;
        if (context.urgency === 'high' && context.riskLevel === 'high') return true;
        if (this.autonomyLevel === 'assisted') return true;
        
        return false;
    }

    /**
     * Check autonomous permission for document actions
     */
    async checkAutonomousPermission(docId, action) {
        const hasHumanPermission = await this.documentAgent.checkPermission(docId, this.userId, 'write');
        if (!hasHumanPermission) return false;
        
        // Check companion-specific autonomous permissions
        const autonomousPermissions = this.companionContext.autonomousPermissions || [];
        return autonomousPermissions.includes(action) || autonomousPermissions.includes('all');
    }

    /**
     * Log autonomous actions for audit trail
     */
    async logAutonomousAction(action, metadata) {
        const db = await getDb();
        
        await db.run(`
            INSERT INTO autonomous_actions (
                id, user_id, action_type, metadata, privacy_level, 
                autonomy_level, timestamp, requires_human_review
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            `auto_${Date.now()}`,
            this.userId,
            action,
            JSON.stringify(metadata),
            this.privacyLevel,
            this.autonomyLevel,
            Date.now(),
            metadata.requiresHumanReview ? 1 : 0
        ]);
    }

    /**
     * Helper methods
     */
    getUserRoleContext() {
        // Extract role context from user profile
        const roles = this.userProfile?.businessProfile?.roles || [];
        if (roles.length > 0) {
            const primaryRole = roles[0];
            return {
                role: primaryRole.role,
                title: primaryRole.title,
                behaviorMode: primaryRole.role === 'clinician' ? 'empathetic' : 'strategic',
                name: primaryRole.org_name
            };
        }
        return { role: 'user', behaviorMode: 'neutral' };
    }

    getOrganizationalContext() {
        return {
            name: this.companionContext.organizationName || 'Organization',
            type: this.companionContext.organizationType || 'corporation'
        };
    }

    generateDocumentTitle(intent, context) {
        const roleContext = this.getUserRoleContext();
        const docType = context.documentType || 'Document';
        return `${docType}: ${intent} - ${roleContext.title || roleContext.role}`;
    }

    generateFallbackContent(context) {
        return `# ${context.documentType || 'Document'}\n\n## Overview\n[Document content would be generated here]\n\n## Next Steps\n- [ ] Review content\n- [ ] Obtain approvals\n- [ ] Finalize document\n\n*Generated by autonomous companion - requires human review*`;
    }

    async hasConsentForCrossDomainAccess(targetDomain) {
        // Check consent chains for cross-domain access
        return this.userProfile?.contextSharingPrefs?.allowCrossDomain || false;
    }

    async getOrganizationalPrivacyRules(orgId) {
        if (!orgId) return {};
        
        const db = await getDb();
        const org = await db.get('SELECT settings FROM organizations WHERE id = ?', [orgId]);
        
        if (org && org.settings) {
            const settings = JSON.parse(org.settings);
            return settings.privacyRules || {};
        }
        
        return {};
    }

    applyPrivacyRules(context, rules) {
        // Apply organizational privacy rules to context
        const filteredContext = { ...context };
        
        Object.keys(rules).forEach(key => {
            if (rules[key] === 'restrict') {
                delete filteredContext[key];
            }
        });
        
        return filteredContext;
    }
}

export { AutonomousDocumentCompanion };