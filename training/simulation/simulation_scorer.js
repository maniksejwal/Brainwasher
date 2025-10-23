/**
 * @fileoverview Simulation Scorer - Core scoring logic
 * Handles automatic scoring, urgency assessment, and goal evaluation
 */

import { URGENCY_LEVELS, TIME_CONTEXTS, SYMPTOM_URGENCY, DENIAL_PATTERNS, GENERIC_RESPONSES } from '../../constants.js';
import { smartUrgencyAssessor } from './smart_urgency_assessor.js';

export class SimulationScorer {
    constructor(dbConnection = null) {
        this.dbConnection = dbConnection;
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
            scores.push({ score: -1, reason: `Consider escalation for: ${urgencyAssessment.symptom}` });
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

        // 5. Calculate overall score
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
        const qualityScore = this._assessQualityGoal(userMessage, agentResponse);
        if (qualityScore !== 0) {
            scores.push({ score: qualityScore, reason: 'Conversation quality goal progress' });
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

        // Check for empathetic language
        if (responseLower.includes('understand') || responseLower.includes('support')) {
            return 1;
        }

        // Check for specific questions
        if (responseLower.includes('?') && !responseLower.includes('yes') && !responseLower.includes('no')) {
            return 1;
        }

        return 0;
    }

    /**
     * Assess conversation goal progress (alias for quality goal)
     */
    _assessConversationGoal(userMessage, agentResponse) {
        return this._assessQualityGoal(userMessage, agentResponse);
    }
}
