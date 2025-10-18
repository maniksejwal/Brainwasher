/**
 * @fileoverview training/simulation/simulation_feedback.js
 * Automatic feedback generation from simulations.
 * Simulations can detect issues and automatically score/report them.
 */

import { getDb } from '../../db/connection.js';
import { URGENCY_LEVELS, SYMPTOM_URGENCY, TIME_CONTEXTS, ESCALATION_TYPES, MEDICAL_SYMPTOMS, PATIENT_CONCERNS, EMPATHY_LOOP_PHRASES, DENIAL_PATTERNS, GENERIC_RESPONSES } from '../../constants.js';

class SimulationFeedback {
    constructor(simulationId = 'sim_default', dbConnection = null) {
        this.simulationId = simulationId;
        this.dbConnection = dbConnection; // Use provided DB or fall back to main DB
    }

    /**
     * Automatically score an interaction with prompt tracking
     */
    async autoScore(conversationId, userId, circleId, messageId, score, reason, promptVersion = 'simulation_v1.0', goalAssessment = null) {
        const db = this.dbConnection || await getDb();
        
        await db.run(`
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT,
                message_id INTEGER,
                user_id TEXT,
                circle_id TEXT,
                score INTEGER,
                comment TEXT,
                timestamp INTEGER,
                source TEXT DEFAULT 'user',
                prompt_version TEXT,
                goal_adherence_score REAL,
                goal_history_score REAL,
                goal_conversation_score REAL,
                critical_failure BOOLEAN DEFAULT 0
            )
        `);

        const criticalFailure = score <= -2;
        const goalAdherence = goalAssessment?.adherence || null;
        const goalHistory = goalAssessment?.history || null;
        const goalConversation = goalAssessment?.conversation || null;

        await db.run(
            `INSERT INTO feedback (conversation_id, message_id, user_id, circle_id, score, comment, timestamp, source, prompt_version, goal_adherence_score, goal_history_score, goal_conversation_score, critical_failure)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'simulation', ?, ?, ?, ?, ?)`,
            [conversationId, messageId, userId, circleId, score, reason, Date.now(), promptVersion, goalAdherence, goalHistory, goalConversation, criticalFailure]
        );

        console.log(`[SimulationFeedback] Auto-scored: ${score} - "${reason}"${criticalFailure ? ' 🚨 CRITICAL FAILURE' : ''}`);
        
        // Flag simulation for pause if critical failure
        if (criticalFailure) {
            await this.flagSimulation(conversationId, 'critical_failure', reason);
        }
    }

    /**
     * Automatically report an issue
     */
    async autoReport(conversationId, userId, circleId, messageId, category, description, context) {
        const db = this.dbConnection || await getDb();
        
        await db.run(`
            CREATE TABLE IF NOT EXISTS detailed_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT,
                message_id INTEGER,
                user_id TEXT,
                circle_id TEXT,
                category TEXT,
                description TEXT,
                context TEXT,
                timestamp INTEGER,
                resolved BOOLEAN DEFAULT 0,
                source TEXT DEFAULT 'user'
            )
        `);

        await db.run(
            `INSERT INTO detailed_feedback 
             (conversation_id, message_id, user_id, circle_id, category, description, context, timestamp, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'simulation')`,
            [conversationId, messageId, userId, circleId, category, description, context, Date.now()]
        );

        console.log(`[SimulationFeedback] Auto-reported [${category}]: "${description}"`);
    }

    /**
     * Flag simulation for pause or analysis
     */
    async flagSimulation(conversationId, flagType, reason) {
        const db = this.dbConnection || await getDb();
        
        await db.run(`
            CREATE TABLE IF NOT EXISTS simulation_flags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT,
                flag_type TEXT,
                reason TEXT,
                timestamp INTEGER,
                resolved BOOLEAN DEFAULT 0,
                resolution_notes TEXT
            )
        `);

        await db.run(
            `INSERT INTO simulation_flags (conversation_id, flag_type, reason, timestamp)
             VALUES (?, ?, ?, ?)`,
            [conversationId, flagType, reason, Date.now()]
        );

        console.log(`🚨 SIMULATION FLAGGED: ${flagType} - ${reason}`);
    }

    /**
     * Assess care circle goals progress
     */
    assessCareCircleGoals(userMessage, agentResponse, conversationHistory = []) {
        const goals = {
            adherence: this._assessAdherenceGoal(userMessage, agentResponse),
            history: this._assessHistoryGoal(userMessage, agentResponse, conversationHistory),
            conversation: this._assessConversationGoal(userMessage, agentResponse)
        };
        
        return goals;
    }

