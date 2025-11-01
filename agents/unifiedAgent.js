/**
 * @fileoverview agents/unifiedAgent.js
 * This module defines the main conversational agent that interacts
 * with patients and caregivers.
 */

import { makeApiCall } from './api_client.js';
import { getPromptForModel } from '../prompts/model_specific_prompts.js';
import { PROMPT_CONTEXT_ENRICHMENT } from '../prompts/enrichment_prompt.js';
import { getRecentMessages, getUserState, getFactHistory, findUserById, findCircleByPatientId, getUnreadEscalationsForCircle } from '../db/index.js';
import { STAGES_OF_CHANGE, COPING_STYLES } from '../behavioral_models.js';
import { events } from '../orchestrator.js';
import config from '../config.js';

export async function processUserMessage(userId, role, message, careCircleMembers, circleId) {
    const history = await getRecentMessages(circleId, 5);
    const historyText = history.map(h => `${h.user_id}: ${h.message}`);
    const currentState = await getUserState(userId, circleId);
    const factHistory = await getFactHistory(circleId, 'all', 10);
    const recentEscalations = await getUnreadEscalationsForCircle(circleId);
    const speaker = await findUserById(userId);
    const circle = await findCircleByPatientId(circleId);
    const patient = await findUserById(circle.primary_patient_id);

    const behavioralModels = {
        stages_of_change: STAGES_OF_CHANGE,
        coping_styles: COPING_STYLES
    };

    // Use the same model for prompt selection as for API call
    const modelForPrompt = config.USE_FREE_TIER_ONLY 
        ? config.DEFAULT_MODEL 
        : config.CONVERSATIONAL_AGENT_MODEL;
    
    const prompt = getPromptForModel(modelForPrompt)
        .replace('{{SPEAKER_USERNAME}}', speaker.username)
        .replace('{{SPEAKER_ROLE}}', role)
        .replace('{{PATIENT_USERNAME}}', patient.username)
        .replace('{{CARE_CIRCLE_MEMBERS}}', careCircleMembers.join(', '))
        .replace('{{MESSAGE}}', message)
        .replace('{{USER_STATE}}', JSON.stringify(currentState, null, 2))
        .replace('{{FACT_HISTORY}}', JSON.stringify(factHistory, null, 2))
        .replace('{{RECENT_ESCALATIONS}}', JSON.stringify(recentEscalations, null, 2))
        .replace('{{BEHAVIORAL_MODELS}}', JSON.stringify(behavioralModels, null, 2));

    return makeApiCall(prompt, historyText, true, 0.7, 300, 'conversational_agent'); // Increased maxTokens to 300 for complete responses
}

export async function performContextEnrichment(userMessage, originalAnalysis, entityMentioned, actualUsername, actualRole) {
    const prompt = PROMPT_CONTEXT_ENRICHMENT
        .replace('{{USER_MESSAGE}}', userMessage)
        .replace('{{ORIGINAL_ANALYSIS}}', JSON.stringify(originalAnalysis, null, 2))
        .replace('{{ENTITY_MENTIONED}}', entityMentioned)
        .replace('{{ACTUAL_USERNAME}}', actualUsername)
        .replace('{{ACTUAL_ROLE}}', actualRole);

    return makeApiCall(prompt, [], true, 0.7, 300); // Increased maxTokens to 300 for complete responses
}

