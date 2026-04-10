/**
 * @fileoverview Companion Confidential Communication System
 * Enables companions to share sensitive information privately without user visibility
 * Implements secure companion-to-companion intelligence sharing
 */

import { getDb } from '../../db/connection.js';
import { randomUUID } from 'crypto';

/**
 * Companion Confidential Communication Manager
 * Handles private inter-companion messaging and intelligence sharing
 */
export class CompanionConfidentialComm {
    constructor() {
        this.confidentialLevels = {
            COMPANION_ONLY: 'companion_only',          // Only between specific companions
            COMPANION_NETWORK: 'companion_network',    // Among all user's companions
            CROSS_USER_COMPANION: 'cross_user_companion' // Between companions of different users (high sensitivity)
        };
    }

    /**
     * Initialize companion communication tables
     */
    async initializeSchema() {
        const db = await getDb();
        
        await db.exec(`
            -- Companion-to-companion confidential messages
            CREATE TABLE IF NOT EXISTS companion_confidential_messages (
                message_id TEXT PRIMARY KEY,
                sender_companion_id TEXT NOT NULL,      -- Which companion sent this
                sender_user_id TEXT NOT NULL,           -- User the sender companion belongs to
                recipient_companion_id TEXT,            -- Specific companion recipient (null for broadcast)
                recipient_user_id TEXT,                 -- User the recipient companion belongs to
                message_content TEXT NOT NULL,
                confidential_level TEXT NOT NULL,       -- companion_only, companion_network, cross_user_companion
                intelligence_type TEXT,                 -- context_sharing, risk_assessment, pattern_detection
                related_circle_id TEXT,                 -- Related circle context
                metadata TEXT,                          -- JSON metadata
                requires_action BOOLEAN DEFAULT 0,     -- Whether this requires companion action
                expires_at INTEGER,                     -- Auto-delete timestamp for sensitive intel
                created_at INTEGER NOT NULL,
                read_at INTEGER,
                FOREIGN KEY (sender_user_id) REFERENCES users(user_id),
                FOREIGN KEY (recipient_user_id) REFERENCES users(user_id)
            );

            -- Companion intelligence sharing logs
            CREATE TABLE IF NOT EXISTS companion_intel_sharing (
                sharing_id TEXT PRIMARY KEY,
                source_companion TEXT NOT NULL,         -- medical_companion, professional_companion, etc.
                target_companion TEXT NOT NULL,
                user_id TEXT NOT NULL,                  -- User whose companions are sharing intel
                intelligence_summary TEXT NOT NULL,     -- High-level summary of shared intelligence
                detailed_analysis TEXT,                 -- Detailed analysis (may be encrypted)
                sharing_reason TEXT NOT NULL,           -- why this intelligence was shared
                privacy_level TEXT NOT NULL,            -- COMPANION_CONFIDENTIAL, USER_INVISIBLE
                user_consent_status TEXT DEFAULT 'not_required', -- explicit, implicit, not_required
                shared_at INTEGER NOT NULL,
                accessed_at INTEGER,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            );

            -- Companion decision coordination
            CREATE TABLE IF NOT EXISTS companion_decision_sync (
                sync_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                decision_context TEXT NOT NULL,         -- What decision needs coordination
                medical_companion_input TEXT,           -- Medical companion's perspective
                professional_companion_input TEXT,     -- Professional companion's perspective
                social_companion_input TEXT,           -- Social companion's perspective  
                consensus_reached BOOLEAN DEFAULT 0,
                final_recommendation TEXT,
                confidence_score REAL,                  -- 0-1 confidence in recommendation
                user_override TEXT,                     -- If user overrides companion decision
                created_at INTEGER NOT NULL,
                resolved_at INTEGER,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            );

            -- Indexes for performance
            CREATE INDEX IF NOT EXISTS idx_companion_messages_recipient ON companion_confidential_messages(recipient_user_id, recipient_companion_id);
            CREATE INDEX IF NOT EXISTS idx_companion_messages_sender ON companion_confidential_messages(sender_user_id, sender_companion_id);
            CREATE INDEX IF NOT EXISTS idx_companion_intel_user ON companion_intel_sharing(user_id);
            CREATE INDEX IF NOT EXISTS idx_companion_decisions ON companion_decision_sync(user_id, consensus_reached);
        `);
    }

