/**
 * @fileoverview Professional Circle Routing System
 * Leverages existing agentic framework for intelligent professional context analysis
 * Integrates with unifiedAgent.js for AI-powered routing decisions
 */

import { processUserMessage, performContextEnrichment } from '../../agents/index.js';
import { getCircleMembers, findUserByUsername, findUserById, findCircleById } from '../../db/index.js';

/**
 * Professional Circle Information Router
 * Uses AI agents for intelligent professional context analysis and routing
 */
export class ProfessionalCircleRouter {
    constructor() {
        // Instead of hardcoded keywords, we rely on AI analysis
        this.aiAnalysisConfig = {
            useCase: 'professional_context_analysis',
            model: 'gemini-pro', // Use your existing model selection
            contextWindow: 'medium'
        };
    }

    /**
     * Analyze message content using AI agents for professional context
     * @param {string} message - The message to analyze
     * @param {object} existingAnalysis - Existing AI analysis result
     * @param {string} userId - User ID for context
     * @param {string} circleId - Circle ID for context
     * @returns {Promise<object>} AI-powered professional context analysis
     */
    async analyzeProfessionalContext(message, existingAnalysis, userId = null, circleId = null) {
        try {
            // If we already have AI analysis, enhance it for professional context
            if (existingAnalysis && existingAnalysis.intent && existingAnalysis.facts) {
                return await this.enhanceExistingAnalysis(message, existingAnalysis, userId, circleId);
            }

            // Otherwise, get fresh AI analysis focused on professional context
            return await this.performProfessionalAIAnalysis(message, userId, circleId);
            
        } catch (error) {
            console.error('[ProfessionalRouter] AI analysis failed, falling back to basic analysis:', error.message);
            return this.fallbackBasicAnalysis(message);
        }
    }

    /**
     * Enhance existing AI analysis with professional context insights
     * @param {string} message - Original message
     * @param {object} analysis - Existing AI analysis
     * @param {string} userId - User ID
     * @param {string} circleId - Circle ID
     * @returns {Promise<object>} Enhanced analysis
     */
    async enhanceExistingAnalysis(message, analysis, userId, circleId) {
        // Use your existing context enrichment system
        const professionalEnrichment = await performContextEnrichment({
            originalMessage: message,
            analysis: analysis,
            enrichmentType: 'professional_context',
            userContext: {
                userId,
                circleId,
                focus: 'business_professional_routing'
            }
        });

        // Extract professional insights from AI enrichment
        const professionalContext = this.extractProfessionalInsights(
            professionalEnrichment, 
            analysis
        );

        return {
            ...professionalContext,
            originalAnalysis: analysis,
            aiEnhanced: true,
            confidenceScore: professionalEnrichment.confidence || 0.8
        };
    }

    /**
     * Perform AI analysis specifically for professional context
     * @param {string} message - Message to analyze
     * @param {string} userId - User ID
     * @param {string} circleId - Circle ID
     * @returns {Promise<object>} Professional context analysis
     */
    async performProfessionalAIAnalysis(message, userId, circleId) {
        if (!userId || !circleId) {
            // If no context available, use basic AI analysis
            return this.fallbackBasicAnalysis(message);
        }

        // Use your existing processUserMessage with professional focus
        const members = await getCircleMembers(circleId);
        const aiAnalysis = await processUserMessage(
            userId,
            'user', // role
            message,
            members,
            circleId,
            null, // promptVersion
            {
                analysisMode: 'professional_context',
                focusAreas: ['business_relevance', 'professional_relationships', 'work_context'],
                routingPurpose: true
            }
        );

        return this.extractProfessionalInsights(aiAnalysis, aiAnalysis);
    }

