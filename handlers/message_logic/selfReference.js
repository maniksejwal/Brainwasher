/**
 * @fileoverview handlers/message_logic/selfReference.js
 * Recognises a speaker naming themselves ("I, Manik, forgot my meds"), so their own name is
 * not treated as a third party, and records how the speaker likes to communicate.
 */
import { addFact, getCurrentFact } from '../../db/queries_facts.js';

const PROFILE_NAME_FIELDS = ['first_name', 'last_name', 'display_name', 'name', 'full_name'];
const ANALOGY_CONFIDENCE_STEP = 0.2;
const ANALOGY_CONFIDENT = 0.8;

/**
 * Every name the speaker goes by, in lower case.
 * @param {object|null} speaker - User row with username and profile_data
 * @returns {Set<string>} The names
 */
export function speakerNames(speaker) {
    const names = new Set();
    if (speaker?.username) names.add(speaker.username.toLowerCase());
    if (!speaker?.profile_data) return names;

    let profile = speaker.profile_data;
    if (typeof profile === 'string') {
        try {
            profile = JSON.parse(profile);
        } catch {
            return names;
        }
    }
    for (const field of PROFILE_NAME_FIELDS) {
        if (typeof profile?.[field] === 'string' && profile[field]) names.add(profile[field].toLowerCase());
    }
    return names;
}

/**
 * Marks facts about the speaker as self-facts. conflictHandler stores 'self' under the
 * speaker's user ID, so these are found again with the speaker's other facts.
 * @param {object} facts - Facts from the analysis
 * @param {Set<string>} names - The speaker's names
 * @returns {object} Facts with subject_id corrected
 */
export function normalizeSelfFacts(facts, names) {
    return Object.fromEntries(Object.entries(facts || {}).map(([key, fact]) => [
        key,
        fact && typeof fact === 'object' && names.has(String(fact.subject_id).toLowerCase())
            ? { ...fact, subject_id: 'self' }
            : fact
    ]));
}

/**
 * Mentions of people other than the speaker.
 * @param {string[]} mentions - Mentioned names
 * @param {Set<string>} names - The speaker's names
 * @returns {string[]} The others
 */
export function otherMentions(mentions, names) {
    return (mentions || []).filter(mention => !names.has(String(mention).toLowerCase()));
}

/**
 * Strengthens the fact that a speaker uses analogies. Never fails the turn.
 * @param {string} circleId - Care circle ID
 * @param {string} userId - The speaker
 * @returns {Promise<void>}
 */
export async function recordAnalogyUse(circleId, userId) {
    try {
        const factKey = `communication_analogy_preference_${userId}`;
        const existing = await getCurrentFact(circleId, factKey, userId);
        const confidence = Math.min(1, (existing?.confidence ?? 0) + ANALOGY_CONFIDENCE_STEP);
        await addFact(
            circleId,
            factKey,
            confidence >= ANALOGY_CONFIDENT ? 'yes, uses analogies often' : 'yes, has used analogies',
            { category: 'communication_style', confidence, sourceType: 'observed', reportedBy: userId, subjectId: userId }
        );
    } catch (error) {
        console.warn('[SelfReference] Could not record analogy use:', error.message);
    }
}