    /**
     * Send confidential message between companions
     * @param {object} options - Message options
     * @returns {Promise<string>} Message ID
     */
    async sendCompanionMessage({
        senderCompanion,     // 'medical_companion', 'professional_companion', etc.
        senderUserId,
        recipientCompanion,  // null for broadcast to all user's companions
        recipientUserId,     // null for same user's companions
        content,
        confidentialLevel,
        intelligenceType,
        relatedCircleId,
        metadata = {},
        requiresAction = false,
        expiresInHours = null
    }) {
        const db = await getDb();
        const messageId = randomUUID();
        const now = Date.now();
        const expiresAt = expiresInHours ? now + (expiresInHours * 60 * 60 * 1000) : null;

        await db.run(`
            INSERT INTO companion_confidential_messages (
                message_id, sender_companion_id, sender_user_id,
                recipient_companion_id, recipient_user_id,
                message_content, confidential_level, intelligence_type,
                related_circle_id, metadata, requires_action, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            messageId, senderCompanion, senderUserId,
            recipientCompanion, recipientUserId || senderUserId,
            content, confidentialLevel, intelligenceType,
            relatedCircleId, JSON.stringify(metadata),
            requiresAction ? 1 : 0, expiresAt, now
        ]);

        console.log(`[CompanionComm] ${senderCompanion} sent confidential message (${confidentialLevel})`);
        return messageId;
    }

    /**
     * Share intelligence between user's own companions
     * @param {object} options - Intelligence sharing options
     * @returns {Promise<string>} Sharing ID
     */
    async shareIntelligenceBetweenCompanions({
        sourceCompanion,      // Which companion has the intelligence
        targetCompanion,      // Which companion should receive it
        userId,
        summary,              // High-level summary
        detailedAnalysis,     // Detailed analysis
        reason,               // Why this intelligence is being shared
        privacyLevel = 'COMPANION_CONFIDENTIAL',
        userConsentStatus = 'not_required'
    }) {
        const db = await getDb();
        const sharingId = randomUUID();
        const now = Date.now();

        await db.run(`
            INSERT INTO companion_intel_sharing (
                sharing_id, source_companion, target_companion, user_id,
                intelligence_summary, detailed_analysis, sharing_reason,
                privacy_level, user_consent_status, shared_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            sharingId, sourceCompanion, targetCompanion, userId,
            summary, detailedAnalysis, reason,
            privacyLevel, userConsentStatus, now
        ]);

        console.log(`[CompanionIntel] ${sourceCompanion} → ${targetCompanion}: ${reason}`);
        return sharingId;
    }

    /**
     * Coordinate decision between multiple companions
     * @param {object} options - Decision coordination options
     * @returns {Promise<object>} Decision coordination result
     */
    async coordinateCompanionDecision({
        userId,
        decisionContext,
        companions = ['medical_companion', 'professional_companion'] // Which companions to involve
    }) {
        const db = await getDb();
        const syncId = randomUUID();
        const now = Date.now();

        // Create decision sync record
        await db.run(`
            INSERT INTO companion_decision_sync (
                sync_id, user_id, decision_context, created_at
            ) VALUES (?, ?, ?, ?)
        `, [syncId, userId, decisionContext, now]);

        // Get input from each companion
        const companionInputs = {};
        for (const companionType of companions) {
            companionInputs[companionType] = await this.getCompanionDecisionInput(
                companionType, userId, decisionContext
            );
        }

        // Update record with companion inputs
        const updateFields = [];
        const updateValues = [];
        
        if (companionInputs.medical_companion) {
            updateFields.push('medical_companion_input = ?');
            updateValues.push(companionInputs.medical_companion);
        }
        if (companionInputs.professional_companion) {
            updateFields.push('professional_companion_input = ?');
            updateValues.push(companionInputs.professional_companion);
        }
        if (companionInputs.social_companion) {
            updateFields.push('social_companion_input = ?');
            updateValues.push(companionInputs.social_companion);
        }

        if (updateFields.length > 0) {
            updateValues.push(syncId);
            await db.run(`
                UPDATE companion_decision_sync 
                SET ${updateFields.join(', ')}
                WHERE sync_id = ?
            `, updateValues);
        }

        // Analyze consensus
        const consensus = this.analyzeCompanionConsensus(companionInputs, decisionContext);
        
        // Update with final recommendation
        await db.run(`
            UPDATE companion_decision_sync 
            SET consensus_reached = ?, final_recommendation = ?, confidence_score = ?, resolved_at = ?
            WHERE sync_id = ?
        `, [
            consensus.reached ? 1 : 0,
            consensus.recommendation,
            consensus.confidence,
            Date.now(),
            syncId
        ]);

        return {
            syncId,
            consensus,
            companionInputs,
            requiresUserInput: !consensus.reached || consensus.confidence < 0.7
        };
    }