    /**
     * Extract professional insights from AI analysis
     * @param {object} enrichment - AI enrichment result
     * @param {object} originalAnalysis - Original analysis
     * @returns {object} Professional context insights
     */
    extractProfessionalInsights(enrichment, originalAnalysis) {
        const facts = originalAnalysis.facts || {};
        const intent = originalAnalysis.intent || 'ASKING_QUESTION';
        
        // AI-determined professional relevance
        const professionalRelevance = this.calculateAIProfessionalRelevance(
            enrichment, 
            facts, 
            intent
        );

        // AI-suggested routing
        const routingSuggestion = this.determineAIRouting(
            enrichment,
            professionalRelevance,
            facts
        );

        return {
            relevanceScore: professionalRelevance.score,
            categories: professionalRelevance.categories,
            keyEntities: this.extractKeyEntities(facts, enrichment),
            suggestedRouting: routingSuggestion,
            aiInsights: {
                businessContext: enrichment.business_context || null,
                workRelationships: enrichment.work_relationships || [],
                professionalPriority: enrichment.professional_priority || 'medium',
                crossDomainImpact: enrichment.cross_domain_impact || null
            }
        };
    }

    /**
     * Calculate professional relevance using AI insights
     * @param {object} enrichment - AI enrichment
     * @param {object} facts - Extracted facts
     * @param {string} intent - User intent
     * @returns {object} Professional relevance analysis
     */
    calculateAIProfessionalRelevance(enrichment, facts, intent) {
        let score = 0;
        const categories = [];

        // Use AI confidence scores if available
        if (enrichment.business_context) {
            score += (enrichment.business_context.confidence || 0.5);
            categories.push({
                category: enrichment.business_context.category || 'general_business',
                confidence: enrichment.business_context.confidence || 0.5,
                aiDetermined: true
            });
        }

        // Check if AI identified professional relationships
        if (enrichment.work_relationships && enrichment.work_relationships.length > 0) {
            score += 0.3;
            categories.push({
                category: 'professional_relationships',
                confidence: 0.8,
                entities: enrichment.work_relationships
            });
        }

        // Intent-based professional relevance
        const professionalIntents = [
            'REQUESTING_WORK_ADVICE', 
            'REPORTING_WORK_ISSUE',
            'PROJECT_COORDINATION',
            'BUSINESS_DECISION_NEEDED'
        ];
        
        if (professionalIntents.includes(intent)) {
            score += 0.4;
        }

        return {
            score: Math.min(score, 1.0), // Cap at 1.0
            categories,
            aiConfidence: enrichment.confidence || 0.7
        };
    }

    /**
     * Determine AI-powered routing suggestion
     * @param {object} enrichment - AI enrichment
     * @param {object} professionalRelevance - Professional relevance analysis
     * @param {object} facts - Extracted facts
     * @returns {object} Routing suggestion
     */
    determineAIRouting(enrichment, professionalRelevance, facts) {
        // High AI confidence in professional context
        if (professionalRelevance.score > 0.7 && professionalRelevance.aiConfidence > 0.8) {
            return {
                routeType: 'professional_circle',
                reason: 'AI detected high business relevance with high confidence',
                confidenceScore: professionalRelevance.aiConfidence,
                suggestedRole: this.determineAITargetRole(enrichment),
                aiRecommended: true
            };
        }

        // Moderate confidence - mixed context
        if (professionalRelevance.score > 0.4) {
            return {
                routeType: 'mixed_context',
                reason: 'AI detected moderate business relevance - companion coordination recommended',
                confidenceScore: professionalRelevance.aiConfidence,
                requiresUserDecision: professionalRelevance.aiConfidence < 0.7,
                aiRecommended: true
            };
        }

        return {
            routeType: 'low_professional_relevance',
            reason: 'AI analysis indicates limited business context',
            confidenceScore: professionalRelevance.aiConfidence,
            aiRecommended: true
        };
    }

