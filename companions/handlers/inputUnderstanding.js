/**
 * @fileoverview Input Understanding Handler
 * Understands user intent, extracts entities, and parses the message
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { formatMemberListForPrompt, resolveMentionedUsers } from '../utils/entityResolver.js';
import { loadPrompt } from '../utils/promptLoader.js';

/**
 * Process input understanding
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context
 * @returns {Promise<object>} Understanding analysis
 */
export async function processInputUnderstanding(userId, role, message, circleId, context) {
    // Get care circle members for entity resolution
    const members = context.members || [];
    const memberList = formatMemberListForPrompt(members);
    
    // Load prompt from file with template variables
    const prompt = loadPrompt('input_understanding', {
        MEMBER_LIST: memberList,
        MESSAGE: message,
        ROLE: role,
        SPEAKER_USERNAME: context.speaker?.username || 'unknown'
    });

    try {
        const result = await makeApiCall(prompt, [], true);
        const analysis = parseCompanionResponse(result, 'InputUnderstanding');
        
        if (!analysis) {
            throw new Error('Failed to parse JSON response');
        }
        
        // Extract mentioned usernames from AI
        const aiExtractedUsernames = analysis.mentioned_usernames || [];
        
        // Resolve mentioned users to actual members (handles nicknames, partial matches)
        const resolvedUsers = resolveMentionedUsers(message, members, aiExtractedUsernames);
        
        // Get unique list of matched usernames
        const resolvedUsernames = [...new Set(resolvedUsers.map(r => r.matchedMember.username))];
        
        // Also include any AI-extracted usernames that weren't matched (might be external references)
        const allMentionedUsernames = [...new Set([...resolvedUsernames, ...aiExtractedUsernames])];
        
        return {
            intent: analysis.intent || 'ASKING_QUESTION',
            mentionedUsernames: allMentionedUsernames,
            facts: analysis.facts || {},
            resolvedUsers: resolvedUsers // Store resolved matches for use by other handlers
        };
    } catch (error) {
        console.error('[InputUnderstanding] Error:', error.message);
        return {
            intent: 'ASKING_QUESTION',
            mentionedUsernames: [],
            facts: {},
            resolvedUsers: []
        };
    }
}

