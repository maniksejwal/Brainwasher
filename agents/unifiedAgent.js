/**
 * @fileoverview This module defines the main conversational agent that interacts
 * with patients and caregivers. It gathers context, builds the prompt, and
 * calls the API client.
 */

import { makeApiCall } from './api_client.js';
import { PROMPT_UNIFIED_AGENT_WITH_STATE as PROMPT_UNIFIED_AGENT } from '../prompts/unified_prompt.js';
import { getRecentMessages, getUserState, getFactHistory } from '../db/index.js';
import { STAGES_OF_CHANGE, COPING_STYLES } from '../behavioral_models.js';

export async function processUserMessage(userId, role, message, careCircleMembers, circleId) {
    const history = await getRecentMessages(circleId, 5);
    const historyText = history.map(h => `${h.user_id}: ${h.message}`);
    const currentState = await getUserState(userId, circleId);
    const factHistory = await getFactHistory(circleId, 'all', 10);

    const behavioralModels = {
        stages_of_change: STAGES_OF_CHANGE,
        coping_styles: COPING_STYLES
    };

    const prompt = PROMPT_UNIFIED_AGENT
        .replace('{{USER_ID}}', userId)
        .replace('{{ROLE}}', role)
        .replace('{{CARE_CIRCLE_MEMBERS}}', careCircleMembers.join(', '))
        .replace('{{MESSAGE}}', message)
        .replace('{{USER_STATE}}', JSON.stringify(currentState, null, 2))
        .replace('{{FACT_HISTORY}}', JSON.stringify(factHistory, null, 2))
        .replace('{{BEHAVIORAL_MODELS}}', JSON.stringify(behavioralModels, null, 2));

    return makeApiCall(prompt, historyText);
}
