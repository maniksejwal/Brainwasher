/**
 * @fileoverview Simulation Scorer - Core scoring logic
 * Handles automatic scoring, urgency assessment, and goal evaluation
 */

import { URGENCY_LEVELS, TIME_CONTEXTS, SYMPTOM_URGENCY, DENIAL_PATTERNS, GENERIC_RESPONSES } from '../../constants.js';

export class SimulationScorer {
    constructor(dbConnection = null) {
        this.dbConnection = dbConnection;
    }

    /**
     * Main scoring function - analyzes response and returns score with reasoning
     */
    analyzeResponse(userMessage, agentResponse, conversationHistory = []) {
        const urgencyAssessment = this._assessUrgency(userMessage, agentResponse);
        const issues = [];
        const scores = [];

        // Check for escalation issues based on urgency
        if (urgencyAssessment.level === URGENCY_LEVELS.CRITICAL && !this._hasEscalation(agentResponse)) {
            issues.push({
                category: 'escalation',
                description: `${urgencyAssessment.symptom} (${urgencyAssessment.context}) - ${urgencyAssessment.reason}`,
                severity: 'critical'
            });
            scores.push({ score: -2, reason: `Missing escalation for critical symptoms: ${urgencyAssessment.symptom}` });
        } else if (urgencyAssessment.level === URGENCY_LEVELS.HIGH && !this._hasEscalation(agentResponse)) {
            issues.push({
                category: 'escalation',
                description: `${urgencyAssessment.symptom} (${urgencyAssessment.context}) - Consider escalation`,
                severity: 'medium'
            });
            scores.push({ score: -1, reason: `Consider escalation for: ${urgencyAssessment.symptom}` });
        }

        // Check for empathy loops
        if (this._detectEmpathyLoop(agentResponse, conversationHistory)) {
            issues.push({
                category: 'empathy_loop',
                description: 'Repetitive empathy without action - conversation stuck in caring loop',
                severity: 'high'
            });
            scores.push({ score: -3, reason: 'Empathy loop detected - no progress made' });
        }

        // Check for patient denial patterns - CRITICAL FAILURE
        const hasDenial = DENIAL_PATTERNS.some(pattern => userMessage.toLowerCase().includes(pattern));
        const hasCriticalSymptoms = urgencyAssessment.level === URGENCY_LEVELS.CRITICAL;
        
        if (hasDenial && hasCriticalSymptoms) {
            issues.push({
                category: 'denial_acceptance',
                description: 'CRITICAL: Patient denying help despite critical symptoms - AI must escalate, not accept denial',
                severity: 'critical'
            });
            scores.push({ score: -3, reason: 'CRITICAL: Accepted patient denial of critical symptoms' });
        }

        // Check for generic responses to critical situations
        const isGeneric = GENERIC_RESPONSES.some(response => agentResponse.toLowerCase().includes(response));
        if (isGeneric && hasCriticalSymptoms) {
            issues.push({
                category: 'generic_critical',
                description: 'CRITICAL: Generic response to critical medical situation - must ask specific questions and escalate',
                severity: 'critical'
            });
            scores.push({ score: -2, reason: 'Generic response to critical situation' });
        }

        // Check verbosity - improved logic
        const verbosityRatio = agentResponse.length / userMessage.length;
        const isEmotionalUser = this._isEmotionalMessage(userMessage);
        const isFactualUser = this._isFactualMessage(userMessage);
        
        // Different thresholds for different user types
        const maxVerbosityRatio = isEmotionalUser ? 6 : 4; // Emotional users can handle longer responses
        const minVerbosityRatio = isFactualUser ? 0.3 : 0.5; // Factual users need more concise responses
        
        if (verbosityRatio > maxVerbosityRatio) {
            issues.push({
                category: 'verbosity',
                description: `Response too verbose (${verbosityRatio.toFixed(1)}x user message length)`,
                severity: 'medium'
            });
            scores.push({ score: -1, reason: 'Response too verbose' });
        } else if (verbosityRatio < minVerbosityRatio) {
            issues.push({
                category: 'brevity',
                description: `Response too brief (${verbosityRatio.toFixed(1)}x user message length)`,
                severity: 'low'
            });
            scores.push({ score: -1, reason: 'Response too brief' });
        }

        // Check for bugs or inappropriate responses
        if (this._detectBug(agentResponse)) {
            issues.push({
                category: 'bug',
                description: 'Inappropriate or buggy response detected',
                severity: 'high'
            });
            scores.push({ score: -2, reason: 'Bug or inappropriate response' });
        }

        // Default positive score if no issues
        if (scores.length === 0) {
            scores.push({ score: 1, reason: 'Well-balanced response' });
        }

        // Calculate final score (use most negative score)
        const finalScore = Math.min(...scores.map(s => s.score));

        return {
            score: finalScore,
            issues: issues,
            scores: scores,
            urgencyAssessment: urgencyAssessment,
            verbosityRatio: verbosityRatio
        };
    }

