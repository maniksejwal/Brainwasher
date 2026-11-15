/**
 * @fileoverview Input Understanding Handler
 * Understands user intent, extracts entities, and parses the message
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { formatMemberListForPrompt, resolveMentionedUsers } from '../utils/entityResolver.js';
import { loadPrompt } from '../utils/promptLoader.js';
import { getOpenAsks, formatOpenAsks } from '../../db/queries_asks.js';
import { normalizeDirectives } from '../../services/sharingPolicy.js';

/**
 * The patient's open asks and the companion's last reply to them, so the model can tell a
 * repeated ask from a new one and see whether the last reply answered it. Patients only.
 */
export async function buildAsksContext(role, circleId, userId, history = []) {
    if (role !== 'patient') return '';
    try {
        const open = formatOpenAsks(await getOpenAsks(circleId, userId), { withIds: true });
        const lastReply = [...(history || [])].reverse().find(m => m.role === 'patient_agent')?.message;
        return [
            '',
            '**Open asks (still waiting for an answer):**',
            open || '(none)',
            '',
            `**Companion's last reply to this user:** ${lastReply ? `"${String(lastReply).slice(0, 400)}"` : '(none)'}`
        ].join('\n');
    } catch (error) {
        console.warn('[InputUnderstanding] Could not load open asks:', error.message);
        return '';
    }
}

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
        SPEAKER_USERNAME: context.speaker?.username || 'unknown',
        ASKS_CONTEXT: await buildAsksContext(role, circleId, userId, context.history)
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
            analogyUsed: analysis.analogy_used === true,
            asks: Array.isArray(analysis.asks) ? analysis.asks : [],
            resolvedAsks: Array.isArray(analysis.resolved_asks) ? analysis.resolved_asks : [],
            sharingDirectives: normalizeDirectives(analysis.sharing_directives),
            resolvedUsers: resolvedUsers // Store resolved matches for use by other handlers
        };
    } catch (error) {
        console.error('[InputUnderstanding] Error:', error.message);
        return {
            intent: 'ASKING_QUESTION',
            mentionedUsernames: [],
            facts: {},
            sharingDirectives: [],
            resolvedUsers: []
        };
    }
}

