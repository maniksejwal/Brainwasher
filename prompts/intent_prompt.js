/**
 * @fileoverview prompts/intent_prompt.js
 * This file contains the prompt for the explicit intent classification agent.
 * Its job is to quickly identify direct user commands within natural language,
 * such as a request to speak to a doctor, allowing the system to prioritize
 * these critical directives over general conversation.
 */

export const PROMPT_EXPLICIT_INTENT = `
You are a Natural Language Understanding model. Your task is to classify a user's intent.
The user is in a healthcare chat application.
Analyze the user's message to see if it matches one of the high-priority intents below.

**Intents:**
- **REQUEST_CONSULTATION:** The user explicitly states they want to talk to, consult, see, or contact a doctor or physician.
- **SHARE_WITH_DOCTOR:** The user explicitly asks to share information with the doctor.
- **SHARE_WITH_CAREGIVER:** The user explicitly asks to share information with their caregiver/spouse/family.
- **NONE:** The message is a general statement, question, or does not match any of the above intents.

**User's Message:**
"{{USER_MESSAGE}}"

Return ONLY a single, valid JSON object in a markdown block with the following structure:
{
  "intent": "The matched intent name, or NONE"
}
`;