    /**
     * Determine target role using AI insights
     * @param {object} enrichment - AI enrichment result
     * @returns {string} Suggested role
     */
    determineAITargetRole(enrichment) {
        // Use AI's role suggestion if available
        if (enrichment.recommended_role) {
            return enrichment.recommended_role;
        }

        // AI-determined priority type
        const priority = enrichment.professional_priority || 'medium';
        const businessContext = enrichment.business_context || {};

        // Decision-focused content → Target
        if (businessContext.category === 'decision_making' || priority === 'strategic') {
            return 'target';
        }

        // Technical or specialized content → Expert
        if (businessContext.category === 'technical' || businessContext.category === 'specialized') {
            return 'expert';
        }

        // Coordination content → Support
        if (businessContext.category === 'coordination' || priority === 'operational') {
            return 'support';
        }

        return 'target'; // Default to decision maker
    }

    /**
     * Extract key entities using AI analysis
     * @param {object} facts - Extracted facts
     * @param {object} enrichment - AI enrichment
     * @returns {Array} Key entities
     */
    extractKeyEntities(facts, enrichment) {
        const entities = [];

        // Add AI-identified entities
        if (enrichment.entities) {
            enrichment.entities.forEach(entity => {
                entities.push({
                    key: entity.name || entity.key,
                    fact: entity,
                    type: entity.type || 'ai_identified',
                    confidence: entity.confidence || 0.8
                });
            });
        }

        // Add facts identified as professional
        Object.entries(facts).forEach(([key, fact]) => {
            if (this.isAIProfessionalEntity(fact, enrichment)) {
                entities.push({ key, fact, type: 'professional', confidence: 0.7 });
            }
        });

        return entities;
    }

    /**
     * Check if entity is professional using AI insights
     * @param {any} fact - The fact to analyze
     * @param {object} enrichment - AI enrichment context
     * @returns {boolean}
     */
    isAIProfessionalEntity(fact, enrichment) {
        if (typeof fact !== 'string') return false;
        
        // Use AI's entity classification if available
        if (enrichment.entity_classifications) {
            const classification = enrichment.entity_classifications.find(ec => 
                ec.text === fact || fact.includes(ec.text)
            );
            if (classification) {
                return classification.category === 'professional' || classification.category === 'business';
            }
        }

        // Fallback to basic check
        const professionalIndicators = ['project', 'work', 'client', 'team', 'meeting', 'deadline'];
        return professionalIndicators.some(indicator => 
            fact.toLowerCase().includes(indicator)
        );
    }

    /**
     * Fallback analysis when AI is unavailable
     * @param {string} message - Message to analyze
     * @returns {object} Basic analysis
     */
    fallbackBasicAnalysis(message) {
        console.log('[ProfessionalRouter] Using fallback basic analysis');
        
        // Simple keyword-based fallback
        const businessKeywords = ['project', 'work', 'client', 'meeting', 'deadline'];
        const lowerMessage = message.toLowerCase();
        const matches = businessKeywords.filter(keyword => lowerMessage.includes(keyword));
        
        return {
            relevanceScore: matches.length * 0.2,
            categories: matches.map(match => ({ category: match, confidence: 0.5, fallback: true })),
            keyEntities: [],
            suggestedRouting: {
                routeType: matches.length > 2 ? 'professional_circle' : 'low_professional_relevance',
                reason: 'Fallback keyword analysis',
                confidenceScore: 0.5,
                suggestedRole: 'target'
            },
            aiEnhanced: false,
            fallbackUsed: true
        };
    }

    // Rest of the routing methods remain the same but now use AI analysis...
    async routeProfessionalInformation(userId, circleId, analysis, professionalContext) {
        // Use existing implementation but with AI-enhanced context
        const factsAboutOthers = this.extractFactsAboutOthers(analysis, userId);
        const routingResults = [];

        for (const factInfo of factsAboutOthers) {
            const { targetMember, fact } = factInfo;
            
            const targetProfessionalCircle = await this.findProfessionalCircleForUser(targetMember.user_id);
            
            if (targetProfessionalCircle) {
                const routingDecision = await this.routeToSpecificProfessionalCircle(
                    targetProfessionalCircle,
                    fact,
                    professionalContext,
                    userId
                );
                routingResults.push(routingDecision);
            }
        }

        return {
            success: true,
            routingResults,
            professionalContext,
            aiPowered: professionalContext.aiEnhanced || false
        };
    }

