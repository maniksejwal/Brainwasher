/**
 * @fileoverview Conversation-Level Feedback Analyzer
 * Analyzes multi-message patterns and conversation-level effectiveness
 */

import { URGENCY_LEVELS, DENIAL_PATTERNS, GENERIC_RESPONSES } from '../../constants.js';

export class ConversationAnalyzer {
    constructor() {
        this.patterns = {
            repetitiveResponses: [],
            escalationPatterns: [],
            denialHandling: [],
            contextContinuity: [],
            goalProgression: []
        };
    }

    /**
     * Analyze conversation-level patterns and effectiveness
     */
    analyzeConversation(conversationHistory, feedbackHistory) {
        // Safety checks
        if (!conversationHistory || conversationHistory.length === 0) {
            console.warn('[ConversationAnalyzer] Empty conversation history provided');
            return this._createEmptyAnalysis();
        }
        
        // Normalize conversation history format (handle both role/content and userMessage/agentResponse formats)
        conversationHistory = this._normalizeConversationHistory(conversationHistory);
        
        if (!feedbackHistory || feedbackHistory.length === 0) {
            console.warn('[ConversationAnalyzer] Empty feedback history provided');
            return this._createEmptyAnalysis();
        }

        const analysis = {
            conversationId: conversationHistory[0]?.conversationId || 'unknown',
            totalMessages: conversationHistory.length,
            analysisTimestamp: Date.now(),
            
            // Flow Analysis
            contextContinuity: this._analyzeContextContinuity(conversationHistory),
            progressiveEscalation: this._analyzeProgressiveEscalation(feedbackHistory),
            goalProgression: this._analyzeGoalProgression(feedbackHistory),
            
            // Pattern Detection
            repetitivePatterns: this._detectRepetitivePatterns(conversationHistory),
            escalationPatterns: this._analyzeEscalationPatterns(feedbackHistory),
            denialHandling: this._analyzeDenialHandling(conversationHistory, feedbackHistory),
            
            // Multi-User Analysis
            conflictResolution: this._analyzeConflictResolution(conversationHistory),
            mediationEffectiveness: this._analyzeMediationEffectiveness(conversationHistory),
            consentManagement: this._analyzeConsentManagement(conversationHistory),
            crossConversationMessaging: this._analyzeCrossConversationMessaging(conversationHistory),
            
            // Overall Metrics
            engagementQuality: this._assessEngagementQuality(conversationHistory, feedbackHistory),
            trustBuilding: this._assessTrustBuilding(conversationHistory),
            informationGathering: this._assessInformationGathering(conversationHistory),
            
            // Recommendations
            recommendations: []
        };

        // Generate recommendations based on analysis
        analysis.recommendations = this._generateConversationRecommendations(analysis);
        
        return analysis;
    }

    /**
     * Analyze context continuity across messages
     */
    _analyzeContextContinuity(conversationHistory) {
        const continuityIssues = [];
        let contextScore = 0;
        
        for (let i = 1; i < conversationHistory.length; i++) {
            const prevMessage = conversationHistory[i - 1];
            const currentMessage = conversationHistory[i];
            
            // Check if agent references previous context
            const referencesPrevious = this._checkContextReference(prevMessage, currentMessage);
            
            if (!referencesPrevious) {
                continuityIssues.push({
                    turn: i,
                    issue: 'Context not maintained',
                    previousContext: prevMessage.userMessage?.substring(0, 50) + '...',
                    currentResponse: currentMessage.agentResponse?.substring(0, 50) + '...'
                });
                contextScore -= 1;
            } else {
                contextScore += 1;
            }
        }
        
        const maxPossible = Math.max(conversationHistory.length - 1, 1);
        return {
            score: contextScore,
            maxPossible: maxPossible,
            continuityRate: maxPossible > 0 ? contextScore / maxPossible : 0,
            issues: continuityIssues
        };
    }