    /**
     * Assess urgency based on symptoms and context
     */
    _assessUrgency(userMessage, agentResponse) {
        const messageLower = userMessage.toLowerCase();
        
        // CRITICAL: Check for dangerous symptom combinations FIRST
        const criticalCombinations = [
            { 
                symptoms: ['dizzy', 'chest'], 
                level: URGENCY_LEVELS.CRITICAL, 
                symptom: 'Dizziness + chest pain', 
                context: TIME_CONTEXTS.IMMEDIATE, 
                reason: 'CRITICAL: Cardiac symptoms with neurological signs - immediate evaluation needed' 
            },
            { 
                symptoms: ['dizzy', 'confusion', 'remember'], 
                level: URGENCY_LEVELS.CRITICAL, 
                symptom: 'Dizziness + confusion', 
                context: TIME_CONTEXTS.IMMEDIATE, 
                reason: 'CRITICAL: Neurological symptoms - possible stroke or cardiac event' 
            },
            { 
                symptoms: ['chest', 'pain', 'shortness'], 
                level: URGENCY_LEVELS.CRITICAL, 
                symptom: 'Chest pain + breathing difficulty', 
                context: TIME_CONTEXTS.IMMEDIATE, 
                reason: 'CRITICAL: Cardiac emergency - immediate medical attention required' 
            }
        ];
        
        for (const combo of criticalCombinations) {
            if (combo.symptoms.every(symptom => messageLower.includes(symptom))) {
                return combo;
            }
        }

        // Single symptom assessment
        if (messageLower.includes('chest') && messageLower.includes('pain')) {
            if (messageLower.includes('severe') || messageLower.includes('crushing') || messageLower.includes('pressure')) {
                return { level: SYMPTOM_URGENCY.CHEST_PAIN.SEVERE, symptom: 'Severe chest pain', context: TIME_CONTEXTS.IMMEDIATE, reason: 'Could indicate heart attack' };
            } else if (messageLower.includes('recent') || messageLower.includes('today') || messageLower.includes('this morning')) {
                return { level: SYMPTOM_URGENCY.CHEST_PAIN.RECENT, symptom: 'Recent chest pain', context: TIME_CONTEXTS.ACUTE, reason: 'New onset requires evaluation' };
            } else {
                return { level: SYMPTOM_URGENCY.CHEST_PAIN.CHRONIC, symptom: 'Chronic chest pain', context: TIME_CONTEXTS.CHRONIC, reason: 'Chronic condition, routine follow-up' };
            }
        }

        // Dizziness urgency based on context
        if (messageLower.includes('dizzy') || messageLower.includes('dizziness')) {
            if (messageLower.includes('severe') || messageLower.includes('can\'t stand') || messageLower.includes('falling')) {
                return { level: SYMPTOM_URGENCY.DIZZINESS.SEVERE, symptom: 'Severe dizziness', context: TIME_CONTEXTS.IMMEDIATE, reason: 'Fall risk, needs evaluation' };
            } else if (messageLower.includes('medication') || messageLower.includes('pill')) {
                return { level: SYMPTOM_URGENCY.DIZZINESS.MEDICATION_RELATED, symptom: 'Medication-related dizziness', context: TIME_CONTEXTS.RECENT, reason: 'Review medication timing' };
            } else {
                return { level: SYMPTOM_URGENCY.DIZZINESS.MILD, symptom: 'Mild dizziness', context: TIME_CONTEXTS.RECENT, reason: 'Monitor and follow up' };
            }
        }

        // Other critical symptoms
        if (messageLower.includes('bleeding') || messageLower.includes('blood')) {
            return { level: SYMPTOM_URGENCY.BLEEDING, symptom: 'Bleeding', context: TIME_CONTEXTS.IMMEDIATE, reason: 'Requires immediate attention' };
        }

        if (messageLower.includes('breathing') && (messageLower.includes('difficult') || messageLower.includes('shortness'))) {
            return { level: SYMPTOM_URGENCY.BREATHING_DIFFICULTY, symptom: 'Breathing difficulty', context: TIME_CONTEXTS.IMMEDIATE, reason: 'Respiratory emergency' };
        }

        if (messageLower.includes('unconscious') || messageLower.includes('passed out') || messageLower.includes('fainted')) {
            return { level: SYMPTOM_URGENCY.UNCONSCIOUS, symptom: 'Loss of consciousness', context: TIME_CONTEXTS.IMMEDIATE, reason: 'Medical emergency' };
        }

        // Meningitis symptoms
        if (messageLower.includes('stiff neck') && messageLower.includes('fever')) {
            if (messageLower.includes('severe') || messageLower.includes('bad')) {
                return { level: SYMPTOM_URGENCY.MENINGITIS_SYMPTOMS.SEVERE, symptom: 'Meningitis symptoms', context: TIME_CONTEXTS.IMMEDIATE, reason: 'Could be meningitis - urgent' };
            } else {
                return { level: SYMPTOM_URGENCY.MENINGITIS_SYMPTOMS.MILD, symptom: 'Possible meningitis symptoms', context: TIME_CONTEXTS.ACUTE, reason: 'Rule out meningitis' };
            }
        }

        return { level: URGENCY_LEVELS.LOW, symptom: 'General concern', context: TIME_CONTEXTS.RECENT, reason: 'Routine follow-up appropriate' };
    }

