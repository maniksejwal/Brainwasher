/**
 * @fileoverview Smart LLM-based urgency assessment
 * Replaces old-school word search with intelligent analysis
 */

import { makeApiCall } from '../../agents/api_client.js';

const URGENCY_PROMPT = `
You are a medical urgency assessment AI. Analyze the following message for medical urgency and criticality.

**URGENCY LEVELS:**
- CRITICAL: Life-threatening emergencies requiring immediate medical attention
- HIGH: Serious medical concerns requiring prompt medical evaluation  
- MEDIUM: Moderate health concerns that should be addressed soon
- LOW: Minor symptoms or routine health updates
- NONE: Non-medical conversation or general health maintenance

**CRITICAL INDICATORS:**
- Chest pain with other symptoms (dizziness, shortness of breath, sweating)
- Severe bleeding or hemorrhage
- Signs of stroke (slurred speech, weakness, confusion)
- Severe breathing difficulty
- Loss of consciousness or severe confusion
- Severe allergic reactions
- Signs of heart attack or cardiac emergency
- Severe trauma or injury

**HIGH INDICATORS:**
- Chest pain (even if mild)
- Moderate bleeding
- Falls with injury (especially in elderly)
- Severe pain
- High fever with concerning symptoms
- Mental health crisis or suicidal thoughts
- Severe dehydration or inability to eat/drink

**MEDIUM INDICATORS:**
- Moderate pain or discomfort
- Minor bleeding
- Fever
- Moderate breathing issues
- Significant changes in condition
- Medication side effects
- Requests for doctor consultation

**LOW INDICATORS:**
- Minor aches and pains
- Routine symptoms
- General health updates
- Minor cuts or bruises
- Common cold symptoms

**CONTEXT MATTERS:**
- Consider the patient's age, medical history, and current condition
- "Blood pressure" is not bleeding
- "Blood sugar" is not bleeding  
- Routine medication mentions are not urgent
- General health discussions are not urgent

**User Message:** "{{MESSAGE}}"

**Patient Context:** {{PATIENT_CONTEXT}}

Return ONLY a JSON object:
{
  "urgency_level": "CRITICAL|HIGH|MEDIUM|LOW|NONE",
  "symptom": "Brief description of main symptom/concern",
  "reason": "Why this urgency level was chosen",
  "escalation_needed": true/false,
  "recommended_action": "Brief recommendation"
}
`;

export class SmartUrgencyAssessor {
    constructor() {
        this.cache = new Map();
    }

    async assessUrgency(message, patientContext = {}) {
        // Check cache first
        const cacheKey = `${message}_${JSON.stringify(patientContext)}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        try {
            const prompt = URGENCY_PROMPT
                .replace('{{MESSAGE}}', message)
                .replace('{{PATIENT_CONTEXT}}', JSON.stringify(patientContext, null, 2));

            const result = await makeApiCall(prompt, [], true, 0.3, 200);
            
        if (!result) {
            console.warn('[SmartUrgencyAssessor] No result from LLM API call');
            return this._getDefaultAssessment(message);
        }
        
        if (!result.reply) {
            // Suppress debug log - only show in debug mode
            if (process.env.SIMULATION_DEBUG === 'true') {
                console.warn('[SmartUrgencyAssessor] No reply field in result:', JSON.stringify(result));
            }
            return this._getDefaultAssessment(message);
        }

            // Try to parse JSON from the reply
            let assessment;
            try {
                // First try to parse the reply directly as JSON
                try {
                    assessment = JSON.parse(result.reply);
                } catch (directParseError) {
                    // If direct parsing fails, try extracting from markdown code block
                    const jsonMatch = result.reply.match(/```json\s*([\s\S]*?)\s*```/) || 
                                     result.reply.match(/```\s*([\s\S]*?)\s*```/) ||
                                     [null, result.reply];
                    
                    const jsonStr = jsonMatch[1] || result.reply;
                    assessment = JSON.parse(jsonStr);
                }
            } catch (parseError) {
                console.warn('[SmartUrgencyAssessor] JSON parse error:', parseError.message);
                console.warn('[SmartUrgencyAssessor] Raw response:', result.reply);
                return this._getDefaultAssessment(message);
            }
            
            if (!assessment || !assessment.urgency_level) {
                console.warn('[SmartUrgencyAssessor] Invalid assessment structure:', assessment);
                return this._getDefaultAssessment(message);
            }

            const finalAssessment = {
                level: assessment.urgency_level,
                symptom: assessment.symptom || 'Unknown',
                reason: assessment.reason || 'LLM assessment',
                escalationNeeded: assessment.escalation_needed || false,
                recommendedAction: assessment.recommended_action || 'Monitor'
            };

            // Cache the result
            this.cache.set(cacheKey, finalAssessment);
            
            return finalAssessment;

        } catch (error) {
            console.error('[SmartUrgencyAssessor] Error:', error.message);
            return this._getDefaultAssessment(message);
        }
    }

    _getDefaultAssessment(message = '') {
        // Simple keyword-based fallback when LLM fails
        const messageLower = message.toLowerCase();
        
        if (messageLower.includes('chest pain') || messageLower.includes('chest pain')) {
            return {
                level: 'HIGH',
                symptom: 'Chest pain',
                reason: 'Fallback: Chest pain detected',
                escalationNeeded: true,
                recommendedAction: 'Immediate medical evaluation'
            };
        }
        
        if (messageLower.includes('panic') || messageLower.includes('anxiety') || messageLower.includes('scared')) {
            return {
                level: 'MEDIUM',
                symptom: 'Panic/anxiety',
                reason: 'Fallback: Panic symptoms detected',
                escalationNeeded: true,
                recommendedAction: 'Support and monitoring'
            };
        }
        
        if (messageLower.includes('fall') || messageLower.includes('injured') || messageLower.includes('hurt')) {
            return {
                level: 'MEDIUM',
                symptom: 'Fall/injury',
                reason: 'Fallback: Injury reported',
                escalationNeeded: true,
                recommendedAction: 'Medical evaluation'
            };
        }
        
        return {
            level: 'MEDIUM', // Default to MEDIUM instead of NONE for better escalation detection
            symptom: 'General concern',
            reason: 'Assessment failed - using fallback',
            escalationNeeded: true, // Default to true for safety
            recommendedAction: 'Monitor and escalate if needed'
        };
    }

    clearCache() {
        this.cache.clear();
    }
}

export const smartUrgencyAssessor = new SmartUrgencyAssessor();