    /**
     * Analyze progressive escalation handling
     */
    _analyzeProgressiveEscalation(feedbackHistory) {
        const escalationPatterns = [];
        let escalationScore = 0;
        
        for (let i = 1; i < feedbackHistory.length; i++) {
            const prevFeedback = feedbackHistory[i - 1];
            const currentFeedback = feedbackHistory[i];
            
            // Check if escalation handling improves over time
            const prevUrgency = prevFeedback.urgencyAssessment?.level || 'low';
            const currentUrgency = currentFeedback.urgencyAssessment?.level || 'low';
            
            if (currentUrgency === URGENCY_LEVELS.CRITICAL && prevUrgency !== URGENCY_LEVELS.CRITICAL) {
                // New critical situation - check if handled appropriately
                if (currentFeedback.escalationScore > 0) {
                    escalationScore += 2;
                } else {
                    escalationScore -= 2;
                    escalationPatterns.push({
                        turn: i,
                        issue: 'Critical escalation not handled appropriately',
                        urgencyLevel: currentUrgency,
                        escalationScore: currentFeedback.escalationScore
                    });
                }
            }
        }
        
        return {
            score: escalationScore,
            patterns: escalationPatterns,
            effectiveness: escalationScore / Math.max(feedbackHistory.length, 1)
        };
    }

    /**
     * Analyze goal progression across conversation
     */
    _analyzeGoalProgression(feedbackHistory) {
        const goalProgress = {
            adherence: { trend: 'stable', progress: 0 },
            history: { trend: 'stable', progress: 0 },
            conversation: { trend: 'stable', progress: 0 }
        };
        
        // Calculate trends for each goal
        Object.keys(goalProgress).forEach(goal => {
            const scores = feedbackHistory.map(f => f[`goal_${goal}_score`] || 0);
            const trend = this._calculateTrend(scores);
            const progress = scores[scores.length - 1] - scores[0];
            
            goalProgress[goal] = { trend, progress, scores };
        });
        
        return goalProgress;
    }

    /**
     * Detect repetitive response patterns
     */
    _detectRepetitivePatterns(conversationHistory) {
        const repetitivePatterns = [];
        const responsePhrases = new Map();
        
        conversationHistory.forEach((message, index) => {
            if (message.agentResponse) {
                const phrases = this._extractKeyPhrases(message.agentResponse);
                phrases.forEach(phrase => {
                    if (responsePhrases.has(phrase)) {
                        responsePhrases.get(phrase).push(index);
                    } else {
                        responsePhrases.set(phrase, [index]);
                    }
                });
            }
        });
        
        // Find phrases used multiple times
        responsePhrases.forEach((indices, phrase) => {
            if (indices.length > 1) {
                repetitivePatterns.push({
                    phrase: phrase,
                    occurrences: indices.length,
                    turns: indices,
                    severity: indices.length > 2 ? 'high' : 'medium'
                });
            }
        });
        
        return {
            patterns: repetitivePatterns,
            severity: repetitivePatterns.length > 2 ? 'high' : repetitivePatterns.length > 0 ? 'medium' : 'low'
        };
    }

    /**
     * Analyze escalation patterns across conversation
     */
    _analyzeEscalationPatterns(feedbackHistory) {
        // Safety check: ensure feedbackHistory is an array
        if (!Array.isArray(feedbackHistory) || feedbackHistory.length === 0) {
            return {
                totalEscalations: 0,
                successfulEscalations: 0,
                escalationRate: 0,
                effectiveness: 0,
                patterns: []
            };
        }
        
        const escalationEvents = feedbackHistory.filter(f => 
            (f.urgencyAssessment?.level === URGENCY_LEVELS.CRITICAL) || 
            (f.escalationScore && f.escalationScore > 0)
        );
        
        const successfulEscalations = escalationEvents.filter(e => e.escalationScore > 0).length;
        const totalEscalations = escalationEvents.length;
        
        return {
            totalEscalations: totalEscalations,
            successfulEscalations: successfulEscalations,
            escalationRate: feedbackHistory.length > 0 ? escalationEvents.length / feedbackHistory.length : 0,
            effectiveness: totalEscalations > 0 ? successfulEscalations / totalEscalations : 0,
            patterns: escalationEvents.map(e => ({
                turn: e.turn || 0,
                urgencyLevel: e.urgencyAssessment?.level,
                escalationScore: e.escalationScore,
                handled: e.escalationScore > 0
            }))
        };
    }

