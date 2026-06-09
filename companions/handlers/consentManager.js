/**
 * @fileoverview Consent Manager — DB-backed consent gate
 *
 * Separated from privacyGuard.js to give consent management its own
 * module with clear inputs/outputs (see DISCREPANCIES.md §D2).
 *
 * privacyGuard.js  — stateless LLM classifier → PUBLIC | PRIVATE | SENSITIVE
 * consentManager.js — stateful DB gate        → { allowed, requiresExplicit, impliedTopics }
 *
 * Three tiers (in precedence order):
 *   1. Emergency override: checkEmergencyFlag(circleId) → bypass all gates
 *   2. Implied consent:    getImpliedConsent(userId, circleId, topic) → allow
 *   3. Explicit consent:   circle_members.consent_level ('full' / 'limited' / 'none')
 *
 * Consent taxonomy (distinct from privacy classification taxonomy):
 *   privacy classification   → PUBLIC | PRIVATE | SENSITIVE        (content-level, LLM)
 *   consent_level (DB field) → 'none' | 'limited' | 'full'         (relationship-level)
 *   gate decision            → allowed | requiresExplicit | blocked (sharing-level)
 *   emergency override       → bypasses both above                  (situation-level)
 */

import { getImpliedConsent, findCircleById } from '../../db/index.js';
import { logConsentDecision as _logDecision } from '../../db/queries_interventions.js';

/**
 * Evaluate whether a proposed sharing action is allowed.
 *
 * @param {object} sharingSuggestion   - { target, reason, content_to_share }
 * @param {string} userId              - Requesting user ID
 * @param {string} circleId
 * @param {object} inputUnderstanding  - { facts, intent, mentionedUsernames }
 * @param {Array}  members             - Pre-fetched circle_members rows
 * @param {Array}  resolvedUsers       - Pre-resolved user objects from inputUnderstanding
 * @returns {Promise<object|null>}
 *   sharingSuggestion enriched with { requiresConsent: bool } if target found,
 *   or null if target cannot be resolved or sharing is blocked
 */
export async function evaluateConsent(sharingSuggestion, userId, circleId, inputUnderstanding, members, resolvedUsers) {
    if (!sharingSuggestion?.target) return null;

    const targetName = sharingSuggestion.target;
    const facts      = (inputUnderstanding || {}).facts || {};

    // Resolve target member: prefer resolvedUsers (handles nicknames), fall back to members list
    let targetMember = resolvedUsers?.length > 0
        ? resolvedUsers.find(r =>
            r.matchedMember?.username?.toLowerCase() === targetName.toLowerCase()
          )?.matchedMember
        : null;

    if (!targetMember) {
        targetMember = members.find(m =>
            m.username.toLowerCase() === targetName.toLowerCase()
        );
    }

    if (!targetMember) return null;

    // Emergency override bypasses all consent checks
    const emergency = await checkEmergencyFlag(circleId);
    if (emergency.emergency) {
        return {
            target:           targetMember.username,
            reason:           sharingSuggestion.reason || `Emergency share with ${targetMember.username}`,
            content_to_share: sharingSuggestion.content_to_share || '',
            emergencyOverride: true,
        };
    }

    const targetConsent = targetMember.consent_level || 'none';
    const topic = Object.keys(facts)[0] || 'general';
    const implied = await getImpliedConsent(userId, circleId, topic).catch(() => false);

    if (targetConsent === 'full' || implied) {
        return {
            target:           targetMember.username,
            reason:           sharingSuggestion.reason || `Share with ${targetMember.username}`,
            content_to_share: sharingSuggestion.content_to_share || '',
        };
    }

    if (targetConsent === 'limited') {
        return {
            target:           targetMember.username,
            reason:           sharingSuggestion.reason || `Limited share with ${targetMember.username}`,
            content_to_share: sharingSuggestion.content_to_share || '',
            limitedConsent:   true,
        };
    }

    // No consent established — flag for explicit consent request.
    // fallbackSharing.js reads requiresConsent: true and sends a consent question
    // back to the originating user.
    return {
        target:           targetMember.username,
        reason:           sharingSuggestion.reason || `Consent needed before sharing with ${targetMember.username}`,
        content_to_share: sharingSuggestion.content_to_share || '',
        requiresConsent:  true,
    };
}

/**
 * Build a sharingSuggestion from structured fallback when the LLM omitted one
 * but REPORTING_FACT intent + third-party facts clearly indicate a share target.
 *
 * @param {object} inputUnderstanding
 * @param {Array}  members
 * @param {Array}  resolvedUsers
 * @param {string} userId
 * @param {string} circleId
 * @returns {Promise<object|null>}
 */
export async function buildFallbackSuggestion(inputUnderstanding, members, resolvedUsers, userId, circleId) {
    const facts              = inputUnderstanding.facts || {};
    const mentionedUsernames = inputUnderstanding.mentionedUsernames || [];

    const factsAboutOthers = Object.entries(facts).filter(([, value]) => {
        if (typeof value !== 'string') return false;
        return mentionedUsernames.some(u => value.toLowerCase().includes(u.toLowerCase()));
    });

    if (!factsAboutOthers.length) return null;

    let targetUsername = mentionedUsernames[0];
    if (resolvedUsers?.length > 0) {
        targetUsername = resolvedUsers[0].matchedMember?.username || targetUsername;
    }

    const factKeys   = factsAboutOthers.map(([k]) => k).join(', ');
    const factValues = factsAboutOthers.map(([, v]) => v).join('; ');
    const synthetic  = {
        target:          targetUsername,
        reason:          `Facts reported about ${targetUsername}: ${factKeys}`,
        content_to_share: factValues.substring(0, 300),
    };

    return evaluateConsent(synthetic, userId, circleId, inputUnderstanding, members, resolvedUsers);
}

/**
 * Check whether the care circle has an active emergency flag.
 * Emergency flag bypasses normal consent checks and logs level='EMERGENCY'.
 *
 * @param {string} circleId
 * @returns {Promise<{ emergency: boolean, authorizedBy: string }>}
 */
export async function checkEmergencyFlag(circleId) {
    try {
        const circle = await findCircleById(circleId);
        if (circle?.emergency_flag) {
            return { emergency: true, authorizedBy: circle.emergency_authorized_by || 'system' };
        }
    } catch {
        // Non-fatal: if circle lookup fails, do not grant emergency access
    }
    return { emergency: false, authorizedBy: null };
}

/**
 * Record a consent decision to the interventions log.
 *
 * @param {string} circleId
 * @param {string} userId       - Requesting user
 * @param {string} targetRole   - Target member role or username
 * @param {'full'|'limited'|'none'|'emergency'} level
 * @param {'granted'|'denied'|'pending'|'emergency'} status
 */
export async function logConsentDecision(circleId, userId, targetRole, level, status) {
    try {
        await _logDecision(circleId, userId, targetRole, level, status);
    } catch {
        // Non-fatal: logging failure must not block sharing
    }
}
