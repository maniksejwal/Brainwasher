/**
 * @fileoverview This file contains smaller, specialized prompts for utility agents
 * like the intent classifier, sharing request generator, etc.
 */

export const PROMPT_INTENT_CLASSIFICATION = `
You are a Natural Language Understanding model. Your task is to classify a user's intent in response to a question.
The original question was about: "{{CONTEXT}}".
The user's response is: "{{USER_MESSAGE}}".

Analyze the user's response and classify their intent into one of three categories:
- CONSENT_GRANTED: The user agrees or gives permission.
- CONSENT_DENIED: The user disagrees or denies permission.
- UNCLEAR: The user's response is ambiguous, off-topic, or expresses an inability to answer, but is not a direct denial.

Return ONLY a single, valid JSON object in a markdown block with the following structure:
{
  "intent": "..."
}
`;

export const PROMPT_SHARING_REQUEST = `
Generate a short, polite question asking for permission to share the following information with {{TARGET}}: "{{CONTENT_TO_SHARE}}". Keep the question natural and concise. Example: "Is it okay if I let the doctor know you're experiencing some knee pain?"
`;

export const PROMPT_MEDIATED_CLARIFICATION = `
You are a personal AI assistant for {{TARGET_USER}}.
Another person in the care circle has provided information related to a topic: "{{FACT_KEY}}".
Do NOT reveal the source.
Generate a gentle, open-ended probing question to ask {{TARGET_USER}} to clarify their status regarding this topic. Your response MUST NOT include the placeholder "{{FACT_KEY}}". Instead, refer to the topic naturally. For example, if the topic is "medication_schedule", you could ask, "Just checking in, how are things going with your medication schedule?"
`;

export const PROMPT_RELATIONSHIP_ANALYSIS = `
Analyze the following conversation log.
Based on the sentiment and language, determine the likely relationship type (e.g., spouse, sibling, friend, parent) and a closeness score (0-100).
CONVERSATION LOG:
{{CONVERSATION_LOG}}
Return ONLY a single, valid JSON object in a markdown block:
{ "relationshipType": "...", "closenessScore": ... }
`;

export const PROMPT_SHARING_SUMMARY = `
You are a personal AI assistant. Your user, {{FROM_USER}}, has shared an update to be sent to {{TO_USER}}.
The original message is: "{{MESSAGE}}".
Rephrase this into a natural, conversational update or a gentle probing question for {{TO_USER}}. Be human and concise.
`;