    /**
     * Assess adherence goal progress
     */
    _assessAdherenceGoal(userMessage, agentResponse) {
        const messageLower = userMessage.toLowerCase();
        const responseLower = agentResponse.toLowerCase();
        
        // Positive indicators
        const adherencePositives = [
            'medication', 'pill', 'dose', 'adherence', 'compliance',
            'reminder', 'track', 'schedule', 'routine', 'take regularly'
        ];
        
        const adherenceCount = adherencePositives.filter(term => 
            messageLower.includes(term) || responseLower.includes(term)
        ).length;
        
        if (adherenceCount >= 3) return 0.9;
        if (adherenceCount >= 2) return 0.7;
        if (adherenceCount >= 1) return 0.5;
        
        return 0.5; // Neutral if no adherence context
    }

    /**
     * Assess history collection goal progress
     */
    _assessHistoryGoal(userMessage, agentResponse, conversationHistory = []) {
        const responseLower = agentResponse.toLowerCase();
        
        // History collection indicators
        const historyIndicators = [
            'when did', 'how long', 'how often', 'tell me more',
            'describe', 'explain', 'details', 'background',
            'history', 'previous', 'before', 'last time'
        ];
        
        const historyCount = historyIndicators.filter(term => 
            responseLower.includes(term)
        ).length;
        
        // Bonus for building on previous context
        const contextBonus = conversationHistory.length > 0 ? 0.2 : 0;
        
        const baseScore = Math.min(0.9, historyCount * 0.3 + 0.3);
        return Math.min(1.0, baseScore + contextBonus);
    }

