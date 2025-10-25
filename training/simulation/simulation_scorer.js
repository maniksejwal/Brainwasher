/**
 * @fileoverview Simulation Scorer - Core scoring logic
 * Handles automatic scoring, urgency assessment, and goal evaluation
 */

import { URGENCY_LEVELS, TIME_CONTEXTS, SYMPTOM_URGENCY, DENIAL_PATTERNS, GENERIC_RESPONSES } from '../../constants.js';
import { smartUrgencyAssessor } from './smart_urgency_assessor.js';
import { ConversationQualityAssessor } from './llm_scorer.js';

export class SimulationScorer {
    constructor(dbConnection = null, scenarioContext = null) {
        this.dbConnection = dbConnection;
        this.scenarioContext = scenarioContext; // Store scenario-specific evaluation criteria
        this.conversationAssessor = new ConversationQualityAssessor(scenarioContext);
    }

    /**
     * Main scoring function - analyzes user message and agent response
     */
    async analyzeResponse(userMessage, agentResponse, orchestratorAction = null) {
        const scores = [];
        const issues = [];

        // 1. Smart urgency assessment using LLM
        const urgencyAssessment = await this._assessUrgency(userMessage, agentResponse);
        
        // Check for escalation issues based on urgency
        if (urgencyAssessment.level === 'CRITICAL' || urgencyAssessment.level === 'HIGH') {
            if (!orchestratorAction || orchestratorAction.type === 'NONE') {
                issues.push({
                    category: 'escalation',
                    severity: 'high',
                    description: `${urgencyAssessment.symptom} (${urgencyAssessment.context}) - Consider escalation`,
                    suggestion: 'Escalate to appropriate medical personnel'
                });
                scores.push({ score: -2, reason: `Missing escalation for critical symptoms: ${urgencyAssessment.symptom}` });
            } else {
                scores.push({ score: 2, reason: `Proper escalation for ${urgencyAssessment.symptom}` });
            }
        } else if (urgencyAssessment.level === 'MEDIUM') {
            // Only show escalation suggestion for meaningful symptoms, not generic fallbacks
            if (urgencyAssessment.symptom && urgencyAssessment.symptom !== 'General concern' && urgencyAssessment.symptom !== 'Non-medical conversation') {
                scores.push({ score: -1, reason: `Consider escalation for: ${urgencyAssessment.symptom}` });
            }
        }

        // 2. Check for patient denial patterns
        const denialScore = this._checkDenialPatterns(userMessage, agentResponse);
        if (denialScore < 0) {
            scores.push({ score: denialScore, reason: 'Patient denial of critical symptoms detected' });
            issues.push({
                category: 'denial',
                severity: 'high',
                description: 'CRITICAL: Patient denying help despite critical symptoms - AI must escalate, not accept denial',
                suggestion: 'Escalate despite patient resistance'
            });
        }

        // 3. Check for generic responses to critical situations
        const genericScore = this._checkGenericResponses(userMessage, agentResponse, urgencyAssessment);
        if (genericScore < 0) {
            scores.push({ score: genericScore, reason: 'Generic response to critical medical situation' });
            issues.push({
                category: 'generic_response',
                severity: 'high',
                description: 'CRITICAL: Generic response to critical medical situation - must ask specific questions and escalate',
                suggestion: 'Ask specific questions about symptoms and escalate appropriately'
            });
        }

        // 4. Assess goal progress
        const goalScores = await this._assessGoalProgress(userMessage, agentResponse);
        scores.push(...goalScores);

        // 5. Scenario-specific evaluation (if available)
        if (this.scenarioContext && this.scenarioContext.agent) {
            const scenarioScore = this._evaluateScenarioSpecificCriteria(userMessage, agentResponse, orchestratorAction);
            if (scenarioScore !== null) {
                scores.push(scenarioScore);
            }
        }

        // 6. LLM-based conversation quality assessment
        try {
            const qualityScore = await this.conversationAssessor.scoreResponse(userMessage, agentResponse, 0, []);
            if (qualityScore.score !== 0) {
                scores.push({ score: qualityScore.score, reason: qualityScore.reason });
            }
        } catch (error) {
            console.warn(`[SimulationScorer] Conversation assessment failed: ${error.message}`);
        }

        // 7. Calculate overall score
        const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
        const averageScore = scores.length > 0 ? totalScore / scores.length : 0;

        return {
            totalScore: Math.round(averageScore),
            scores: scores, // Changed from individualScores to scores
            individualScores: scores,
            urgencyAssessment,
            issuesFound: issues.length > 0,
            issues,
            escalationNeeded: urgencyAssessment.escalationNeeded,
            recommendedAction: urgencyAssessment.recommendedAction
        };
    }

