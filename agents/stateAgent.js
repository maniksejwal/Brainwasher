/**
 * @fileoverview This module defines the AI agent responsible for understanding
 * conversational state, such as matching a user's reply to a pending question.
 */

import { makeApiCall } from './api_client.js';
import { PROMPT_RESPONSE_MATCHER } from '../prompts/state_agent_prompts.js';

export async function matchResponseToAction(userMessage, pendingActions) {
    const actionList = pendingActions.map(action =>
        `- ID: ${action.action_id}, Question: ${action.details.full_question || action.details.reason || 'General inquiry'}`
    ).join('\n');

    const prompt = PROMPT_RESPONSE_MATCHER
        .replace('{{PENDING_ACTIONS}}', actionList)
        .replace('{{USER_MESSAGE}}', userMessage);

    // FIX: This agent expects a JSON response
    return makeApiCall(prompt, [], true, 0.7, 100); // temperature=0.7, maxTokens=100 for concise responses
}

