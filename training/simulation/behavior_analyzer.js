/**
 * @fileoverview Behavior Analyzer - Analyzes conversation behaviors and patterns
 */

import { SCORING_THRESHOLDS, SCORING_WEIGHTS, EMPATHY_KEYWORDS, CONVERSATIONAL_INDICATORS, CLINICAL_INDICATORS, ESCALATION_KEYWORDS, EMOTIONAL_KEYWORDS, FACTUAL_KEYWORDS } from './scoring_constants.js';
import { DENIAL_PATTERNS, GENERIC_RESPONSES } from '../../constants.js';

export class BehaviorAnalyzer {
    /**
     * Detect empathy loops in conversation
     */
    detectEmpathyLoop(agentResponse, conversationHistory = []) {
        const responseLower = agentResponse.toLowerCase();
        const empathyCount = EMPATHY_KEYWORDS.filter(keyword => responseLower.includes(keyword)).length;
        
        const recentResponses = conversationHistory.slice(-SCORING_THRESHOLDS.CONVERSATION_HISTORY_SLICE)
            .map(h => h.content?.toLowerCase() || '');
        
        const repeatedPhrases = recentResponses.filter(response => 
            response.includes('i understand') || response.includes('i hear you') || 
            response.includes('that sounds') || response.includes('i can see')
        ).length;
        
        return empathyCount >= SCORING_THRESHOLDS.EMPATHY_COUNT_THRESHOLD || 
               repeatedPhrases >= SCORING_THRESHOLDS.REPEATED_PHRASES_THRESHOLD;
    }

    /**
     * Check if response has escalation keywords
     */
    hasEscalation(response) {
        const responseLower = response.toLowerCase();
        return ESCALATION_KEYWORDS.some(keyword => responseLower.includes(keyword));
    }

    /**
     * Detect patient denial patterns
     */
    detectDenialPattern(userMessage, agentResponse) {
        const messageLower = userMessage.toLowerCase();
        const responseLower = agentResponse.toLowerCase();
        
        // Check if user is denying critical symptoms
        const hasDenial = DENIAL_PATTERNS.some(pattern => messageLower.includes(pattern));
        const acceptsDenial = responseLower.includes('okay') || responseLower.includes('understand') || 
                             responseLower.includes('that\'s fine') || responseLower.includes('no problem');
        
        return hasDenial && acceptsDenial;
    }

    /**
     * Detect generic responses to critical situations
     */
    detectGenericResponse(userMessage, agentResponse) {
        const messageLower = userMessage.toLowerCase();
        const responseLower = agentResponse.toLowerCase();
        
        // Check if user mentions critical symptoms
        const hasCriticalSymptoms = messageLower.includes('chest pain') || 
                                   messageLower.includes('bleeding') || 
                                   messageLower.includes('breathing') ||
                                   messageLower.includes('severe');
        
        // Check if response is generic
        const isGeneric = GENERIC_RESPONSES.some(pattern => responseLower.includes(pattern));
        
        return hasCriticalSymptoms && isGeneric;
    }

    /**
     * Assess verbosity based on user message type
     */
    assessVerbosity(userMessage, agentResponse) {
        const verbosityRatio = agentResponse.length / userMessage.length;
        const isEmotionalUser = this.isEmotionalMessage(userMessage);
        const isFactualUser = this.isFactualMessage(userMessage);
        
        const maxVerbosityRatio = isEmotionalUser ? 
            SCORING_THRESHOLDS.MAX_VERBOSITY_RATIO_EMOTIONAL : 
            SCORING_THRESHOLDS.MAX_VERBOSITY_RATIO_FACTUAL;
            
        const minVerbosityRatio = isFactualUser ? 
            SCORING_THRESHOLDS.MIN_VERBOSITY_RATIO_FACTUAL : 
            SCORING_THRESHOLDS.MIN_VERBOSITY_RATIO_EMOTIONAL;
        
        if (verbosityRatio > maxVerbosityRatio) {
            return {
                issue: 'too_verbose',
                ratio: verbosityRatio,
                threshold: maxVerbosityRatio,
                score: SCORING_WEIGHTS.VERBOSITY_ISSUE
            };
        } else if (verbosityRatio < minVerbosityRatio) {
            return {
                issue: 'too_brief',
                ratio: verbosityRatio,
                threshold: minVerbosityRatio,
                score: SCORING_WEIGHTS.BRIEFNESS_ISSUE
            };
        }
        
        return null;
    }