    /**
     * Smart LLM-based urgency assessment
     */
    async _assessUrgency(userMessage, agentResponse) {
        const assessment = await smartUrgencyAssessor.assessUrgency(userMessage, {
            hasAgentResponse: !!agentResponse,
            agentResponseLength: agentResponse?.length || 0
        });

        return {
            level: assessment.level,
            symptom: assessment.symptom,
            context: this._mapUrgencyToContext(assessment.level),
            reason: assessment.reason,
            escalationNeeded: assessment.escalationNeeded,
            recommendedAction: assessment.recommendedAction
        };
    }

    _mapUrgencyToContext(urgencyLevel) {
        const mapping = {
            'CRITICAL': TIME_CONTEXTS.IMMEDIATE,
            'HIGH': TIME_CONTEXTS.ACUTE,
            'MEDIUM': TIME_CONTEXTS.RECENT,
            'LOW': TIME_CONTEXTS.RECENT,
            'NONE': TIME_CONTEXTS.CHRONIC
        };
        return mapping[urgencyLevel] || TIME_CONTEXTS.RECENT;
    }

    /**
     * Check for patient denial patterns
     */
    _checkDenialPatterns(userMessage, agentResponse) {
        const messageLower = userMessage.toLowerCase();
        const responseLower = agentResponse.toLowerCase();

        // Check if user is denying critical symptoms
        const hasDenial = DENIAL_PATTERNS.some(pattern => 
            messageLower.includes(pattern.toLowerCase())
        );

        if (hasDenial) {
            // Check if agent accepts the denial without escalation
            const acceptsDenial = responseLower.includes('understand') || 
                                responseLower.includes('okay') || 
                                responseLower.includes('that\'s fine');
            
            if (acceptsDenial) {
                return -3; // Severe penalty for accepting denial
            }
        }

        return 0;
    }

    /**
     * Check for generic responses to critical situations
     */
    _checkGenericResponses(userMessage, agentResponse, urgencyAssessment) {
        if (urgencyAssessment.level === 'CRITICAL' || urgencyAssessment.level === 'HIGH') {
            const responseLower = agentResponse.toLowerCase();
            
            const isGeneric = GENERIC_RESPONSES.some(pattern => 
                responseLower.includes(pattern.toLowerCase())
            );

            if (isGeneric) {
                return -2; // Penalty for generic response to critical situation
            }
        }

        return 0;
    }

    /**
     * Assess goal progress
     */
    async _assessGoalProgress(userMessage, agentResponse) {
        const scores = [];

        // Adherence goal
        const adherenceScore = this._assessAdherenceGoal(userMessage, agentResponse);
        if (adherenceScore !== 0) {
            scores.push({ score: adherenceScore, reason: 'Adherence goal progress' });
        }

        // History collection goal
        const historyScore = this._assessHistoryGoal(userMessage, agentResponse);
        if (historyScore !== 0) {
            scores.push({ score: historyScore, reason: 'History collection goal progress' });
        }

        // Conversation quality goal
        const qualityResult = this._assessQualityGoal(userMessage, agentResponse);
        if (qualityResult.score !== 0) {
            scores.push({ score: qualityResult.score, reason: qualityResult.reason });
        }

        return scores;
    }