    /**
     * Analyze denial handling patterns
     */
    _analyzeDenialHandling(conversationHistory, feedbackHistory) {
        const denialEvents = [];
        
        conversationHistory.forEach((message, index) => {
            const userMessage = message.userMessage?.toLowerCase() || '';
            const feedback = feedbackHistory[index];
            
            // Check for denial patterns
            const hasDenial = DENIAL_PATTERNS.some(pattern => 
                userMessage.includes(pattern.toLowerCase())
            );
            
            if (hasDenial && feedback?.denialScore < 0) {
                denialEvents.push({
                    turn: index,
                    denialPhrase: this._extractDenialPhrase(userMessage),
                    denialScore: feedback.denialScore,
                    agentResponse: message.agentResponse?.substring(0, 100) + '...'
                });
            }
        });
        
        return {
            totalDenials: denialEvents.length,
            handledDenials: denialEvents.filter(d => d.denialScore > -2).length,
            denialHandlingRate: denialEvents.length > 0 ? 
                denialEvents.filter(d => d.denialScore > -2).length / denialEvents.length : 1,
            events: denialEvents
        };
    }

    /**
     * Analyze conflict resolution in multi-user conversations
     */
    _analyzeConflictResolution(conversationHistory) {
        const conflicts = [];
        const users = new Set(conversationHistory.map(m => m.userRole));
        
        if (users.size < 2) {
            return { applicable: false, conflicts: [] };
        }
        
        // Look for conflicting information
        const userMessages = {};
        conversationHistory.forEach((message, index) => {
            const role = message.userRole;
            if (!userMessages[role]) userMessages[role] = [];
            userMessages[role].push({
                turn: index,
                message: message.userMessage,
                agentResponse: message.agentResponse
            });
        });
        
        // Analyze how agent handles conflicting reports
        Object.keys(userMessages).forEach(role => {
            const messages = userMessages[role];
            messages.forEach(msg => {
                // Check if agent acknowledges conflicts
                if (msg.agentResponse && this._mentionsConflictResolution(msg.agentResponse)) {
                    conflicts.push({
                        turn: msg.turn,
                        role: role,
                        conflictAcknowledged: true,
                        resolutionAttempted: true
                    });
                }
            });
        });
        
        return {
            applicable: true,
            totalConflicts: conflicts.length,
            resolvedConflicts: conflicts.filter(c => c.resolutionAttempted).length,
            conflicts: conflicts
        };
    }

    /**
     * Analyze mediation effectiveness
     */
    _analyzeMediationEffectiveness(conversationHistory) {
        const mediationEvents = [];
        
        conversationHistory.forEach((message, index) => {
            if (message.agentResponse && this._isMediationAttempt(message.agentResponse)) {
                mediationEvents.push({
                    turn: index,
                    mediationType: this._identifyMediationType(message.agentResponse),
                    effectiveness: this._assessMediationEffectiveness(message.agentResponse)
                });
            }
        });
        
        return {
            totalMediations: mediationEvents.length,
            effectiveMediations: mediationEvents.filter(m => m.effectiveness > 0).length,
            mediationRate: mediationEvents.length / conversationHistory.length,
            events: mediationEvents
        };
    }

    /**
     * Analyze consent management across conversation
     */
    _analyzeConsentManagement(conversationHistory) {
        const consentEvents = [];
        
        conversationHistory.forEach((message, index) => {
            if (message.agentResponse && this._mentionsConsent(message.agentResponse)) {
                consentEvents.push({
                    turn: index,
                    consentType: this._identifyConsentType(message.agentResponse),
                    appropriate: this._isConsentAppropriate(message.agentResponse, message.userMessage)
                });
            }
        });
        
        return {
            totalConsentEvents: consentEvents.length,
            appropriateConsent: consentEvents.filter(c => c.appropriate).length,
            consentRate: conversationHistory.length > 0 ? consentEvents.length / conversationHistory.length : 0,
            events: consentEvents
        };
    }