    _assessAdherenceGoal(userMessage, agentResponse) {
        const message = userMessage.toLowerCase();
        const response = agentResponse.toLowerCase();
        
        // Check if patient mentions medication issues
        const mentionsMedication = message.includes('medication') || message.includes('pills') || message.includes('medicine');
        const mentionsAdherence = message.includes('forgot') || message.includes('missed') || message.includes('skip');
        
        if (mentionsMedication && mentionsAdherence) {
            // Check if AI addresses adherence specifically
            const addressesAdherence = response.includes('adherence') || response.includes('schedule') || response.includes('reminder');
            return addressesAdherence ? 1.0 : 0.3;
        }
        
        return 0.5; // Neutral if no adherence context
    }

    _assessHistoryGoal(userMessage, agentResponse, conversationHistory) {
        const response = agentResponse.toLowerCase();
        
        // Check if AI asks for specific historical information
        const asksHistory = response.includes('when did') || response.includes('how long') || response.includes('since when') || response.includes('tell me about');
        const asksSpecifics = response.includes('describe') || response.includes('explain') || response.includes('what happened');
        
        if (asksHistory || asksSpecifics) {
            return 1.0;
        }
        
        return 0.5; // Neutral if no history gathering
    }

    _assessConversationGoal(userMessage, agentResponse) {
        const response = agentResponse.toLowerCase();
        
        // Check conversation quality indicators
        const asksQuestions = response.includes('?');
        const showsEmpathy = response.includes('understand') || response.includes('sorry') || response.includes('concerned');
        const providesGuidance = response.includes('suggest') || response.includes('recommend') || response.includes('help');
        
        let score = 0.5; // Base score
        
        if (asksQuestions) score += 0.2;
        if (showsEmpathy) score += 0.2;
        if (providesGuidance) score += 0.1;
        
        return Math.min(1.0, score);
    }

    /**
     * Analyze agent response for issues
     */
    analyzeResponse(userMessage, agentResponse, orchestratorAction) {
        const issues = [];
        const scores = [];

        // Get urgency assessment FIRST
        const urgencyAssessment = this._assessUrgency(userMessage, agentResponse);

        // Check for template variable issues
        if (agentResponse.includes('{{') || agentResponse.includes('}}')) {
            issues.push({
                category: 'bug',
                description: `Template variables not replaced: ${this._extractTemplateVars(agentResponse)}`,
                severity: 'high'
            });
            scores.push({ score: -1, reason: 'Template variables not replaced' });
        }

        // Check for excessive verbosity
        const responseWords = agentResponse.split(/\s+/).length;
        const messageWords = userMessage.split(/\s+/).length;
        if (responseWords > messageWords * 4) {
            issues.push({
                category: 'verbosity',
                description: `Response is ${responseWords} words vs user's ${messageWords} words (${(responseWords/messageWords).toFixed(1)}x ratio)`,
                severity: 'medium'
            });
            scores.push({ score: 0, reason: 'Too verbose' });
        }

        // Check for very short responses
        if (responseWords < 3 && messageWords > 5) {
            issues.push({
                category: 'brevity',
                description: `Response too brief: only ${responseWords} words for ${messageWords} word message`,
                severity: 'medium'
            });
            scores.push({ score: -1, reason: 'Response too brief' });
        }

        // Check for repetitive empathy loops - HIGH PENALTY
        if (agentResponse.toLowerCase().includes('i understand') && 
            agentResponse.toLowerCase().includes('how') && 
            agentResponse.toLowerCase().includes('feel')) {
            issues.push({
                category: 'empathy_loop',
                description: 'Repetitive empathy pattern detected - "I understand how you feel"',
                severity: 'critical'
            });
            scores.push({ score: -3, reason: 'Empathy loop - high penalty' });
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

        // Check for missing escalation based on urgency context
        if (urgencyAssessment.level === URGENCY_LEVELS.CRITICAL && orchestratorAction.type !== 'ESCALATE') {
            issues.push({
                category: 'escalation',
                description: `${urgencyAssessment.symptom} (${urgencyAssessment.context}) - ${urgencyAssessment.reason}`,
                severity: 'critical'
            });
            scores.push({ score: -1, reason: 'Missed critical escalation' });
        } else if (urgencyAssessment.level === URGENCY_LEVELS.HIGH && orchestratorAction.type !== 'ESCALATE') {
            issues.push({
                category: 'escalation',
                description: `${urgencyAssessment.symptom} (${urgencyAssessment.context}) - Consider escalation`,
                severity: 'medium'
            });
            scores.push({ score: 0, reason: 'Consider escalation' });
        }

        // Positive scoring for good responses
        if (issues.length === 0 && responseWords >= 5 && responseWords <= messageWords * 3) {
            scores.push({ score: 1, reason: 'Well-balanced response' });
        }

        return { issues, scores };
    }

    _extractTemplateVars(text) {
        const matches = text.match(/\{\{[^}]+\}\}/g);
        return matches ? matches.join(', ') : '';
    }

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
        
