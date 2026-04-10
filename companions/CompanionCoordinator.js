/**
 * @fileoverview CompanionCoordinator
 * The coordinator that coordinates all Companion handlers, agents, and makes final decisions
 * Part of the Companion (coordinators + agents + handlers) that serves a user
 * ENHANCED: Now includes confidential companion-to-companion communication and decision coordination
 */

import { processCompanionHandlers } from './handlers/index.js';
import { aggregateResponses, resolveConflicts } from './utils/responseAggregator.js';
import { getDb } from '../db/connection.js';
import { processUserMessage, performContextEnrichment } from '../agents/unifiedAgent.js';

/**
 * Main coordinator that coordinates all Companion components
 * @param {string} userId - User ID
 * @param {string} role - User role (patient, caregiver, doctor)
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context (history, state, etc.)
 * @returns {Promise<object>} Final response object
 */
export async function coordinateCompanions(userId, role, message, circleId, context) {
    try {
        // Step 1: Activate all relevant handlers and agents
        // Some handlers depend on others, so we process in stages
        const initialResults = await processCompanionHandlers(userId, role, message, circleId, context);
        
        // Step 2: Enhance context with initial results for dependent handlers
        const enhancedContext = {
            ...context,
            inputUnderstanding: initialResults.inputUnderstanding?.result || {},
            historyAnalyzer: initialResults.historyAnalyzer?.result || {},
            empathyHandler: initialResults.empathyHandler?.result || {},
            stateTracker: initialResults.stateTracker?.result || {}
        };
        
        // Step 3: Re-process handlers that need enhanced context (like privacyGuard)
        // For now, privacyGuard gets enhanced context inline
        const componentResults = initialResults;
        
        // Update privacyGuard with enhanced context if it didn't get it
        if (componentResults.privacyGuard && !componentResults.privacyGuard.result.sharingSuggestion) {
            const { processPrivacyDecision } = await import('./handlers/privacyGuard.js');
            componentResults.privacyGuard.result = await processPrivacyDecision(
                userId, role, message, circleId, enhancedContext
            );
        }
        
        // Step 4: Aggregate responses from all handlers and agents
        const aggregated = aggregateResponses(componentResults);
        
        // Step 5: Resolve any conflicts between handlers and agents
        const resolved = resolveConflicts(aggregated, componentResults);
        
        // Step 6: Generate future_plan if needed
        // Calculate current turn from conversation history
        const currentTurn = context.history ? 
            context.history.filter(m => m.user_id === userId).length + 1 : 1;
        
        // Generate future plan using dedicated agent
        let futurePlan = aggregated.future_plan || null;
        if (!futurePlan) {
            try {
                const { generateFuturePlan } = await import('./agents/futurePlanningAgent.js');
                futurePlan = await generateFuturePlan(
                    userId, 
                    role, 
                    message, 
                    circleId, 
                    context, 
                    currentTurn
                );
            } catch (error) {
                console.error('[CompanionCoordinator] Error generating future plan:', error.message);
                futurePlan = null;
            }
        }
        resolved.future_plan = futurePlan;
        
        // Step 7: Add state_update from state tracker
        resolved.state_update = aggregated.state_update || initialResults.stateTracker?.result?.state_update || null;
        
        // Step 8: Ensure we have required fields for compatibility
        if (!resolved.intent) {
            resolved.intent = aggregated.intent || 'ASKING_QUESTION';
        }
        if (!resolved.reply) {
            resolved.reply = 'I understand. Can you tell me more?';
        }
        
        // Step 9: Return final coordinated response
        return resolved;
    } catch (error) {
        console.error('[CompanionCoordinator] Error:', error.message);
        // Fallback response
        return {
            intent: 'ASKING_QUESTION',
            reply: 'I understand. Can you tell me more?',
            criticality: 'NONE',
            privacyLevel: 'PRIVATE',
            facts: {},
            sharingSuggestion: null
        };
    }
}

/**
 * Determine which handlers and agents are relevant for this message
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {object} context - Conversation context
 * @returns {Array<string>} List of handler names to activate
 */