    /**
     * Analyze cross-conversation messaging: broadcasts, notifications, and suppressed messages
     */
    _analyzeCrossConversationMessaging(conversationHistory) {
        const crossConvEvents = [];
        let totalBroadcasts = 0;
        let totalNotifications = 0;
        let effectiveNotifications = 0;
        let suppressedMessages = 0;
        const suppressionReasons = {
            no_consent: 0,
            user_filtering: 0,
            irrelevant: 0,
            duplicate: 0,
            other: 0
        };

        conversationHistory.forEach((message, index) => {
            const agentResponse = message.agentResponse || (message.role === 'agent' || message.role === 'assistant' ? message.content : '') || '';
            const orchestratorAction = message.orchestratorAction || message.action;
            
            // Detect broadcasts (CAREGIVER: 🚨, PATIENT:, etc.)
            if (agentResponse.includes('📱 CAREGIVER:') || 
                agentResponse.includes('📱 PATIENT:') ||
                agentResponse.includes('📢 [Simulation] BROADCAST:')) {
                totalBroadcasts++;
                crossConvEvents.push({
                    turn: index,
                    type: 'broadcast',
                    content: agentResponse.substring(0, 100) + '...',
                    effective: true
                });
            }
            
            // Detect notifications (escalation notifications)
            if (agentResponse.includes('🚨') && 
                (agentResponse.includes('Patient') || agentResponse.includes('escalation'))) {
                totalNotifications++;
                // Check if notification was effective (led to response or action)
                const isEffective = index < conversationHistory.length - 1 && 
                                   conversationHistory[index + 1]?.userMessage?.length > 0;
                if (isEffective) effectiveNotifications++;
                
                crossConvEvents.push({
                    turn: index,
                    type: 'notification',
                    content: agentResponse.substring(0, 100) + '...',
                    effective: isEffective
                });
            }
            
            // Detect suppressed messages (from orchestrator actions)
            if (orchestratorAction) {
                if (orchestratorAction.type === 'SUPPRESS_SHARE' || 
                    orchestratorAction.type === 'SUPPRESS_BROADCAST' ||
                    orchestratorAction.suppressed === true) {
                    suppressedMessages++;
                    const reason = orchestratorAction.reason || orchestratorAction.reason_for_suppression || 'unknown';
                    
                    if (reason.toLowerCase().includes('consent')) {
                        suppressionReasons.no_consent++;
                    } else if (reason.toLowerCase().includes('filter') || reason.toLowerCase().includes('spam')) {
                        suppressionReasons.user_filtering++;
                    } else if (reason.toLowerCase().includes('irrelevant') || reason.toLowerCase().includes('not relevant')) {
                        suppressionReasons.irrelevant++;
                    } else if (reason.toLowerCase().includes('duplicate') || reason.toLowerCase().includes('already')) {
                        suppressionReasons.duplicate++;
                    } else {
                        suppressionReasons.other++;
                    }
                    
                    crossConvEvents.push({
                        turn: index,
                        type: 'suppressed',
                        reason: reason,
                        content: message.userMessage?.substring(0, 100) + '...' || 'N/A'
                    });
                }
            }
        });

        return {
            totalBroadcasts,
            totalNotifications,
            effectiveNotifications,
            suppressedMessages,
            suppressionReasons,
            events: crossConvEvents,
            effectivenessRate: totalNotifications > 0 ? effectiveNotifications / totalNotifications : 0,
            suppressionRate: conversationHistory.length > 0 ? suppressedMessages / conversationHistory.length : 0
        };
    }