    /**
     * Assess adherence goal progress
     */
    _assessAdherenceGoal(userMessage, agentResponse) {
        const messageLower = userMessage.toLowerCase();
        const responseLower = agentResponse.toLowerCase();

        // Positive indicators
        if (messageLower.includes('taking') && messageLower.includes('medication')) {
            return 1;
        }

        if (responseLower.includes('medication') && responseLower.includes('schedule')) {
            return 1;
        }

        return 0;
    }

    /**
     * Assess history collection goal progress
     */
    _assessHistoryGoal(userMessage, agentResponse) {
        const responseLower = agentResponse.toLowerCase();

        // Check if agent asks for more information
        if (responseLower.includes('tell me more') || responseLower.includes('can you describe')) {
            return 1;
        }

        return 0;
    }

    /**
     * Assess conversation quality goal progress
     */
    _assessQualityGoal(userMessage, agentResponse) {
        const responseLower = agentResponse.toLowerCase();

        // Check for repetitive responses (penalty)
        if (this._isRepetitiveResponse(agentResponse)) {
            return { score: -2, reason: 'Repetitive/pestering response' };
        }

        // Check for empathetic language
        if (responseLower.includes('understand') || responseLower.includes('support')) {
            return { score: 0, reason: 'Shows empathy and support' };
        }

        // Check for specific questions
        if (responseLower.includes('?') && !responseLower.includes('yes') && !responseLower.includes('no')) {
            return { score: 1, reason: 'Asks specific questions' };
        }

        return { score: 0, reason: 'No specific quality indicators' };
    }

    /**
     * Check if response is repetitive (same phrases repeated)
     */
    _isRepetitiveResponse(agentResponse) {
        const responseLower = agentResponse.toLowerCase();
        
        // Common repetitive phrases (pestering behavior)
        const repetitivePhrases = [
            'you\'re welcome',
            'i\'m here to support you',
            'thank you for',
            'i appreciate',
            'i understand',
            'i\'m glad i could help',
            'i hear you', // Passive enabling phrases
            'it\'s important to',
            'that\'s a valid consideration',
            'if you ever want to explore',
            'i\'m here to help',
            'feel free to reach out',
            'let me know if you need',
            'i\'m here to support you through'
        ];

        // Check if response contains only repetitive phrases
        const hasRepetitivePhrase = repetitivePhrases.some(phrase => responseLower.includes(phrase));
        
        // If response is very short and contains repetitive phrases, it's likely repetitive
        if (hasRepetitivePhrase && agentResponse.length < 50) {
            return true;
        }

        // Check for exact repetition of common responses
        const commonResponses = [
            'you\'re welcome. i\'m here to support you.',
            'thank you for your help. i appreciate it.',
            'you\'re welcome. i\'m glad i could help.',
            'i hear you. it\'s important to',
            'i hear you. it\'s important to do what works best for you'
        ];

        return commonResponses.some(response => responseLower.includes(response.toLowerCase()));
    }

    /**
     * Check if conversation should end early due to repetitive patterns
     */
    _shouldEndConversationEarly(conversationHistory, currentTurn, maxTurns) {
        if (currentTurn < 3) return false; // Don't end too early
        
        const recentTurns = conversationHistory.slice(-6); // Last 3 exchanges
        if (recentTurns.length < 6) return false;
        
        // Check for repetitive user responses
        const userMessages = recentTurns.filter(turn => turn.role === 'user').map(turn => turn.content.toLowerCase());
        const agentMessages = recentTurns.filter(turn => turn.role === 'agent').map(turn => turn.content.toLowerCase());
        
        // Count repetitive user responses
        const repetitiveUserPhrases = ['thanks', 'thank you', 'i appreciate', 'you too', 'have a great day'];
        const repetitiveUserCount = userMessages.filter(msg => 
            repetitiveUserPhrases.some(phrase => msg.includes(phrase))
        ).length;
        
        // Count repetitive agent responses
        const repetitiveAgentPhrases = ['you\'re welcome', 'i\'m here to support', 'have a great day', 'take care'];
        const repetitiveAgentCount = agentMessages.filter(msg => 
            repetitiveAgentPhrases.some(phrase => msg.includes(phrase))
        ).length;
        
        // If both user and agent are being repetitive, end conversation
        if (repetitiveUserCount >= 2 && repetitiveAgentCount >= 2) {
            return true;
        }
        
        // If conversation has been going in circles for too long
        if (currentTurn >= maxTurns * 0.6 && repetitiveUserCount >= 3) {
            return true;
        }
        
        return false;
    }