export function getRelevantHandlers(role, message, context) {
    const components = [];
    
    // Core handlers (always included)
    components.push('inputUnderstanding', 'historyAnalyzer', 'empathyHandler', 'privacyGuard', 'stateTracker');
    
    // Role-specific agents
    if (role === 'patient') {
        components.push('patientOptimizer');
    } else if (role === 'doctor') {
        components.push('doctorOptimizer');
    }
    
    // Context-dependent agents
    if (context.hasMedicalContent || message.toLowerCase().includes('pain') || message.toLowerCase().includes('symptom')) {
        components.push('clinicalAgent');
    }
    
    if (context.hasCriticalContent || message.toLowerCase().includes('emergency') || message.toLowerCase().includes('urgent')) {
        components.push('escalationManager');
    }
    
    return components;
}

/**
 * Enhanced CompanionCoordinator class with confidential communication capabilities
 */
export class CompanionCoordinator {
    constructor() {
        this.confidentialLevels = {
            COMPANION_ONLY: 'companion_only',      // Only the sending companion sees this
            COMPANION_NETWORK: 'companion_network', // All user's companions can see
            CROSS_USER_COMPANION: 'cross_user'     // Can be shared with other users' companions
        };
    }

    /**
     * Initialize database schema for confidential communication
     */
    async initializeSchema() {
        const db = getDb();
        
        // Companion confidential messages
        await db.exec(`
            CREATE TABLE IF NOT EXISTS companion_confidential_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_companion_type TEXT NOT NULL,
                receiver_companion_type TEXT NOT NULL,
                user_id TEXT NOT NULL,
                target_user_id TEXT,
                message_content TEXT NOT NULL,
                confidential_level TEXT NOT NULL,
                context_data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                read_at DATETIME,
                expires_at DATETIME
            )
        `);

        // Intelligence sharing between companions
        await db.exec(`
            CREATE TABLE IF NOT EXISTS companion_intel_sharing (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_companion TEXT NOT NULL,
                target_companion TEXT NOT NULL,
                user_id TEXT NOT NULL,
                intelligence_type TEXT NOT NULL,
                intelligence_content TEXT NOT NULL,
                confidence_level REAL DEFAULT 0.5,
                shared_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                acted_upon BOOLEAN DEFAULT FALSE
            )
        `);

        // Decision coordination between companions
        await db.exec(`
            CREATE TABLE IF NOT EXISTS companion_decision_sync (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                decision_context TEXT NOT NULL,
                user_id TEXT NOT NULL,
                circle_id TEXT,
                medical_companion_input TEXT,
                professional_companion_input TEXT,
                social_companion_input TEXT,
                consensus_reached BOOLEAN DEFAULT FALSE,
                final_decision TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    /**
     * Send confidential message between companions
     */
    async sendCompanionMessage(senderType, receiverType, userId, messageContent, confidentialLevel = 'companion_network', contextData = null, targetUserId = null) {
        const db = getDb();
        
        // Set expiration based on confidential level (24h for companion_only, 7d for others)
        const expirationHours = confidentialLevel === 'companion_only' ? 24 : 168;
        const expiresAt = new Date(Date.now() + expirationHours * 60 * 60 * 1000).toISOString();

        const result = await db.run(`
            INSERT INTO companion_confidential_messages (
                sender_companion_type, receiver_companion_type, user_id, target_user_id,
                message_content, confidential_level, context_data, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [senderType, receiverType, userId, targetUserId, messageContent, confidentialLevel, JSON.stringify(contextData), expiresAt]);

        console.log(`[CompanionCoordinator] Confidential message sent: ${senderType} → ${receiverType} (Level: ${confidentialLevel})`);
        return result.lastID;
    }

    /**
     * Share intelligence between companions
     */
    async shareIntelligenceBetweenCompanions(sourceCompanion, targetCompanion, userId, intelligenceType, content, confidenceLevel = 0.7) {
        const db = getDb();
        
        await db.run(`
            INSERT INTO companion_intel_sharing (
                source_companion, target_companion, user_id, intelligence_type, 
                intelligence_content, confidence_level
            ) VALUES (?, ?, ?, ?, ?, ?)
        `, [sourceCompanion, targetCompanion, userId, intelligenceType, content, confidenceLevel]);

        console.log(`[CompanionCoordinator] Intelligence shared: ${sourceCompanion} → ${targetCompanion} (${intelligenceType}, confidence: ${confidenceLevel})`);
    }

    /**
     * Coordinate decision-making among multiple companions
     */
    async coordinateCompanionDecision(decisionContext, userId, circleId = null, messageForAnalysis = null) {
        const db = getDb();
        
        // Get decision input from each companion type
        const medicalInput = await this.getCompanionDecisionInput('medical', userId, decisionContext, messageForAnalysis);
        const professionalInput = await this.getCompanionDecisionInput('professional', userId, decisionContext, messageForAnalysis);
        const socialInput = await this.getCompanionDecisionInput('social', userId, decisionContext, messageForAnalysis);

        // Analyze consensus
        const consensus = this.analyzeCompanionConsensus([medicalInput, professionalInput, socialInput]);
        
        // Store decision coordination
        const result = await db.run(`
            INSERT INTO companion_decision_sync (
                decision_context, user_id, circle_id, medical_companion_input,
                professional_companion_input, social_companion_input,
                consensus_reached, final_decision
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            decisionContext, userId, circleId,
            JSON.stringify(medicalInput), JSON.stringify(professionalInput), JSON.stringify(socialInput),
            consensus.reached, JSON.stringify(consensus.decision)
        ]);

        console.log(`[CompanionCoordinator] Decision coordination complete. Consensus: ${consensus.reached}`);
        return {
            decisionId: result.lastID,
            consensus: consensus.reached,
            decision: consensus.decision,
            companionInputs: {
                medical: medicalInput,
                professional: professionalInput,
                social: socialInput
            }
        };
    }

    /**
     * Get decision input from a specific companion type using existing AI agents
     */
    async getCompanionDecisionInput(companionType, userId, decisionContext, messageForAnalysis = null) {
        try {
            // Create companion-specific decision prompt
            const prompt = this.createCompanionDecisionPrompt(companionType, decisionContext, messageForAnalysis);
            
            // Use existing AI processing with companion focus
            const analysis = await processUserMessage(prompt, {
                userId,
                focusAreas: this.getCompanionFocusAreas(companionType),
                analysisDepth: 'medium'
            });

            // Extract companion perspective from AI response
            return this.extractCompanionPerspective(companionType, analysis, decisionContext);

        } catch (error) {
            console.error(`[CompanionCoordinator] Error getting ${companionType} companion input:`, error);
            // Fallback to basic companion input
            return this.getFallbackCompanionInput(companionType, decisionContext);
        }
    }

    /**
     * Create companion-specific decision prompt
     */
    createCompanionDecisionPrompt(companionType, decisionContext, messageForAnalysis) {
        const basePrompt = `As a ${companionType} companion AI, analyze this decision context and provide your perspective:`;
        
        let specificGuidance = '';
        switch (companionType) {
            case 'medical':
                specificGuidance = 'Focus on health implications, safety considerations, and medical best practices.';
                break;
            case 'professional':
                specificGuidance = 'Focus on business implications, organizational dynamics, and professional relationships.';
                break;
            case 'social':
                specificGuidance = 'Focus on social dynamics, relationship implications, and community considerations.';
                break;
        }

        return `${basePrompt}

Decision Context: ${decisionContext}
${messageForAnalysis ? `Related Message: ${messageForAnalysis}` : ''}

${specificGuidance}

Please provide:
1. Your perspective on this decision
2. Key concerns or considerations from your domain
3. Recommended action or approach
4. Confidence level (0.0-1.0)`;
    }

    /**
     * Get focus areas for different companion types
     */
    getCompanionFocusAreas(companionType) {
        const focusMap = {
            medical: ['health_safety', 'medical_protocols', 'care_coordination'],
            professional: ['business_goals', 'organizational_dynamics', 'professional_relationships'],
            social: ['social_dynamics', 'community_impact', 'relationship_health']
        };
        return focusMap[companionType] || ['general_analysis'];
    }

    /**
     * Extract companion perspective from AI analysis
     */
    extractCompanionPerspective(companionType, analysis, decisionContext) {
        // Parse AI response to extract structured companion input
        const text = analysis.response || analysis.message || '';
        
        // Basic parsing - in real implementation, would use more sophisticated extraction
        const perspective = text.includes('perspective') ? 
            text.split('perspective')[1]?.split('2.')[0]?.trim() : 
            'No clear perspective identified';
        
        const concerns = text.includes('concerns') || text.includes('considerations') ?
            text.split(/concerns|considerations/)[1]?.split('3.')[0]?.trim() :
            'No specific concerns identified';

        const recommendation = text.includes('recommend') ?
            text.split('recommend')[1]?.split('4.')[0]?.trim() :
            'No specific recommendation';

        // Extract confidence level
        const confidenceMatch = text.match(/confidence.*?(\d*\.?\d+)/i);
        const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;

        return {
            companionType,
            perspective,
            concerns,
            recommendation,
            confidence,
            decisionContext,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Fallback companion input when AI is unavailable
     */
    getFallbackCompanionInput(companionType, decisionContext) {
        const fallbacks = {
            medical: {
                perspective: 'Focus on health and safety implications',
                concerns: 'Ensure medical protocols are followed',
                recommendation: 'Prioritize patient safety and care quality',
                confidence: 0.3
            },
            professional: {
                perspective: 'Consider business and organizational impact',
                concerns: 'Maintain professional relationships and goals',
                recommendation: 'Balance efficiency with relationship preservation',
                confidence: 0.3
            },
            social: {
                perspective: 'Consider social and community dynamics',
                concerns: 'Maintain social harmony and relationships',
                recommendation: 'Foster positive social interactions',
                confidence: 0.3
            }
        };

        const fallback = fallbacks[companionType] || fallbacks.social;
        return {
            companionType,
            ...fallback,
            decisionContext,
            timestamp: new Date().toISOString(),
            fallback: true
        };
    }

    /**
     * Analyze consensus between companion inputs
     */
    analyzeCompanionConsensus(companionInputs) {
        // Simple consensus analysis - in real implementation, would use AI
        const avgConfidence = companionInputs.reduce((sum, input) => sum + input.confidence, 0) / companionInputs.length;
        
        // Check for conflicting recommendations (basic keyword analysis)
        const recommendations = companionInputs.map(input => input.recommendation.toLowerCase());
        const hasConflict = recommendations.some(rec => 
            recommendations.some(other => 
                rec.includes('not') !== other.includes('not') || 
                rec.includes('avoid') !== other.includes('avoid')
            )
        );

        const reached = avgConfidence > 0.6 && !hasConflict;
        
        return {
            reached,
            confidence: avgConfidence,
            conflictsDetected: hasConflict,
            decision: reached ? {
                action: 'proceed_with_coordination',
                rationale: `Companions reached consensus with ${(avgConfidence * 100).toFixed(1)}% confidence`,
                companionAlignment: 'aligned'
            } : {
                action: 'require_human_input',
                rationale: hasConflict ? 'Companions have conflicting perspectives' : 'Low confidence in decision',
                companionAlignment: hasConflict ? 'conflicted' : 'uncertain'
            }
        };
    }

    /**
     * Get confidential messages for a companion
     */
    async getCompanionMessages(companionType, userId, unreadOnly = false) {
        const db = getDb();
        
        let query = `
            SELECT * FROM companion_confidential_messages 
            WHERE receiver_companion_type = ? AND user_id = ?
            AND (expires_at IS NULL OR expires_at > datetime('now'))
        `;
        const params = [companionType, userId];
        
        if (unreadOnly) {
            query += ' AND read_at IS NULL';
        }
        
        query += ' ORDER BY created_at DESC';
        
        const messages = await db.all(query, params);
        return messages.map(msg => ({
            ...msg,
            context_data: msg.context_data ? JSON.parse(msg.context_data) : null
        }));
    }

    /**
     * Mark companion message as read
     */
    async markCompanionMessageRead(messageId) {
        const db = getDb();
        await db.run(`
            UPDATE companion_confidential_messages 
            SET read_at = datetime('now') 
            WHERE id = ?
        `, [messageId]);
    }

    /**
     * Clean up expired messages
     */
    async cleanupExpiredMessages() {
        const db = getDb();
        const result = await db.run(`
            DELETE FROM companion_confidential_messages 
            WHERE expires_at IS NOT NULL AND expires_at < datetime('now')
        `);
        
        if (result.changes > 0) {
            console.log(`[CompanionCoordinator] Cleaned up ${result.changes} expired companion messages`);
        }
        return result.changes;
    }
}