        // Chest pain urgency based on timing
        if (messageLower.includes('chest pain') || messageLower.includes('chest discomfort')) {
            if (messageLower.includes('severe') || messageLower.includes('crushing') || messageLower.includes('intense')) {
                return { level: SYMPTOM_URGENCY.CHEST_PAIN.SEVERE, symptom: 'Severe chest pain', context: TIME_CONTEXTS.IMMEDIATE, reason: 'Could indicate heart attack' };
            } else if (messageLower.includes('recent') || messageLower.includes('just started') || messageLower.includes('today')) {
                return { level: SYMPTOM_URGENCY.CHEST_PAIN.RECENT, symptom: 'Recent chest pain', context: TIME_CONTEXTS.ACUTE, reason: 'New onset requires evaluation' };
            } else if (messageLower.includes('weeks') || messageLower.includes('months') || messageLower.includes('chronic')) {
                return { level: SYMPTOM_URGENCY.CHEST_PAIN.CHRONIC, symptom: 'Chronic chest pain', context: TIME_CONTEXTS.CHRONIC, reason: 'Chronic condition, routine follow-up' };
            }
        }
        
        // Dizziness urgency based on context
        if (messageLower.includes('dizzy') || messageLower.includes('dizziness')) {
            if (messageLower.includes('severe') || messageLower.includes('can\'t stand') || messageLower.includes('falling')) {
                return { level: SYMPTOM_URGENCY.DIZZINESS.SEVERE, symptom: 'Severe dizziness', context: TIME_CONTEXTS.IMMEDIATE, reason: 'Fall risk, needs evaluation' };
            } else if (messageLower.includes('medication') || messageLower.includes('side effect')) {
                return { level: SYMPTOM_URGENCY.DIZZINESS.MEDICATION_RELATED, symptom: 'Medication-related dizziness', context: TIME_CONTEXTS.RECENT, reason: 'Review medication timing' };
            } else {
                return { level: SYMPTOM_URGENCY.DIZZINESS.MILD, symptom: 'Mild dizziness', context: TIME_CONTEXTS.RECENT, reason: 'Monitor and follow up' };
            }
        }
        
        // Bleeding - always critical
        if (messageLower.includes('bleeding') || messageLower.includes('blood')) {
            return { level: SYMPTOM_URGENCY.BLEEDING, symptom: 'Bleeding', context: TIME_CONTEXTS.IMMEDIATE, reason: 'Requires immediate attention' };
        }
        
        // Breathing issues - always critical
        if (messageLower.includes('can\'t breathe') || messageLower.includes('shortness of breath') || messageLower.includes('difficulty breathing')) {
            return { level: SYMPTOM_URGENCY.BREATHING_DIFFICULTY, symptom: 'Breathing difficulty', context: TIME_CONTEXTS.IMMEDIATE, reason: 'Respiratory emergency' };
        }
        
        // Unconscious - always critical
        if (messageLower.includes('unconscious') || messageLower.includes('passed out') || messageLower.includes('fainted')) {
            return { level: SYMPTOM_URGENCY.UNCONSCIOUS, symptom: 'Loss of consciousness', context: TIME_CONTEXTS.IMMEDIATE, reason: 'Medical emergency' };
        }
        
        // Meningitis symptoms - timing dependent
        if (messageLower.includes('stiff neck') || messageLower.includes('fever') || messageLower.includes('headache')) {
            if (messageLower.includes('severe') || messageLower.includes('sudden')) {
                return { level: SYMPTOM_URGENCY.MENINGITIS_SYMPTOMS.SEVERE, symptom: 'Meningitis symptoms', context: TIME_CONTEXTS.IMMEDIATE, reason: 'Could be meningitis - urgent' };
            } else {
                return { level: SYMPTOM_URGENCY.MENINGITIS_SYMPTOMS.MILD, symptom: 'Possible meningitis symptoms', context: TIME_CONTEXTS.ACUTE, reason: 'Rule out meningitis' };
            }
        }
        