    /**
     * Assess overall engagement quality
     */
    _assessEngagementQuality(conversationHistory, feedbackHistory) {
        const engagementFactors = {
            responseRelevance: 0,
            empathyConsistency: 0,
            questionQuality: 0,
            followUpEffectiveness: 0
        };
        
        conversationHistory.forEach((message, index) => {
            const feedback = feedbackHistory[index];
            
            // Response relevance
            if (feedback?.score > 0) engagementFactors.responseRelevance += 1;
            
            // Empathy consistency
            if (feedback?.empathyScore > 0) engagementFactors.empathyConsistency += 1;
            
            // Question quality (agent asks relevant questions)
            if (this._hasQualityQuestions(message.agentResponse)) {
                engagementFactors.questionQuality += 1;
            }
            
            // Follow-up effectiveness
            if (index > 0 && this._isEffectiveFollowUp(message, conversationHistory[index - 1])) {
                engagementFactors.followUpEffectiveness += 1;
            }
        });
        
        const totalMessages = Math.max(conversationHistory.length, 1);
        return {
            overallScore: Object.values(engagementFactors).reduce((sum, val) => sum + val, 0) / (totalMessages * 4),
            factors: Object.fromEntries(
                Object.entries(engagementFactors).map(([key, value]) => [key, value / totalMessages])
            )
        };
    }

    /**
     * Assess trust building over conversation
     */
    _assessTrustBuilding(conversationHistory) {
        const trustIndicators = {
            consistency: 0,
            transparency: 0,
            respectfulness: 0,
            reliability: 0
        };
        
        conversationHistory.forEach((message, index) => {
            const response = message.agentResponse?.toLowerCase() || '';
            
            // Consistency (similar tone and approach)
            if (index > 0) {
                const prevResponse = conversationHistory[index - 1].agentResponse?.toLowerCase() || '';
                if (this._hasConsistentTone(response, prevResponse)) {
                    trustIndicators.consistency += 1;
                }
            }
            
            // Transparency (honest about limitations)
            if (response.includes('i cannot') || response.includes('i\'m not sure') || response.includes('consult your doctor')) {
                trustIndicators.transparency += 1;
            }
            
            // Respectfulness (acknowledges user concerns)
            if (response.includes('i understand') || response.includes('i hear you') || response.includes('that makes sense')) {
                trustIndicators.respectfulness += 1;
            }
            
            // Reliability (follows through on suggestions)
            if (index > 0 && this._followsThroughOnSuggestions(message, conversationHistory[index - 1])) {
                trustIndicators.reliability += 1;
            }
        });
        
        const totalMessages = conversationHistory.length;
        return {
            overallScore: Object.values(trustIndicators).reduce((sum, val) => sum + val, 0) / (totalMessages * 4),
            indicators: Object.fromEntries(
                Object.entries(trustIndicators).map(([key, value]) => [key, value / totalMessages])
            )
        };
    }

    /**
     * Assess information gathering effectiveness
     */
    _assessInformationGathering(conversationHistory) {
        const gatheringMetrics = {
            questionsAsked: 0,
            relevantQuestions: 0,
            informationCollected: 0,
            followUpQuestions: 0
        };
        
        conversationHistory.forEach((message, index) => {
            const response = message.agentResponse || '';
            
            // Count questions asked
            const questions = (response.match(/\?/g) || []).length;
            gatheringMetrics.questionsAsked += questions;
            
            // Count relevant questions
            if (this._hasRelevantQuestions(response, message.userMessage)) {
                gatheringMetrics.relevantQuestions += questions;
            }
            
            // Information collected (user provides new information)
            if (message.userMessage && this._containsNewInformation(message.userMessage, conversationHistory.slice(0, index))) {
                gatheringMetrics.informationCollected += 1;
            }
            
            // Follow-up questions
            if (index > 0 && this._isFollowUpQuestion(response, conversationHistory[index - 1])) {
                gatheringMetrics.followUpQuestions += 1;
            }
        });
        
        return {
            questionRate: gatheringMetrics.questionsAsked / conversationHistory.length,
            relevanceRate: gatheringMetrics.questionsAsked > 0 ? 
                gatheringMetrics.relevantQuestions / gatheringMetrics.questionsAsked : 0,
            informationRate: gatheringMetrics.informationCollected / conversationHistory.length,
            followUpRate: gatheringMetrics.followUpQuestions / Math.max(conversationHistory.length - 1, 1)
        };
    }

