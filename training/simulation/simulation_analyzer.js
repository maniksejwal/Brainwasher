/**
 * @fileoverview Simulation Analyzer - Pattern analysis and detection
 * Handles detection of conversation patterns, symptoms, and concerns
 */

import { EMPATHY_LOOP_PHRASES, DENIAL_PATTERNS, GENERIC_RESPONSES } from '../../constants.js';

export class SimulationAnalyzer {
    constructor() {
        // No dependencies needed for pattern analysis
    }

    /**
     * Extract main symptom from user message
     */
    extractSymptom(userMessage) {
        const messageLower = userMessage.toLowerCase();
        
        const symptoms = [
            'chest pain', 'chest discomfort', 'dizziness', 'headache', 
            'nausea', 'fatigue', 'tired', 'shortness of breath', 'breathing difficulty',
            'bleeding', 'blood', 'pain', 'fever', 'vomiting', 'diarrhea', 'constipation',
            'rash', 'swelling', 'numbness', 'tingling', 'weakness', 'confusion',
            'unconscious', 'fainted', 'passed out', 'stiff neck'
        ];
        
        for (const symptom of symptoms) {
            if (messageLower.includes(symptom)) {
                return symptom;
            }
        }
        
        return null;
    }

    /**
     * Extract main concern from user message
     */
    extractMainConcern(userMessage) {
        const messageLower = userMessage.toLowerCase();
        
        const concerns = [
            'medication', 'medicine', 'pills', 'pain', 'symptoms', 'appointment', 
            'doctor', 'help', 'worried', 'concerned', 'scared', 'anxious', 'stressed',
            'schedule', 'reminder', 'tracking', 'monitoring', 'side effects',
            'adherence', 'compliance', 'forgot', 'missed', 'skipped'
        ];
        
        for (const concern of concerns) {
            if (messageLower.includes(concern)) {
                return concern;
            }
        }
        
        return 'general concern';
    }

    /**
     * Detect repeated phrases in conversation history
     */
    detectRepeatedPhrase(agentResponse, conversationHistory = []) {
        const responseLower = agentResponse.toLowerCase();
        
        // Get recent agent responses
        const recentResponses = conversationHistory
            .filter(h => h.role === 'assistant')
            .slice(-3)
            .map(h => h.content?.toLowerCase() || '');
        
        // Check for repeated phrases
        const words = responseLower.split(' ');
        const repeatedPhrases = [];
        
        for (let i = 0; i < words.length - 2; i++) {
            const phrase = words.slice(i, i + 3).join(' ');
            if (recentResponses.some(response => response.includes(phrase))) {
                repeatedPhrases.push(phrase);
            }
        }
        
        return repeatedPhrases.length > 0 ? repeatedPhrases[0] : null;
    }

    /**
     * Detect empathy loops with detailed analysis
     */
    detectEmpathyLoop(agentResponse, conversationHistory = []) {
        const responseLower = agentResponse.toLowerCase();
        
        // Count empathy phrases in current response
        const empathyCount = EMPATHY_LOOP_PHRASES.filter(phrase => 
            responseLower.includes(phrase)
        ).length;
        
        // Check for repetition in recent history
        const recentResponses = conversationHistory.slice(-3).map(h => h.content?.toLowerCase() || '');
        const repeatedEmpathy = EMPATHY_LOOP_PHRASES.filter(phrase => 
            recentResponses.some(response => response.includes(phrase))
        ).length;
        
        // Check for lack of action-oriented language
        const actionWords = [
            'help', 'assist', 'support', 'schedule', 'contact', 'call',
            'escalate', 'refer', 'recommend', 'suggest', 'next step',
            'follow up', 'check', 'monitor', 'track'
        ];
        
        const hasAction = actionWords.some(word => responseLower.includes(word));
        
        return {
            isLoop: empathyCount >= 2 || repeatedEmpathy >= 2,
            empathyCount: empathyCount,
            repeatedEmpathy: repeatedEmpathy,
            hasAction: hasAction,
            severity: empathyCount >= 3 ? 'high' : empathyCount >= 2 ? 'medium' : 'low'
        };
    }

    /**
     * Detect denial patterns in user message
     */
    detectDenialPatterns(userMessage) {
        const messageLower = userMessage.toLowerCase();
        
        const denialCount = DENIAL_PATTERNS.filter(pattern => 
            messageLower.includes(pattern)
        ).length;
        
        return {
            hasDenial: denialCount > 0,
            denialCount: denialCount,
            patterns: DENIAL_PATTERNS.filter(pattern => messageLower.includes(pattern)),
            severity: denialCount >= 2 ? 'high' : denialCount >= 1 ? 'medium' : 'low'
        };
    }

    /**
     * Detect generic responses
     */
    detectGenericResponse(agentResponse) {
        const responseLower = agentResponse.toLowerCase();
        
        const genericCount = GENERIC_RESPONSES.filter(response => 
            responseLower.includes(response)
        ).length;
        
        // Check for generic response patterns
        const genericPatterns = [
            'that\'s great to hear',
            'i\'m here for you',
            'let me know if you need anything',
            'feel free to reach out',
            'i understand your concern',
            'that sounds concerning',
            'i\'m sorry to hear that'
        ];
        
        const patternCount = genericPatterns.filter(pattern => 
            responseLower.includes(pattern)
        ).length;
        
        return {
            isGeneric: genericCount > 0 || patternCount >= 2,
            genericCount: genericCount,
            patternCount: patternCount,
            severity: (genericCount + patternCount) >= 3 ? 'high' : (genericCount + patternCount) >= 2 ? 'medium' : 'low'
        };
    }