    /**
     * Assess conversation quality goal progress
     */
    _assessConversationGoal(userMessage, agentResponse) {
        const responseLower = agentResponse.toLowerCase();
        
        // Quality indicators
        const qualityPositives = [
            'understand', 'help', 'support', 'care', 'concern',
            'specific', 'clear', 'action', 'next step', 'follow up'
        ];
        
        const qualityNegatives = [
            'i don\'t know', 'not sure', 'maybe', 'possibly',
            'generic', 'bland', 'unclear'
        ];
        
        const positiveCount = qualityPositives.filter(term => 
            responseLower.includes(term)
        ).length;
        
        const negativeCount = qualityNegatives.filter(term => 
            responseLower.includes(term)
        ).length;
        
        const baseScore = (positiveCount * 0.2) - (negativeCount * 0.3) + 0.5;
        return Math.max(0.0, Math.min(1.0, baseScore));
    }

    /**
     * Check if response contains escalation language
     */
    _hasEscalation(response) {
        const escalationKeywords = [
            'urgent', 'emergency', 'immediate', 'call', 'contact',
            'escalate', 'doctor', 'healthcare', 'medical attention',
            'emergency room', 'ER', 'ambulance', '911'
        ];
        
        return escalationKeywords.some(keyword => 
            response.toLowerCase().includes(keyword)
        );
    }

    /**
     * Detect empathy loops in conversation
     */
    _detectEmpathyLoop(agentResponse, conversationHistory = []) {
        const responseLower = agentResponse.toLowerCase();
        
        // Check for repetitive empathy phrases
        const empathyPhrases = [
            'i understand how you feel',
            'i understand how',
            'i understand that',
            'i can understand',
            'i know how',
            'i know that',
            'i can see how',
            'i can imagine',
            'that must be',
            'i\'m sorry you\'re feeling'
        ];
        
        const empathyCount = empathyPhrases.filter(phrase => 
            responseLower.includes(phrase)
        ).length;
        
        // Check for repetition in recent history
        const recentResponses = conversationHistory.slice(-3).map(h => h.content?.toLowerCase() || '');
        const repeatedPhrases = empathyPhrases.filter(phrase => 
            recentResponses.some(response => response.includes(phrase))
        ).length;
        
        // High penalty for empathy loops
        return empathyCount >= 2 || repeatedPhrases >= 2;
    }

    /**
     * Detect if message is emotional/expressive
     */
    _isEmotionalMessage(message) {
        const emotionalKeywords = [
            'worried', 'scared', 'afraid', 'anxious', 'frustrated', 'upset', 'concerned',
            'terrified', 'panic', 'nervous', 'stressed', 'overwhelmed', 'helpless',
            'desperate', 'frightened', 'alarmed', 'distressed', 'agitated'
        ];
        
        const lowerMessage = message.toLowerCase();
        return emotionalKeywords.some(keyword => lowerMessage.includes(keyword));
    }

    /**
     * Detect if message is factual/clinical
     */
    _isFactualMessage(message) {
        const factualKeywords = [
            'symptoms', 'pain', 'fever', 'temperature', 'blood pressure', 'heart rate',
            'medication', 'dosage', 'side effects', 'appointment', 'test results',
            'diagnosis', 'treatment', 'procedure', 'examination', 'lab work',
            'routine', 'schedule', 'habit', 'lifestyle', 'daily', 'weekly',
            'medication', 'adherence', 'compliance', 'reminder', 'tracking',
            'sleep', 'diet', 'exercise', 'social', 'family', 'relationships',
            'stress', 'mood', 'energy', 'motivation', 'goals', 'progress'
        ];
        
        const lowerMessage = message.toLowerCase();
        return factualKeywords.some(keyword => lowerMessage.includes(keyword));
    }

    /**
     * Detect bugs or inappropriate responses
     */
    _detectBug(response) {
        const bugIndicators = [
            'undefined', 'null', 'error', 'exception',
            'i am an ai', 'i am a language model',
            'i cannot', 'i am not able to',
            'as an ai', 'i don\'t have the ability'
        ];
        
        return bugIndicators.some(indicator => 
            response.toLowerCase().includes(indicator)
        );
    }
}
