/**
 * @fileoverview agents/utilityAgents.js
 * This module contains smaller, specialized agents that perform single, focused
 * tasks. These agents are used by the main orchestrator to handle specific
 * parts of the conversational logic, such as classifying user intent, generating
 * sharing requests, or analyzing relationships.
 */

import { makeApiCall } from './api_client.js';
// FIX: Import the missing explicit intent prompt
import { PROMPT_EXPLICIT_INTENT } from '../prompts/intent_prompt.js';
import {
    PROMPT_INTENT_CLASSIFICATION,
    PROMPT_SHARING_REQUEST,
    PROMPT_MEDIATED_CLARIFICATION,
    PROMPT_RELATIONSHIP_ANALYSIS,
    PROMPT_SHARING_SUMMARY
} from '../prompts/utility_prompts.js';

export async function classifyExplicitIntent(message) {
    const prompt = PROMPT_EXPLICIT_INTENT.replace('{{USER_MESSAGE}}', message);
    return makeApiCall(prompt, [], true);
}

export async function classifyUserIntent(message, context) {
    const prompt = PROMPT_INTENT_CLASSIFICATION
        .replace('{{USER_MESSAGE}}', message)
        .replace('{{CONTEXT}}', context);
    return makeApiCall(prompt, [], true);
}

export async function generateSharingRequest(target, reason, contentToShare) {
    const prompt = PROMPT_SHARING_REQUEST
        .replace('{{TARGET}}', target)
        .replace('{{REASON}}', reason)
        .replace('{{CONTENT_TO_SHARE}}', contentToShare);
    const result = await makeApiCall(prompt, [], false);
    return result.reply;
}

export async function generateMediatedClarification(targetUser, factKey) {
    const prompt = PROMPT_MEDIATED_CLARIFICATION
        .replace('{{TARGET_USER}}', targetUser)
        .replace('{{FACT_KEY}}', factKey);
    const result = await makeApiCall(prompt, [], false);
    return result.reply;
}

export async function analyzeRelationship(sharedHistory) {
    if (!sharedHistory || sharedHistory.length === 0) {
        return { relationshipType: 'unknown', closenessScore: 50 };
    }
    const prompt = PROMPT_RELATIONSHIP_ANALYSIS.replace('{{CONVERSATION_LOG}}', sharedHistory.join('\n'));
    return makeApiCall(prompt, [], true);
}

export async function generateSharingSummaryOrProbe(fromUser, toUser, message) {
    const prompt = PROMPT_SHARING_SUMMARY
        .replace('{{FROM_USER}}', fromUser)
        .replace('{{TO_USER}}', toUser)
        .replace('{{MESSAGE}}', message);
    const result = await makeApiCall(prompt, [], false);
    return result.reply;
}