    /**
     * Analyze good behaviors in agent response
     */
    analyzeGoodBehaviors(userMessage, agentResponse) {
        const behaviors = [];
        
        // 1. Reward concise responses (1-2 sentences)
        const sentences = agentResponse.split(/[.!?]+/).filter(s => s.trim().length > 0);
        if (sentences.length <= SCORING_THRESHOLDS.MAX_SENTENCES_CONCISE && 
            sentences.length >= SCORING_THRESHOLDS.MIN_SENTENCES_CONCISE) {
            behaviors.push({ 
                score: SCORING_WEIGHTS.CONCISE_RESPONSE, 
                reason: 'Concise response (1-2 sentences)' 
            });
        }
        
        // 2. Reward specific questions (not yes/no)
        const questions = agentResponse.match(/\?/g) || [];
        if (questions.length > 0) {
            const hasSpecificQuestion = this.hasSpecificQuestion(agentResponse);
            if (hasSpecificQuestion) {
                behaviors.push({ 
                    score: SCORING_WEIGHTS.SPECIFIC_QUESTION, 
                    reason: 'Asks specific, open-ended question' 
                });
            }
        }
        
        // 3. Reward conversational language (not clinical)
        const isConversational = this.isConversationalLanguage(agentResponse);
        if (isConversational) {
            behaviors.push({ 
                score: SCORING_WEIGHTS.CONVERSATIONAL_LANGUAGE, 
                reason: 'Uses conversational, non-clinical language' 
            });
        }
        
        // 4. Reward empathy and acknowledgment
        const hasEmpathy = this.hasEmpathy(agentResponse);
        if (hasEmpathy) {
            behaviors.push({ 
                score: SCORING_WEIGHTS.EMPATHY_SHOWN, 
                reason: 'Shows empathy and acknowledges feelings' 
            });
        }
        
        // 5. Reward when patient provides detailed information
        const hasDetailedInfo = this.hasDetailedInformation(userMessage);
        if (hasDetailedInfo) {
            behaviors.push({ 
                score: SCORING_WEIGHTS.DETAILED_INFO_PROVIDED, 
                reason: 'Patient provided detailed information' 
            });
        }
        
        return behaviors;
    }

    /**
     * Check if message is emotional
     */
    isEmotionalMessage(message) {
        const messageLower = message.toLowerCase();
        return EMOTIONAL_KEYWORDS.some(keyword => messageLower.includes(keyword));
    }

    /**
     * Check if message is factual
     */
    isFactualMessage(message) {
        const messageLower = message.toLowerCase();
        return FACTUAL_KEYWORDS.some(keyword => messageLower.includes(keyword));
    }

    /**
     * Check if response has specific questions
     */
    hasSpecificQuestion(response) {
        const specificQuestionPatterns = [
            'what', 'how', 'when', 'where', 'why', 'tell me about', 'describe',
            'explain', 'share', 'walk me through'
        ];
        const responseLower = response.toLowerCase();
        return specificQuestionPatterns.some(pattern => responseLower.includes(pattern));
    }

    /**
     * Check if response uses conversational language
     */
    isConversationalLanguage(response) {
        const responseLower = response.toLowerCase();
        return CONVERSATIONAL_INDICATORS.some(indicator => responseLower.includes(indicator));
    }

    /**
     * Check if response shows empathy
     */
    hasEmpathy(response) {
        const responseLower = response.toLowerCase();
        return EMPATHY_KEYWORDS.some(keyword => responseLower.includes(keyword));
    }

    /**
     * Check if message contains detailed information
     */
    hasDetailedInformation(message) {
        const detailedIndicators = [
            'because', 'since', 'when', 'where', 'how often', 'for how long',
            'specifically', 'exactly', 'details', 'more about'
        ];
        const messageLower = message.toLowerCase();
        return detailedIndicators.some(indicator => messageLower.includes(indicator));
    }

    /**
     * Detect bugs or inappropriate responses
     */
    detectBug(response) {
        const bugIndicators = [
            '{{', '}}', '[ERROR]', '[BUG]', 'undefined', 'null', 'NaN',
            'function', 'return', 'console.log', 'debugger'
        ];
        const responseLower = response.toLowerCase();
        return bugIndicators.some(indicator => responseLower.includes(indicator));
    }
}
