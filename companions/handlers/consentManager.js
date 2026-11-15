/**
 * @fileoverview Consent Manager — DB-backed consent gate for sharing suggestions
 *
 * privacyGuard.js classifies content (PUBLIC | PRIVATE | SENSITIVE) and proposes a target;
 * this module decides whether that target may receive it.
 *
 * In precedence order:
 *   0. The speaker's sharing restrictions (services/sharingPolicy.js): a member they asked
 *      not to share with is never suggested, whatever their consent level. Restrictions that
 *      could not be read (null) block every suggestion.
 *   1. Implied consent: getImpliedConsent(userId, circleId, topic) → allowed
 *   2. Explicit consent: circle_members.consent_level 'full' → allowed,
 *      'limited' → allowed with limitedConsent, otherwise → requiresConsent
 *
 * The doctor goes through the same gate: a 'doctor' target is resolved to the circle's
 * doctor member, and without a doctor member consent is always required.
 */

import { getImpliedConsent } from '../../db/index.js';
import { isMemberRestricted, isDoctorRoleRestricted } from '../../services/sharingPolicy.js';

const DOCTOR_TARGET = 'doctor';

/**
 * The circle member a suggestion targets, or null.
 * @param {string} targetName - Username, or 'doctor'
 * @param {Array} members - circle_members rows
 * @param {Array} resolvedUsers - Resolved mentions from input understanding
 * @returns {object|null}
 */
function findTargetMember(targetName, members = [], resolvedUsers = []) {
    const name = String(targetName).toLowerCase();
    if (name === DOCTOR_TARGET) {
        return members.find(m => m.role === 'doctor') || null;
    }
    const resolved = resolvedUsers.find(r => r.matchedMember?.username?.toLowerCase() === name)?.matchedMember;
    return resolved || members.find(m => m.username?.toLowerCase() === name) || null;
}

/**
 * Gate a proposed sharing suggestion through consent.
 * @param {object} sharingSuggestion - { target, reason, content_to_share }
 * @param {string} userId - The speaker
 * @param {string} circleId
 * @param {object} inputUnderstanding - { facts }
 * @param {Array} members - Pre-fetched circle_members rows
 * @param {Array} resolvedUsers - Resolved mentions from input understanding
 * @param {object[]|null} [restrictions] - The speaker's active sharing restrictions; null
 *   when they could not be read
 * @returns {Promise<object|null>} The suggestion with its consent state, or null when the
 *   target is not a member of the circle or the speaker restricted them
 */
export async function evaluateConsent(sharingSuggestion, userId, circleId, inputUnderstanding, members, resolvedUsers, restrictions = []) {
    if (!sharingSuggestion?.target) return null;

    const isDoctor = String(sharingSuggestion.target).toLowerCase() === DOCTOR_TARGET;
    const targetMember = findTargetMember(sharingSuggestion.target, members, resolvedUsers);
    if (!targetMember && !isDoctor) return null;

    if (restrictions === null) {
        console.warn(`[SharingPolicy] blocked suggestion to ${sharingSuggestion.target}: restrictions unavailable`);
        return null;
    }
    if (isMemberRestricted(targetMember, restrictions) || (isDoctor && isDoctorRoleRestricted(restrictions))) {
        console.warn(`[SharingPolicy] blocked suggestion to ${sharingSuggestion.target}: restricted by the speaker`);
        return null;
    }

    // The doctor keeps the 'doctor' target so the doctor sharing flow handles it
    const target = isDoctor ? DOCTOR_TARGET : targetMember.username;
    const base = {
        target,
        reason: sharingSuggestion.reason || `Share with ${target}`,
        content_to_share: sharingSuggestion.content_to_share || ''
    };

    const facts = (inputUnderstanding || {}).facts || {};
    const topic = Object.keys(facts)[0] || 'general';
    const implied = await getImpliedConsent(userId, circleId, topic).catch(() => null);
    const consentLevel = targetMember?.consent_level || 'none';

    if (implied || consentLevel === 'full') return base;
    if (consentLevel === 'limited') return { ...base, limitedConsent: true };
    return { ...base, requiresConsent: true };
}

/**
 * A suggestion built from REPORTING_FACT facts that mention another member, before the
 * consent gate.
 * @param {object} inputUnderstanding
 * @param {Array} resolvedUsers
 * @returns {object|null}
 */
export function buildFallbackSuggestion(inputUnderstanding, resolvedUsers) {
    const facts = inputUnderstanding.facts || {};
    const mentionedUsernames = inputUnderstanding.mentionedUsernames || [];

    const factsAboutOthers = Object.entries(facts).filter(([, value]) =>
        typeof value === 'string' && mentionedUsernames.some(u => value.toLowerCase().includes(u.toLowerCase()))
    );
    if (!factsAboutOthers.length) return null;

    const targetUsername = resolvedUsers?.[0]?.matchedMember?.username || mentionedUsernames[0];
    return {
        target: targetUsername,
        reason: `Facts reported about ${targetUsername}: ${factsAboutOthers.map(([k]) => k).join(', ')}`,
        content_to_share: factsAboutOthers.map(([k, v]) => `${k}: ${v}`).join('; ').substring(0, 300)
    };
}