        return { level: URGENCY_LEVELS.LOW, symptom: 'General concern', context: TIME_CONTEXTS.RECENT, reason: 'Routine follow-up appropriate' };
    }

    _generateActionableFeedback(issues, userMessage, agentResponse) {
        if (issues.length === 0) {
            return ["✅ Response looks good - no issues detected"];
        }
        
        const feedback = [];
        const userWords = userMessage.toLowerCase();
        const agentWords = agentResponse.toLowerCase();
        
        issues.forEach(issue => {
            switch (issue.category) {
                case 'escalation':
                    const symptom = this._extractSymptom(userMessage);
                    feedback.push(`🚨 ESCALATION: Patient mentioned "${symptom}" - ask specific follow-up questions about timing, severity, and associated symptoms, then consider escalating to doctor`);
                    break;
                    
                case 'verbosity':
                    const ratio = Math.round((agentResponse.split(/\s+/).length / userMessage.split(/\s+/).length) * 10) / 10;
                    feedback.push(`📝 VERBOSITY: Response is ${ratio}x longer than user message - focus on 1-2 key points that directly address "${this._extractMainConcern(userMessage)}"`);
                    break;
                    
                case 'brevity':
                    const concern = this._extractMainConcern(userMessage);
                    feedback.push(`💬 BREVITY: User asked about "${concern}" but got generic response - provide specific guidance like "Let's create a medication schedule" or "I'll help you track symptoms"`);
                    break;
                    
                case 'empathy_loop':
                    const repeatedPhrase = this._detectRepeatedPhrase(agentResponse);
                    feedback.push(`🔄 EMPATHY LOOP: Stop saying "${repeatedPhrase}" - instead offer specific help like "Let me help you organize your medications" or "I'll connect you with your care team"`);
                    break;
                    
                case 'denial_acceptance':
                    feedback.push(`🚨 CRITICAL FAILURE: Patient is denying help despite critical symptoms - DO NOT accept denial! Ask specific questions: "When did the dizziness start?" "Is the chest pain getting worse?" "Can you describe exactly what you're feeling?" Then escalate to doctor immediately`);
                    break;
                    
                case 'generic_critical':
                    feedback.push(`🚨 CRITICAL FAILURE: Generic response to medical emergency - Ask specific questions: "How long have you had these symptoms?" "Are they getting worse?" "Any other symptoms?" Then escalate to doctor immediately`);
                    break;
                    
                case 'bug':
                    const templateVars = this._extractTemplateVars(agentResponse);
                    feedback.push(`🐛 BUG: Template variables not replaced: ${templateVars} - check prompt processing and variable substitution`);
                    break;
                    
                default:
                    feedback.push(`⚠️ ${issue.category.toUpperCase()}: ${issue.description}`);
            }
        });
        
        return feedback;
    }
    
    _extractSymptom(message) {
        for (const symptom of MEDICAL_SYMPTOMS) {
            if (message.toLowerCase().includes(symptom)) {
                return symptom;
            }
        }
        return 'symptoms';
    }
    
    _extractMainConcern(message) {
        for (const concern of PATIENT_CONCERNS) {
            if (message.toLowerCase().includes(concern)) {
                return concern;
            }
        }
        return 'their concern';
    }
    
    _detectRepeatedPhrase(response) {
        for (const phrase of EMPATHY_LOOP_PHRASES) {
            if (response.toLowerCase().includes(phrase)) {
                return phrase;
            }
        }
        return 'repetitive empathy phrases';
    }

    /**
     * Comprehensive feedback for an interaction
     */
    async provideFeedback(conversationId, userId, circleId, messageId, userMessage, agentResponse, orchestratorAction, context = null, promptVersion = 'simulation_v1.0', conversationHistory = []) {
        const analysis = this.analyzeResponse(userMessage, agentResponse, orchestratorAction);
        
        // Assess care circle goals
        const goalAssessment = this.assessCareCircleGoals(userMessage, agentResponse, conversationHistory);

        // Report all detected issues
        for (const issue of analysis.issues) {
            await this.autoReport(
                conversationId,
                userId,
                circleId,
                messageId,
                issue.category,
                issue.description,
                context || userMessage
            );
        }

        // Provide scores with goal assessment
        for (const scoreData of analysis.scores) {
            await this.autoScore(
                conversationId,
                userId,
                circleId,
                messageId,
                scoreData.score,
                scoreData.reason,
                promptVersion,
                goalAssessment
            );
        }

        // Generate actionable feedback
        const actionableFeedback = this._generateActionableFeedback(analysis.issues, userMessage, agentResponse);
        
        return {
            issuesFound: analysis.issues.length,
            scores: analysis.scores,
            issues: analysis.issues,
            actionableFeedback: actionableFeedback,
            goalAssessment: goalAssessment,
            criticalFailure: analysis.scores.some(s => s.score <= -2)
        };
    }
}

export { SimulationFeedback };