    /**
     * Generate conversation-level recommendations
     */
    _generateConversationRecommendations(analysis) {
        const recommendations = [];
        
        // Context continuity issues
        if (analysis.contextContinuity.continuityRate < 0.7) {
            recommendations.push({
                category: 'context_continuity',
                priority: 'high',
                issue: 'Poor context maintenance across messages',
                suggestion: 'Implement context tracking and reference previous messages more consistently',
                impact: 'Improves conversation flow and user experience'
            });
        }
        
        // Repetitive patterns
        if (analysis.repetitivePatterns.severity === 'high') {
            recommendations.push({
                category: 'repetitive_responses',
                priority: 'high',
                issue: 'High frequency of repetitive responses',
                suggestion: 'Diversify response patterns and implement response variation',
                impact: 'Reduces user frustration and improves engagement'
            });
        }
        
        // Escalation handling
        if (analysis.escalationPatterns.effectiveness < 0.5) {
            recommendations.push({
                category: 'escalation_handling',
                priority: 'high',
                issue: 'Poor escalation handling for critical situations',
                suggestion: 'Improve urgency detection and escalation protocols',
                impact: 'Critical for patient safety and care quality'
            });
        }
        
        // Denial handling
        if (analysis.denialHandling.denialHandlingRate < 0.6) {
            recommendations.push({
                category: 'denial_handling',
                priority: 'medium',
                issue: 'Ineffective handling of patient denial patterns',
                suggestion: 'Develop better strategies for addressing patient concerns and building trust',
                impact: 'Improves patient engagement and care adherence'
            });
        }
        
        // Engagement quality
        if (analysis.engagementQuality.overallScore < 0.6) {
            recommendations.push({
                category: 'engagement_quality',
                priority: 'medium',
                issue: 'Low overall engagement quality',
                suggestion: 'Improve response relevance, empathy, and question quality',
                impact: 'Enhances user satisfaction and conversation effectiveness'
            });
        }
        
        return recommendations;
    }

    /**
     * Create empty analysis for error cases
     */
    _createEmptyAnalysis() {
        return {
            conversationId: 'unknown',
            totalMessages: 0,
            analysisTimestamp: Date.now(),
            contextContinuity: { score: 0, maxPossible: 0, continuityRate: 0, issues: [] },
            progressiveEscalation: { score: 0, patterns: [], effectiveness: 0 },
            goalProgression: { adherence: { trend: 'stable', progress: 0 }, history: { trend: 'stable', progress: 0 }, conversation: { trend: 'stable', progress: 0 } },
            repetitivePatterns: { patterns: [], severity: 'low' },
            escalationPatterns: { totalEscalations: 0, successfulEscalations: 0, escalationRate: 0, patterns: [] },
            denialHandling: { totalDenials: 0, handledDenials: 0, denialHandlingRate: 1, events: [] },
            conflictResolution: { applicable: false, conflicts: [] },
            mediationEffectiveness: { totalMediations: 0, effectiveMediations: 0, mediationRate: 0, events: [] },
            consentManagement: { totalConsentEvents: 0, appropriateConsent: 0, consentRate: 0, events: [] },
            engagementQuality: { overallScore: 0, factors: {} },
            trustBuilding: { overallScore: 0, indicators: {} },
            informationGathering: { questionRate: 0, relevanceRate: 0, informationRate: 0, followUpRate: 0 },
            recommendations: []
        };
    }

    /**
     * Normalize conversation history to consistent format
     * Handles both formats: {role, content} and {userMessage, agentResponse}
     */
    _normalizeConversationHistory(history) {
        return history.map((msg, index) => {
            // If already in normalized format, return as-is
            if (msg.userMessage || msg.agentResponse) {
                return msg;
            }
            
            // Convert from role/content format to userMessage/agentResponse format
            const normalized = { ...msg };
            if (msg.role === 'user') {
                normalized.userMessage = msg.content || msg.message || '';
                normalized.userRole = msg.userRole || 'patient';
            } else if (msg.role === 'agent' || msg.role === 'assistant') {
                normalized.agentResponse = msg.content || msg.message || '';
            }
            
            return normalized;
        });
    }