    /**
     * Get decision input from a specific companion using AI agents
     * @param {string} companionType - Type of companion
     * @param {string} userId - User ID
     * @param {string} decisionContext - Context of the decision
     * @returns {Promise<string>} Companion's AI-generated input
     */
    async getCompanionDecisionInput(companionType, userId, decisionContext) {
        try {
            // Use your existing AI agents to generate companion perspective
            const { processUserMessage } = await import('../../agents/index.js');
            const { getCircleMembers } = await import('../../db/index.js');
            
            // Get user context
            const userCircles = await this.getUserCircles(userId);
            const relevantCircle = userCircles.find(c => 
                companionType.includes('medical') ? c.circle_type === 'medical' : 
                companionType.includes('professional') ? c.circle_type === 'professional' : true
            ) || userCircles[0];
            
            if (!relevantCircle) {
                return `${companionType}: No relevant circle context available for decision analysis.`;
            }
            
            const members = await getCircleMembers(relevantCircle.circle_id);
            
            // Create AI prompt for companion perspective
            const companionPrompt = this.createCompanionDecisionPrompt(companionType, decisionContext);
            
            // Use your unified agent for AI-powered companion analysis
            const aiResponse = await processUserMessage(
                userId,
                'companion', // role
                companionPrompt,
                members,
                relevantCircle.circle_id,
                null, // promptVersion
                {
                    companionType: companionType,
                    analysisMode: 'decision_support',
                    focusAreas: this.getCompanionFocusAreas(companionType),
                    decisionContext: decisionContext
                }
            );
            
            // Extract companion perspective from AI response
            return this.extractCompanionPerspective(aiResponse, companionType, decisionContext);
            
        } catch (error) {
            console.error(`[CompanionComm] AI decision input failed for ${companionType}:`, error.message);
            // Fallback to structured response
            return this.getFallbackCompanionInput(companionType, decisionContext);
        }
    }

    /**
     * Create AI prompt for companion decision input
     * @param {string} companionType - Type of companion
     * @param {string} decisionContext - Decision context
     * @returns {string} AI prompt
     */
    createCompanionDecisionPrompt(companionType, decisionContext) {
        const prompts = {
            medical_companion: `As a medical companion AI, analyze this decision from a health and wellbeing perspective: "${decisionContext}". Consider health impacts, medical priorities, stress factors, and long-term wellbeing. Provide your perspective on whether this decision supports or hinders the user's health goals.`,
            
            professional_companion: `As a professional companion AI, analyze this decision from a career and business perspective: "${decisionContext}". Consider career implications, professional relationships, business outcomes, and work-life balance. Provide your perspective on whether this decision advances or hinders professional goals.`,
            
            social_companion: `As a social companion AI, analyze this decision from a relationships and social perspective: "${decisionContext}". Consider impact on relationships, social dynamics, community effects, and personal fulfillment. Provide your perspective on whether this decision strengthens or weakens social connections.`
        };
        
        return prompts[companionType] || `As a ${companionType}, analyze this decision: "${decisionContext}"`;
    }

    /**
     * Get focus areas for different companion types
     * @param {string} companionType - Type of companion
     * @returns {Array} Focus areas for AI analysis
     */
    getCompanionFocusAreas(companionType) {
        const focusAreas = {
            medical_companion: ['health_impact', 'stress_factors', 'wellbeing_priorities', 'medical_considerations'],
            professional_companion: ['career_impact', 'business_outcomes', 'professional_relationships', 'work_life_balance'],
            social_companion: ['relationship_impact', 'social_dynamics', 'community_effects', 'personal_fulfillment']
        };
        
        return focusAreas[companionType] || ['general_analysis'];
    }

    /**
     * Extract companion perspective from AI response
     * @param {object} aiResponse - AI response object
     * @param {string} companionType - Type of companion
     * @param {string} decisionContext - Decision context
     * @returns {string} Extracted perspective
     */
    extractCompanionPerspective(aiResponse, companionType, decisionContext) {
        // Extract the main reply/analysis from AI response
        const perspective = aiResponse.reply || aiResponse.analysis || aiResponse.response || '';
        
        // Add companion type prefix if not already present
        if (!perspective.toLowerCase().includes(companionType.replace('_', ' '))) {
            return `${companionType.replace('_', ' ')} perspective: ${perspective}`;
        }
        
        return perspective;
    }