    /**
     * Assess conversation goal progress (alias for quality goal)
     */
    _assessConversationGoal(userMessage, agentResponse) {
        return this._assessQualityGoal(userMessage, agentResponse);
    }

    /**
     * Evaluate agent response against scenario-specific criteria
     */
    _evaluateScenarioSpecificCriteria(userMessage, agentResponse, orchestratorAction) {
        if (!this.scenarioContext || !this.scenarioContext.agent) {
            return null;
        }

        const agentCriteria = this.scenarioContext.agent;
        let score = 0;
        let reason = '';

        // Parse evaluation criteria from scenario
        if (agentCriteria.includes('specific strategies') && agentCriteria.includes('vs generic')) {
            const hasSpecificStrategies = this._hasSpecificStrategies(agentResponse);
            const hasGenericAdvice = this._hasGenericAdvice(agentResponse);
            
            if (hasSpecificStrategies && !hasGenericAdvice) {
                score = 2;
                reason = 'Provided specific strategies instead of generic advice';
            } else if (hasGenericAdvice && !hasSpecificStrategies) {
                score = -1;
                reason = 'Provided generic advice instead of specific strategies';
            }
        }

        if (agentCriteria.includes('psychological aspects')) {
            const addressesPsychology = this._addressesPsychologicalAspects(agentResponse);
            if (addressesPsychology) {
                score += 1;
                reason += (reason ? '; ' : '') + 'Addressed psychological aspects';
            }
        }

        if (agentCriteria.includes('scientific facts') && agentCriteria.includes('misconception')) {
            const correctsMisconception = this._correctsMisconceptionWithFacts(userMessage, agentResponse);
            if (correctsMisconception) {
                score += 2;
                reason += (reason ? '; ' : '') + 'Corrected misconception with scientific facts';
            }
        }

        if (agentCriteria.includes('alternative solutions')) {
            const providesAlternatives = this._providesAlternativeSolutions(agentResponse);
            if (providesAlternatives) {
                score += 1;
                reason += (reason ? '; ' : '') + 'Provided alternative solutions';
            }
        }

        return score !== 0 ? { score, reason } : null;
    }

    _hasSpecificStrategies(response) {
        const specificIndicators = ['specific', 'detailed', 'step-by-step', 'timeline', 'schedule', 'technique', 'method'];
        return specificIndicators.some(indicator => response.toLowerCase().includes(indicator));
    }

    _hasGenericAdvice(response) {
        const genericIndicators = ['just', 'simply', 'basically', 'generally', 'usually', 'typically'];
        return genericIndicators.some(indicator => response.toLowerCase().includes(indicator));
    }

    _addressesPsychologicalAspects(response) {
        const psychologyIndicators = ['psychological', 'mental', 'emotional', 'stress', 'anxiety', 'motivation', 'support', 'counseling'];
        return psychologyIndicators.some(indicator => response.toLowerCase().includes(indicator));
    }

    _correctsMisconceptionWithFacts(userMessage, agentResponse) {
        const factIndicators = ['research shows', 'studies indicate', 'scientific evidence', 'medical fact', 'clinically proven'];
        const misconceptionKeywords = ['misconception', 'myth', 'incorrect', 'not true', 'actually'];
        
        const hasFacts = factIndicators.some(indicator => agentResponse.toLowerCase().includes(indicator));
        const correctsMisconception = misconceptionKeywords.some(keyword => agentResponse.toLowerCase().includes(keyword));
        
        return hasFacts && correctsMisconception;
    }

    _providesAlternativeSolutions(response) {
        const alternativeIndicators = ['alternative', 'instead', 'other options', 'you could try', 'consider', 'option'];
        return alternativeIndicators.some(indicator => response.toLowerCase().includes(indicator));
    }
}