    /**
     * Normalize conversation history to consistent format
     * Handles both role/content format and userMessage/agentResponse format
     */
    _normalizeConversationHistory(conversationHistory) {
        return conversationHistory.map((msg, index) => {
            // If already in normalized format (has userMessage/agentResponse), return as-is
            if (msg.userMessage || msg.agentResponse) {
                return msg;
            }
            
            // Convert from role/content format to normalized format
            const normalized = { ...msg };
            
            if (msg.role === 'user') {
                normalized.userMessage = msg.content || '';
                normalized.agentResponse = null;
            } else if (msg.role === 'agent' || msg.role === 'assistant') {
                // Find previous user message to pair with this agent response
                let prevUserIndex = index - 1;
                while (prevUserIndex >= 0 && conversationHistory[prevUserIndex].role !== 'user') {
                    prevUserIndex--;
                }
                
                normalized.agentResponse = msg.content || '';
                normalized.userMessage = conversationHistory[prevUserIndex]?.content || '';
            }
            
            return normalized;
        }).filter(msg => msg.userMessage || msg.agentResponse); // Only keep messages with content
    }

    // Helper methods
    _checkContextReference(prevMessage, currentMessage) {
        // Handle both formats
        const prevContext = (prevMessage.userMessage || prevMessage.content || '').toLowerCase();
        const currentResponse = (currentMessage.agentResponse || currentMessage.content || '').toLowerCase();
        
        if (!prevContext || !currentResponse) {
            return false; // Can't check context if data is missing
        }
        
        // Check if current response references previous context
        return prevContext.split(' ').some(word => 
            word.length > 3 && currentResponse.includes(word)
        );
    }