    /**
     * Get fallback companion input when AI is unavailable
     * @param {string} companionType - Type of companion
     * @param {string} decisionContext - Decision context
     * @returns {string} Fallback response
     */
    getFallbackCompanionInput(companionType, decisionContext) {
        const fallbacks = {
            medical_companion: `Medical perspective: Analyzing health and wellbeing implications for: ${decisionContext}. Recommending consideration of stress factors and long-term health impact.`,
            professional_companion: `Professional perspective: Evaluating career and business outcomes for: ${decisionContext}. Suggesting analysis of professional relationships and work-life balance.`,
            social_companion: `Social perspective: Assessing relationship and community impact for: ${decisionContext}. Advising consideration of social dynamics and personal fulfillment.`
        };

        return fallbacks[companionType] || `${companionType}: Decision analysis not available - using fallback assessment for: ${decisionContext}`;
    }

    /**
     * Get user circles (helper method)
     * @param {string} userId - User ID
     * @returns {Promise<Array>} User circles
     */
    async getUserCircles(userId) {
        try {
            const db = await import('../../db/connection.js').then(m => m.getDb());
            return await db.all(`
                SELECT c.* FROM care_circles c
                JOIN circle_members cm ON c.circle_id = cm.circle_id
                WHERE cm.user_id = ?
                ORDER BY c.created_at DESC
            `, [userId]);
        } catch (error) {
            console.error('[CompanionComm] Failed to get user circles:', error.message);
            return [];
        }
    }

    /**
     * Analyze consensus between companion inputs
     * @param {object} companionInputs - Inputs from different companions
     * @param {string} decisionContext - Decision context
     * @returns {object} Consensus analysis
     */
    analyzeCompanionConsensus(companionInputs, decisionContext) {
        const inputs = Object.values(companionInputs).filter(input => input && input.length > 0);
        
        if (inputs.length === 0) {
            return {
                reached: false,
                recommendation: 'Insufficient companion input',
                confidence: 0,
                reason: 'No companion perspectives available'
            };
        }

        // Simple consensus analysis (in real implementation, would use AI)
        const conflictKeywords = ['concern', 'risk', 'caution', 'advise against'];
        const supportKeywords = ['recommend', 'positive', 'beneficial', 'good'];
        
        let supportCount = 0;
        let concernCount = 0;
        
        inputs.forEach(input => {
            const lowerInput = input.toLowerCase();
            if (supportKeywords.some(keyword => lowerInput.includes(keyword))) {
                supportCount++;
            }
            if (conflictKeywords.some(keyword => lowerInput.includes(keyword))) {
                concernCount++;
            }
        });

        const totalInputs = inputs.length;
        const agreementRatio = Math.max(supportCount, concernCount) / totalInputs;
        
        return {
            reached: agreementRatio >= 0.6,  // 60% agreement threshold
            recommendation: supportCount > concernCount ? 
                'Companions generally support this decision' : 
                'Companions have concerns about this decision',
            confidence: agreementRatio,
            reason: `${supportCount} supportive, ${concernCount} concerned out of ${totalInputs} companions`,
            supportCount,
            concernCount
        };
    }

    /**
     * Get confidential messages for a companion
     * @param {string} companionType - Type of companion
     * @param {string} userId - User ID
     * @param {boolean} unreadOnly - Only unread messages
     * @returns {Promise<Array>} Confidential messages
     */
    async getCompanionMessages(companionType, userId, unreadOnly = false) {
        const db = await getDb();
        
        let query = `
            SELECT * FROM companion_confidential_messages
            WHERE recipient_user_id = ? AND 
                  (recipient_companion_id = ? OR recipient_companion_id IS NULL)
            AND (expires_at IS NULL OR expires_at > ?)
            ORDER BY created_at DESC
        `;
        
        let params = [userId, companionType, Date.now()];
        
        if (unreadOnly) {
            query += ' AND read_at IS NULL';
        }

        return await db.all(query, params);
    }

    /**
     * Mark companion message as read
     * @param {string} messageId - Message ID
     * @returns {Promise<void>}
     */
    async markCompanionMessageRead(messageId) {
        const db = await getDb();
        await db.run(`
            UPDATE companion_confidential_messages 
            SET read_at = ? 
            WHERE message_id = ?
        `, [Date.now(), messageId]);
    }

    /**
     * Clean up expired confidential messages
     * @returns {Promise<number>} Number of messages cleaned up
     */
    async cleanupExpiredMessages() {
        const db = await getDb();
        const result = await db.run(`
            DELETE FROM companion_confidential_messages
            WHERE expires_at IS NOT NULL AND expires_at < ?
        `, [Date.now()]);
        
        if (result.changes > 0) {
            console.log(`[CompanionComm] Cleaned up ${result.changes} expired confidential messages`);
        }
        
        return result.changes;
    }
}

export default CompanionConfidentialComm;