    // ... rest of methods remain similar but now AI-enhanced
    extractFactsAboutOthers(analysis, reporterUserId) {
        if (!analysis.facts || !analysis.resolvedUsers) return [];

        const factsAboutOthers = [];
        
        analysis.resolvedUsers.forEach(resolvedUser => {
            const targetMember = resolvedUser.matchedMember;
            if (targetMember.user_id === reporterUserId) return;
            
            Object.entries(analysis.facts).forEach(([key, fact]) => {
                if (typeof fact === 'string' && 
                    fact.toLowerCase().includes(targetMember.username.toLowerCase())) {
                    factsAboutOthers.push({
                        targetMember,
                        fact: { key, value: fact },
                        confidence: resolvedUser.confidence || 0.8
                    });
                }
            });
        });

        return factsAboutOthers;
    }

    async findProfessionalCircleForUser(userId) {
        const db = await import('../../db/connection.js').then(m => m.getDb());
        
        const circles = await db.all(`
            SELECT c.*, cm.role, cm.relationship 
            FROM care_circles c
            JOIN circle_members cm ON c.circle_id = cm.circle_id
            WHERE cm.user_id = ? AND c.circle_type = 'professional'
            ORDER BY c.created_at DESC
        `, [userId]);

        return circles.length > 0 ? circles[0] : null;
    }

    async routeToSpecificProfessionalCircle(circle, fact, context, reporterUserId) {
        const members = await getCircleMembers(circle.circle_id);
        const suggestedRole = context.suggestedRouting?.suggestedRole || 'target';
        
        const targetMember = members.find(m => m.role === suggestedRole);
        const fallbackMember = members.find(m => m.role === 'target');
        
        const finalTarget = targetMember || fallbackMember || members[0];

        if (finalTarget) {
            return {
                circleId: circle.circle_id,
                circleType: 'professional',
                targetMember: finalTarget,
                fact: fact,
                routingReason: context.aiEnhanced ? 
                    `AI-powered routing to ${suggestedRole}` : 
                    `Professional context routed to ${suggestedRole}`,
                confidenceScore: context.confidenceScore || 0.7,
                privacyLevel: this.determineProfessionalPrivacyLevel(fact.value, context),
                aiPowered: context.aiEnhanced || false
            };
        }

        return null;
    }

    determineProfessionalPrivacyLevel(factValue, context) {
        // Use AI insights if available
        if (context.aiInsights && context.aiInsights.professionalPriority) {
            const priority = context.aiInsights.professionalPriority;
            
            if (priority === 'confidential' || priority === 'strategic') {
                return 'BUSINESS_CONFIDENTIAL';
            }
            
            if (priority === 'internal') {
                return 'BUSINESS_INTERNAL';
            }
        }

        // Fallback to keyword analysis
        const confidentialKeywords = [
            'confidential', 'budget', 'salary', 'contract', 'legal',
            'strategy', 'acquisition', 'merger', 'competitor', 'proprietary'
        ];
        
        const internalKeywords = ['performance', 'review', 'feedback', 'personal', 'issue'];
        const lowerFact = factValue.toLowerCase();

        if (confidentialKeywords.some(keyword => lowerFact.includes(keyword))) {
            return 'BUSINESS_CONFIDENTIAL';
        }

        if (internalKeywords.some(keyword => lowerFact.includes(keyword))) {
            return 'BUSINESS_INTERNAL';
        }

        return 'PROFESSIONAL_PRIVATE';
    }
}

export default ProfessionalCircleRouter;