    _calculateTrend(scores) {
        if (scores.length < 2) return 'stable';
        
        const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
        const secondHalf = scores.slice(Math.floor(scores.length / 2));
        
        const firstAvg = firstHalf.reduce((sum, s) => sum + s, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((sum, s) => sum + s, 0) / secondHalf.length;
        
        if (secondAvg > firstAvg + 0.1) return 'improving';
        if (secondAvg < firstAvg - 0.1) return 'declining';
        return 'stable';
    }

    _extractKeyPhrases(text) {
        // Extract key phrases from agent responses
        const phrases = text.toLowerCase()
            .split(/[.!?]+/)
            .map(phrase => phrase.trim())
            .filter(phrase => phrase.length > 10 && phrase.length < 100)
            .slice(0, 3); // Limit to first 3 phrases
        
        return phrases;
    }

    _extractDenialPhrase(text) {
        const denialPhrase = DENIAL_PATTERNS.find(pattern => 
            text.includes(pattern.toLowerCase())
        );
        return denialPhrase || 'unknown denial pattern';
    }

    _mentionsConflictResolution(text) {
        const conflictKeywords = ['conflict', 'disagree', 'different', 'conflicting', 'resolve', 'clarify'];
        return conflictKeywords.some(keyword => text.toLowerCase().includes(keyword));
    }

    _isMediationAttempt(text) {
        const mediationKeywords = ['let me help', 'work together', 'find a solution', 'mediate', 'resolve'];
        return mediationKeywords.some(keyword => text.toLowerCase().includes(keyword));
    }

    _identifyMediationType(text) {
        if (text.toLowerCase().includes('work together')) return 'collaborative';
        if (text.toLowerCase().includes('find a solution')) return 'problem_solving';
        if (text.toLowerCase().includes('let me help')) return 'supportive';
        return 'general';
    }

    _assessMediationEffectiveness(text) {
        // Simple heuristic - could be enhanced with more sophisticated analysis
        const effectivenessIndicators = ['solution', 'plan', 'next step', 'action', 'help'];
        const indicatorCount = effectivenessIndicators.filter(indicator => 
            text.toLowerCase().includes(indicator)
        ).length;
        
        return indicatorCount > 2 ? 1 : indicatorCount > 0 ? 0.5 : -1;
    }

    _mentionsConsent(text) {
        const consentKeywords = ['consent', 'permission', 'agree', 'allow', 'share'];
        return consentKeywords.some(keyword => text.toLowerCase().includes(keyword));
    }

    _identifyConsentType(text) {
        if (text.toLowerCase().includes('share')) return 'information_sharing';
        if (text.toLowerCase().includes('permission')) return 'action_permission';
        if (text.toLowerCase().includes('agree')) return 'agreement';
        return 'general';
    }

    _isConsentAppropriate(response, userMessage) {
        // Check if consent request is appropriate for the context
        const userMessageLower = userMessage?.toLowerCase() || '';
        const responseLower = response?.toLowerCase() || '';
        
        // If user mentions sharing information, consent request is appropriate
        if (userMessageLower.includes('share') && responseLower.includes('consent')) {
            return true;
        }
        
        // If user mentions other people, consent request is appropriate
        if (userMessageLower.includes('my') && responseLower.includes('permission')) {
            return true;
        }
        
        return false;
    }

    _hasQualityQuestions(text) {
        const qualityQuestionIndicators = ['can you tell me', 'what', 'how', 'when', 'where', 'why'];
        return qualityQuestionIndicators.some(indicator => 
            text.toLowerCase().includes(indicator)
        );
    }

    _isEffectiveFollowUp(currentMessage, previousMessage) {
        const currentResponse = currentMessage.agentResponse?.toLowerCase() || '';
        const prevUserMessage = previousMessage.userMessage?.toLowerCase() || '';
        
        // Check if current response addresses previous user message
        return prevUserMessage.split(' ').some(word => 
            word.length > 3 && currentResponse.includes(word)
        );
    }

    _hasConsistentTone(currentResponse, prevResponse) {
        // Simple tone consistency check
        const currentTone = this._extractTone(currentResponse);
        const prevTone = this._extractTone(prevResponse);
        
        return currentTone === prevTone;
    }

    _extractTone(text) {
        if (text.includes('!')) return 'excited';
        if (text.includes('?')) return 'questioning';
        if (text.includes('understand') || text.includes('hear')) return 'empathetic';
        return 'neutral';
    }

    _followsThroughOnSuggestions(currentMessage, previousMessage) {
        const prevResponse = previousMessage.agentResponse?.toLowerCase() || '';
        const currentResponse = currentMessage.agentResponse?.toLowerCase() || '';
        
        // Check if current response follows up on previous suggestions
        const suggestions = ['try', 'consider', 'suggest', 'recommend'];
        const hasPreviousSuggestion = suggestions.some(suggestion => 
            prevResponse.includes(suggestion)
        );
        
        if (hasPreviousSuggestion) {
            const followUpIndicators = ['how did', 'did you', 'was it helpful', 'any improvement'];
            return followUpIndicators.some(indicator => 
                currentResponse.includes(indicator)
            );
        }
        
        return false;
    }

    _hasRelevantQuestions(response, userMessage) {
        const userMessageLower = userMessage?.toLowerCase() || '';
        const responseLower = response?.toLowerCase() || '';
        
        // Check if questions in response are relevant to user's message
        const userTopics = userMessageLower.split(' ').filter(word => word.length > 3);
        const responseQuestions = responseLower.split('?');
        
        return responseQuestions.some(question => 
            userTopics.some(topic => question.includes(topic))
        );
    }

    _containsNewInformation(message, previousMessages) {
        const messageWords = message.toLowerCase().split(' ');
        const previousText = previousMessages.map(m => m.userMessage?.toLowerCase() || '').join(' ');
        
        // Check if message contains new information not mentioned before
        const newWords = messageWords.filter(word => 
            word.length > 3 && !previousText.includes(word)
        );
        
        return newWords.length > 2;
    }

    _isFollowUpQuestion(response, previousMessage) {
        const responseLower = response?.toLowerCase() || '';
        const prevResponse = previousMessage.agentResponse?.toLowerCase() || '';
        
        // Check if current response asks follow-up questions based on previous response
        const followUpIndicators = ['more about', 'tell me more', 'can you elaborate', 'what else'];
        return followUpIndicators.some(indicator => 
            responseLower.includes(indicator) && prevResponse.includes('?')
        );
    }
}
