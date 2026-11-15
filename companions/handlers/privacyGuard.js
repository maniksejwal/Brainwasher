/**
 * @fileoverview Privacy Guard Handler
 * Classifies a message as PUBLIC | PRIVATE | SENSITIVE with one LLM call, then gates any
 * sharing suggestion through consentManager.js.
 *
 * - PRIVATE is the default, including when the LLM call fails.
 * - SENSITIVE content is never given a sharing suggestion.
 * - Suggestions from the speaker's intent (reported facts, mediation, advice, a doctor
 *   request) come first; the classifier's own suggestion is used when there is none.
 *   Intents may be combined, e.g. "REPORTING_FACT|REQUESTING_DOCTOR".
 * - Every suggestion, the doctor included, goes through the consent gate, which also drops
 *   any member the speaker asked not to share with.
 * - A request not to share (REQUESTING_NON_DISCLOSURE) never produces a suggestion.
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';
import { getCircleMembers, findCircleById } from '../../db/index.js';
import { evaluateConsent, buildFallbackSuggestion } from './consentManager.js';
import { describeRestrictions } from '../../services/sharingPolicy.js';

const PRIVACY_LEVELS = ['PUBLIC', 'PRIVATE', 'SENSITIVE'];
const DEFAULT_LEVEL = 'PRIVATE';

/**
 * The intents in a possibly combined intent string, upper-cased.
 * @param {string} intent
 * @returns {string[]}
 */
export function splitIntents(intent) {
    return String(intent || '').split('|').map(i => i.trim().toUpperCase()).filter(Boolean);
}

/**
 * The members list as prompt text, marking the patient, the speaker and consent levels.
 * @param {Array} members
 * @param {string|null} patientId
 * @param {string} userId
 * @returns {string}
 */
function formatMembers(members, patientId, userId) {
    if (!members.length) return 'none';
    return members.map(m => {
        const tags = [m.role || 'member'];
        if (m.user_id === patientId) tags.push('patient');
        if (m.user_id === userId) tags.push('speaking');
        if (m.consent_level) tags.push(`consent:${m.consent_level}`);
        return `${m.username} (${tags.join(', ')})`;
    }).join(', ');
}

/**
 * The LLM's privacy classification. Falls back to PRIVATE with no suggestion.
 * @param {string} prompt
 * @returns {Promise<{privacyLevel: string, suggestion: object|null, reasoning: string, llmFallback: boolean}>}
 */
async function classify(prompt) {
    try {
        const result = await makeApiCall(prompt, [], true);
        const analysis = result?.isFallback ? null : parseCompanionResponse(result, 'PrivacyGuard');
        const level = String(analysis?.privacyLevel || '').toUpperCase();
        if (PRIVACY_LEVELS.includes(level)) {
            return {
                privacyLevel: level,
                suggestion: analysis.sharingSuggestion?.target ? analysis.sharingSuggestion : null,
                reasoning: analysis.reasoning || '',
                llmFallback: false
            };
        }
    } catch (error) {
        console.error('[PrivacyGuard] LLM call failed:', error.message);
    }
    console.warn(`[PrivacyGuard] No usable classification; defaulting to ${DEFAULT_LEVEL}`);
    return { privacyLevel: DEFAULT_LEVEL, suggestion: null, reasoning: '', llmFallback: true };
}

/**
 * The classifier's suggestion, with the content filled in from the message when it targets a
 * doctor and the classifier left it empty. Without content the suggestion is dropped
 * (fallbackSharing.js), so a request such as "can you ask my doctor what to do?" that was not
 * labelled REQUESTING_DOCTOR would get no proposal.
 * @param {object|null} suggestion
 * @param {string} message
 * @param {Array} members
 * @returns {object|null}
 */
export function withDoctorContent(suggestion, message, members = []) {
    if (!suggestion || String(suggestion.content_to_share || '').trim()) return suggestion;
    const target = String(suggestion.target || '');
    const isDoctor = target.toLowerCase() === 'doctor' ||
        members.some(m => m.role === 'doctor' && m.username === target);
    if (!isDoctor) return suggestion;
    return { ...suggestion, content_to_share: String(message || '').substring(0, 200) };
}

/**
 * The sharing suggestion implied by the speaker's intent, before the consent gate.
 * @returns {object|null}
 */
function suggestionFromIntent(intents, message, inputUnderstanding, resolvedUsers) {
    if (intents.includes('REPORTING_FACT')) {
        const fromFacts = buildFallbackSuggestion(inputUnderstanding, resolvedUsers);
        if (fromFacts) return fromFacts;
    }

    const mentioned = resolvedUsers[0]?.matchedMember?.username || (inputUnderstanding.mentionedUsernames || [])[0];
    if (mentioned && intents.includes('REQUESTING_MEDIATION')) {
        return { target: mentioned, reason: 'Mediate communication', content_to_share: message.substring(0, 200) };
    }
    if (mentioned && intents.includes('GIVING_ADVICE_FOR_OTHER')) {
        return { target: mentioned, reason: 'Share medical advice', content_to_share: message.substring(0, 200) };
    }
    if (intents.includes('REQUESTING_DOCTOR')) {
        return { target: 'doctor', reason: 'Patient requested doctor consultation', content_to_share: 'Patient wants to speak with doctor' };
    }
    return null;
}

/**
 * Process privacy decision
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context with inputUnderstanding, members, history
 * @returns {Promise<object>} { level, reasoning, sharingSuggestion, consentCheck, llmFallback }
 */
export async function processPrivacyDecision(userId, role, message, circleId, context = {}) {
    const inputUnderstanding = context.inputUnderstanding || {};
    const resolvedUsers = inputUnderstanding.resolvedUsers || [];
    const members = context.members || await getCircleMembers(circleId);
    const circle = await findCircleById(circleId).catch(() => null);

    const recentHistory = (context.history || []).slice(-3)
        .map(h => `${h.user_id}: ${(h.message || '').substring(0, 120)}`)
        .join('\n') || 'No recent history';

    // undefined: not loaded by this caller (none known); null: could not be read (blocks all)
    const restrictions = context.sharingRestrictions === undefined ? [] : context.sharingRestrictions;
    const prompt = loadPrompt('privacy_guard', {
        MESSAGE: message,
        USER_ROLE: role,
        CIRCLE_MEMBERS: formatMembers(members, circle?.primary_patient_id || null, userId),
        CONVERSATION_CONTEXT: recentHistory,
        SHARING_RESTRICTIONS: restrictions === null
            ? 'unknown: suggest no one'
            : (describeRestrictions(restrictions, members) || 'none')
    });
    const { privacyLevel, suggestion, reasoning, llmFallback } = await classify(prompt);

    const intents = splitIntents(inputUnderstanding.intent);
    let sharingSuggestion = null;
    if (privacyLevel !== 'SENSITIVE' && !intents.includes('REQUESTING_NON_DISCLOSURE')) {
        const fromIntent = suggestionFromIntent(intents, message, inputUnderstanding, resolvedUsers);
        const proposed = fromIntent || withDoctorContent(suggestion, message, members);
        if (proposed) {
            sharingSuggestion = await evaluateConsent(proposed, userId, circleId, inputUnderstanding, members, resolvedUsers, restrictions);
        }
    }

    return {
        level: privacyLevel,
        reasoning,
        sharingSuggestion,
        consentCheck: {
            required: sharingSuggestion?.requiresConsent || false,
            target: sharingSuggestion?.target || null
        },
        llmFallback
    };
}
