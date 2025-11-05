/**
 * @fileoverview prompts/emergency_confidence_prompt.js
 * Prompt templates for emergency confidence assessment and escalation hint generation
 */

/**
 * Generate prompt for assessing emergency confidence level
 * @param {string} message - User message
 * @param {object} analysis - AI analysis result
 * @returns {string} Complete prompt for LLM confidence assessment
 */
export function generateEmergencyConfidencePrompt(message, analysis) {
    return `You are a healthcare AI assistant assessing the confidence level for a potential medical emergency.

**User Message:** "${message}"

**AI Analysis:**
- Criticality: ${analysis.criticality}
- Intent: ${analysis.intent || 'N/A'}
- Facts: ${JSON.stringify(analysis.facts || {})}

**Your Task:**
Assess the confidence level (0.0 to 1.0) that this is a true medical emergency requiring immediate escalation.

**Confidence Guidelines:**
- **0.9-1.0 (Very High)**: Clear emergency signs (chest pain, can't breathe, loss of consciousness, severe bleeding, heart attack, stroke, seizure, severe allergic reaction, severe head injury)
- **0.7-0.89 (High)**: Concerning symptoms with severity indicators (severe pain, intense symptoms, combined with danger signs)
- **0.5-0.69 (Medium)**: Concerning symptoms but may need clarification (pain, dizziness, fever, falls - without clear severity)
- **0.0-0.49 (Low)**: HIGH criticality assigned but likely false positive (vague symptoms, non-specific complaints)

**Consider:**
- Specificity of symptoms (more specific = higher confidence)
- Severity indicators (severe, intense, extreme, terrible, awful, worst)
- Combination of symptoms (multiple symptoms = higher confidence)
- Context clues (user's language, urgency indicators)

Return ONLY a valid JSON object with this exact structure:
{
  "confidence": 0.95,
  "reasoning": "Clear emergency: chest pain with difficulty breathing indicates potential cardiac event",
  "is_emergency": true,
  "recommended_action": "immediate_escalation" | "ask_followup_question" | "monitor"
}

Return only the JSON object, no other text.`;
}

/**
 * Generate prompt for creating escalation hint question
 * @param {string} message - Original user message
 * @param {object} analysis - AI analysis result
 * @param {number} confidence - Confidence level (0-1)
 * @returns {string} Complete prompt for LLM question generation
 */
export function generateEscalationHintPrompt(message, analysis, confidence) {
    return `You are a healthcare AI assistant. A user reported a concerning health issue, but you need more information before deciding whether to escalate to a doctor.

**User's Original Message:** "${message}"

**AI Analysis:**
- Criticality: ${analysis.criticality}
- Confidence Level: ${(confidence * 100).toFixed(0)}%
- Facts: ${JSON.stringify(analysis.facts || {})}

**Your Task:**
Generate a follow-up question that:
1. Hints at potential escalation (mentions consulting a doctor if symptoms are severe)
2. Gathers critical information to assess severity
3. Is natural and conversational (not alarming)
4. Provides clear escalation criteria (e.g., "If X, I should consult a doctor")

**Question Guidelines:**
- Be specific to the symptoms mentioned
- Include escalation criteria (e.g., "If pain is 8/10 or higher...")
- Mention other concerning symptoms to watch for
- Keep it conversational and supportive

**Examples:**
- For pain: "How severe is the pain on a scale of 1-10? If it's an 8 or higher, or if you're experiencing other symptoms like shortness of breath or dizziness, I should consult with a doctor right away."
- For breathing: "Can you describe the breathing difficulty? If it's getting worse or you're having trouble speaking, I should escalate this to a doctor immediately."
- For falls: "Did you hit your head or lose consciousness when you fell? If you did, or if you're experiencing confusion, severe pain, or difficulty moving, I should escalate this to a doctor immediately."

Return ONLY a valid JSON object with this exact structure:
{
  "question": "Your follow-up question here that hints at escalation",
  "escalation_criteria": "Brief description of when escalation would be triggered"
}

Return only the JSON object, no other text.`;
}