    /**
     * Analyze conversation flow and progression
     */
    analyzeConversationFlow(conversationHistory = []) {
        if (conversationHistory.length < 2) {
            return { progression: 'insufficient_data', quality: 'unknown' };
        }
        
        const userMessages = conversationHistory
            .filter(h => h.role === 'user')
            .map(h => h.content?.toLowerCase() || '');
        
        const agentResponses = conversationHistory
            .filter(h => h.role === 'assistant')
            .map(h => h.content?.toLowerCase() || '');
        
        // Check for topic progression
        const topics = userMessages.map(msg => this.extractMainConcern(msg));
        const uniqueTopics = new Set(topics);
        
        // Check for escalation progression
        const escalationKeywords = ['urgent', 'emergency', 'immediate', 'call', 'doctor'];
        const escalationProgression = agentResponses.map(response => 
            escalationKeywords.some(keyword => response.includes(keyword))
        );
        
        // Check for information gathering progression
        const infoGatheringKeywords = ['tell me more', 'describe', 'explain', 'when', 'how', 'what'];
        const infoProgression = agentResponses.map(response => 
            infoGatheringKeywords.some(keyword => response.includes(keyword))
        );
        
        return {
            progression: uniqueTopics.size > 1 ? 'good' : 'stagnant',
            topicDiversity: uniqueTopics.size,
            escalationProgression: escalationProgression.filter(Boolean).length,
            infoGatheringProgression: infoProgression.filter(Boolean).length,
            quality: this._assessConversationQuality(conversationHistory)
        };
    }

    /**
     * Assess overall conversation quality
     */
    _assessConversationQuality(conversationHistory) {
        if (conversationHistory.length < 2) return 'insufficient_data';
        
        const agentResponses = conversationHistory
            .filter(h => h.role === 'assistant')
            .map(h => h.content?.toLowerCase() || '');
        
        // Quality indicators
        const qualityPositives = [
            'specific', 'clear', 'helpful', 'actionable', 'supportive',
            'understand', 'care', 'concern', 'appropriate'
        ];
        
        const qualityNegatives = [
            'generic', 'bland', 'unclear', 'confusing', 'inappropriate',
            'i don\'t know', 'not sure', 'maybe', 'possibly'
        ];
        
        let positiveScore = 0;
        let negativeScore = 0;
        
        agentResponses.forEach(response => {
            qualityPositives.forEach(positive => {
                if (response.includes(positive)) positiveScore++;
            });
            qualityNegatives.forEach(negative => {
                if (response.includes(negative)) negativeScore++;
            });
        });
        
        const netScore = positiveScore - negativeScore;
        
        if (netScore >= 3) return 'excellent';
        if (netScore >= 1) return 'good';
        if (netScore >= -1) return 'fair';
        return 'poor';
    }

    /**
     * Generate actionable feedback based on analysis
     */
    generateActionableFeedback(analysis, urgencyAssessment) {
        const suggestions = [];
        
        // Escalation suggestions
        if (urgencyAssessment.level === 'critical' && !analysis.hasEscalation) {
            suggestions.push({
                category: 'escalation',
                priority: 'high',
                suggestion: `CRITICAL: Escalate immediately for ${urgencyAssessment.symptom}. Add emergency contact information and urgency language.`,
                specificAdvice: [
                    'Include "urgent" or "emergency" in response',
                    'Provide specific next steps (call doctor, go to ER)',
                    'Add emergency contact information',
                    'Use strong, directive language'
                ]
            });
        }
        
        // Empathy loop suggestions
        if (analysis.empathyLoop?.isLoop) {
            suggestions.push({
                category: 'empathy_loop',
                priority: 'high',
                suggestion: 'Break empathy loop by adding action-oriented responses. Mix caring language with specific next steps.',
                specificAdvice: [
                    'Add specific questions about symptoms',
                    'Include actionable recommendations',
                    'Vary empathy expressions',
                    'Focus on problem-solving rather than just caring'
                ]
            });
        }
        
        // Verbosity suggestions
        if (analysis.verbosityRatio > 4) {
            suggestions.push({
                category: 'verbosity',
                priority: 'medium',
                suggestion: 'Reduce response length. Aim for 1-2x user message length for better engagement.',
                specificAdvice: [
                    'Focus on 2-3 key points maximum',
                    'Use shorter, clearer sentences',
                    'Prioritize actionable information',
                    'Remove redundant phrases'
                ]
            });
        }
        
        // Generic response suggestions
        if (analysis.genericResponse?.isGeneric) {
            suggestions.push({
                category: 'generic_response',
                priority: 'medium',
                suggestion: 'Make response more specific and personalized. Reference specific symptoms or concerns mentioned.',
                specificAdvice: [
                    'Reference specific symptoms mentioned',
                    'Ask targeted follow-up questions',
                    'Provide context-specific advice',
                    'Personalize based on patient history'
                ]
            });
        }
        
        return suggestions;
    }
}
