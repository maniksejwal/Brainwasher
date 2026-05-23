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
        const consensus = await this.analyzeCompanionConsensus(companionInputs, decisionContext);
        
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
            // Use prompts from the prompts package
            const { generateCompanionDecisionPrompt } = await import('../../prompts/companion_decision_analysis.js');
            const companionPrompt = generateCompanionDecisionPrompt(companionType, decisionContext);
            
            // Import the API client
            const { makeApiCall } = await import('../../agents/api_client.js');
            
            // Use your API with optimized parameters for companion decision analysis
            const aiResponse = await makeApiCall(
                companionPrompt,
                [], // No history for decision analysis
                false, // Expect text response, not JSON
                0.4, // Lower temperature for more consistent analysis
                400, // Increase token limit for comprehensive analysis
                'companion_decision_analysis' // Specialized use case
            );
            
            // Extract the analysis text
            const analysisText = aiResponse.reply || aiResponse.response || aiResponse;
            
            if (!analysisText || typeof analysisText !== 'string') {
                throw new Error('Invalid AI response format');
            }

            // Add companion type prefix for clarity in consensus analysis
            const formattedAnalysis = `**${companionType.replace('_', ' ').toUpperCase()} PERSPECTIVE:**\n${analysisText}`;
            
            if (process.env.DEBUG_COMPANION) {
                console.log(`[CompanionComm] ${companionType} decision input:`, formattedAnalysis.substring(0, 200) + '...');
            }

            return formattedAnalysis;
            
        } catch (error) {
            console.error(`[CompanionComm] AI decision input failed for ${companionType}:`, error.message);
            // Fallback to structured response from prompts package
            return this.getFallbackCompanionInput(companionType, decisionContext);
        }
    }



    /**
     * Get fallback companion input when AI is unavailable
     * @param {string} companionType - Type of companion
     * @param {string} decisionContext - Decision context
     * @returns {string} Enhanced fallback response
     */
    getFallbackCompanionInput(companionType, decisionContext) {
        // Inline fallback to keep it simple and synchronous
        const fallbackMap = {
            medical_companion: `**MEDICAL PERSPECTIVE:**

**Impact Assessment:** This decision requires evaluation from a health and wellbeing perspective regarding: ${decisionContext}

**Risk Analysis:** Key health concerns include potential stress factors, impact on medical treatment adherence, sleep patterns, and overall physical wellbeing. Without detailed analysis, recommend monitoring for signs of health impact.

**Benefit Analysis:** Potential health benefits may include reduced stress, improved lifestyle balance, or enhanced treatment compliance, depending on the nature of the decision.

**Recommendation:** Recommend careful consideration of health implications and consultation with healthcare providers if the decision impacts medical treatment, stress levels, or overall wellbeing.

**Confidence Level:** 0.3 (Limited analysis without full medical context)

**Alternative Considerations:** Consider timing relative to medical appointments, impact on medication schedules, and alignment with current health goals.`,

            professional_companion: `**PROFESSIONAL PERSPECTIVE:**

**Impact Assessment:** This decision requires evaluation from a career and business perspective regarding: ${decisionContext}

**Risk Analysis:** Key professional concerns include potential impact on career trajectory, professional relationships, business outcomes, and work-life balance. Consider reputation management and opportunity costs.

**Benefit Analysis:** Potential professional benefits may include career advancement opportunities, skill development, network expansion, or improved work-life integration.

**Recommendation:** Recommend thorough analysis of career implications, stakeholder impact, and alignment with professional goals before proceeding.

**Confidence Level:** 0.3 (Limited analysis without full professional context)

**Alternative Considerations:** Consider timing relative to performance reviews, project deadlines, and strategic career planning objectives.`,

            social_companion: `**SOCIAL PERSPECTIVE:**

**Impact Assessment:** This decision requires evaluation from a social and relationship perspective regarding: ${decisionContext}

**Risk Analysis:** Key social concerns include potential impact on relationships, community connections, social dynamics, and personal fulfillment. Consider effects on family, friends, and social commitments.

**Benefit Analysis:** Potential social benefits may include strengthened relationships, community involvement, personal growth, or enhanced social wellbeing.

**Recommendation:** Recommend considering the social implications and discussing with key relationships who may be affected by this decision.

**Confidence Level:** 0.3 (Limited analysis without full social context)

**Alternative Considerations:** Consider timing relative to social commitments, impact on family dynamics, and alignment with personal relationship goals.`
        };

        return fallbackMap[companionType] || `**${companionType.replace('_', ' ').toUpperCase()} PERSPECTIVE:**

**Impact Assessment:** Decision analysis not available for companion type "${companionType}" regarding: ${decisionContext}

**Recommendation:** Unable to provide specialized analysis - recommend consulting appropriate domain experts.

**Confidence Level:** 0.1 (No specialized analysis available)

This is a fallback response due to system limitations.`;
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
     * Analyze consensus between companion inputs using LLM
     * @param {object} companionInputs - Inputs from different companions
     * @param {string} decisionContext - Decision context
     * @returns {Promise<object>} Consensus analysis
     */
    async analyzeCompanionConsensus(companionInputs, decisionContext) {
        const inputs = Object.values(companionInputs).filter(input => input && input.length > 0);
        
        if (inputs.length === 0) {
            return {
                reached: false,
                recommendation: 'Insufficient companion input',
                confidence: 0,
                reason: 'No companion perspectives available',
                supportCount: 0,
                concernCount: 0
            };
        }

        // Use LLM for sophisticated consensus analysis
        try {
            const consensusAnalysis = await this.performLLMConsensusAnalysis(companionInputs, decisionContext);
            return consensusAnalysis;
        } catch (error) {
            console.error('[CompanionComm] LLM consensus analysis failed, falling back to keyword analysis:', error.message);
            return this.fallbackKeywordConsensus(inputs);
        }
    }

    /**
     * Perform LLM-powered consensus analysis
     * @param {object} companionInputs - Inputs from different companions
     * @param {string} decisionContext - Decision context
     * @returns {Promise<object>} LLM consensus analysis
     */
    async performLLMConsensusAnalysis(companionInputs, decisionContext) {
        const { makeApiCall } = await import('../../agents/api_client.js');
        const { generateConsensusAnalysisPrompt } = await import('../../prompts/companion_decision_analysis.js');
        
        // Format companion inputs for analysis
        const companionSummaries = Object.entries(companionInputs)
            .filter(([_, input]) => input && input.length > 0)
            .map(([companionType, input]) => `**${companionType.replace('_', ' ').toUpperCase()}:**\n${input}`)
            .join('\n\n');

        const consensusPrompt = generateConsensusAnalysisPrompt(decisionContext, companionSummaries);

        const result = await makeApiCall(consensusPrompt, [], true, 0.3, 300, 'companion_consensus');
        
        // Validate and structure the response
        if (!result || typeof result !== 'object') {
            throw new Error('Invalid LLM response format');
        }

        // Ensure required fields exist
        const consensusAnalysis = {
            reached: result.reached || false,
            recommendation: result.recommendation || 'Unable to determine consensus',
            confidence: Math.min(Math.max(result.confidence || 0, 0), 1),
            reason: result.reason || 'LLM analysis completed',
            supportCount: result.supportCount || 0,
            concernCount: result.concernCount || 0,
            nuances: result.nuances || null,
            unanimous: result.unanimous || false,
            majorityPosition: result.majorityPosition || 'neutral',
            conflictingAreas: result.conflictingAreas || []
        };

        // Log the analysis for debugging
        if (process.env.DEBUG_COMPANION) {
            console.log('[CompanionComm] LLM Consensus Analysis:', JSON.stringify(consensusAnalysis, null, 2));
        }

        return consensusAnalysis;
    }

    /**
     * Fallback keyword-based consensus analysis
     * @param {Array} inputs - Companion input texts
     * @returns {object} Basic consensus analysis
     */
    fallbackKeywordConsensus(inputs) {
        const conflictKeywords = ['concern', 'risk', 'caution', 'advise against', 'warning', 'problem'];
        const supportKeywords = ['recommend', 'positive', 'beneficial', 'good', 'support', 'approve'];
        
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
            reached: agreementRatio >= 0.6,
            recommendation: supportCount > concernCount ? 
                'Companions generally support this decision' : 
                'Companions have concerns about this decision',
            confidence: agreementRatio,
            reason: `Fallback analysis: ${supportCount} supportive, ${concernCount} concerned out of ${totalInputs} companions`,
            supportCount,
            concernCount,
            nuances: 'Using fallback keyword analysis',
            unanimous: supportCount === totalInputs || concernCount === totalInputs,
            majorityPosition: supportCount > concernCount ? 'support' : (concernCount > supportCount ? 'concern' : 'neutral'),
            conflictingAreas: []
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