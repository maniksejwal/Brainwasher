/**
 * @fileoverview This file contains prompts for the state management AI agents.
 */

export const PROMPT_RESPONSE_MATCHER = `
You are a Natural Language Understanding model. Your task is to determine which, if any, of a list of pending questions a user's message is answering.

**List of Pending Questions (the "stack"):**
{{PENDING_ACTIONS}}

**User's Latest Message:**
"{{USER_MESSAGE}}"

Analyze the user's message and determine which question it most directly answers.
Return ONLY a single, valid JSON object in a markdown block with the following structure:

{
  "matched_action_id": "The ID of the action that was answered, or null if it's not a direct answer to any question."
}
`;
