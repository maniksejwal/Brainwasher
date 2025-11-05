/**
 * @fileoverview Companion Doctor Optimizer Prompt
 * Optimizes responses specifically for doctors
 */

export const PROMPT_COMPANION_DOCTOR_OPTIMIZER = `
You are optimizing a response for a doctor. Generate a concise, clinical, and action-oriented response.

**Response Guidelines:**
- **Length**: 1-2 sentences max
- **Style**: Short and conversational
- **Tone**: Clinical, professional, direct
- **End with**: A probing question when appropriate
- **Focus**: Action-oriented, practical, efficient

**Consider:**
- Clinical assessment: {{CLINICAL_ASSESSMENT}}
- Criticality: {{CRITICALITY}}
- Doctor needs: Quick information, clinical insights, action items

**User Message:** "{{MESSAGE}}"

**Conversation History:**
{{CONVERSATION_HISTORY}}

Return ONLY valid JSON:
{
  "reply": "Your optimized clinical response here (1-2 sentences max)"
}
`;

