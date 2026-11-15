/**
 * @fileoverview services/sharingPolicy.js
 * The user's own limits on who the companion may share with ("don't tell my daughter").
 *
 * Input understanding reports what the user asked as sharing directives; this module maps
 * them to circle members in code and stores them (db/queries_sharing_restrictions.js).
 * Every path that proposes or sends something to another member checks them here:
 *   - consentManager.evaluateConsent: a restricted member is never suggested
 *   - memberMessaging.shareWithMembers, escalationService.escalate and
 *     escalationService.proposeEscalation, caregiver probing and scheduled messages:
 *     a restricted member is never sent to
 *
 * A restriction covers everything the owner shares with that member, whatever the topic,
 * until the owner lifts it. The topic is kept for display only: deciding whether a later
 * message is "about the same thing" is not reliable enough to let something through.
 *
 * Emergencies: a restricted member is never alerted without the owner's explicit yes. In a
 * HIGH emergency they may be included in the proposal, which then names the restriction and
 * is never sent automatically (see escalationService.proposeEscalation).
 *
 * If restrictions cannot be read, sending fails closed: nobody is sent to.
 */
import { getActiveRestrictions, addRestriction, revokeRestrictions, getOwnersRestrictingReader } from '../db/queries_sharing_restrictions.js';
import { matchMentionedUser } from '../companions/utils/entityResolver.js';
import { joinNames } from '../utils/actionClaimGuard.js';
import { currentTurn } from '../lib/turnContext.js';

export const DIRECTIVE_ACTIONS = new Set(['restrict', 'allow']);
// Group targets the model may use, and the stored role each one maps to
export const GROUP_TARGETS = { all_caregivers: 'caregiver', all_doctors: 'doctor', everyone: '*' };
const ROLE_LABELS = { caregiver: 'all caregivers', doctor: 'all doctors', '*': 'everyone in the circle' };
const MAX_DIRECTIVES = 5;

/**
 * Directives from input understanding in a checked shape. Anything malformed is dropped.
 * @param {unknown} raw
 * @returns {Array<{action: string, targets: string[], topic: string|null}>}
 */
export function normalizeDirectives(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, MAX_DIRECTIVES).flatMap(item => {
        const action = String(item?.action || '').toLowerCase();
        const targets = (Array.isArray(item?.targets) ? item.targets : [])
            .map(t => String(t || '').trim())
            .filter(Boolean);
        if (!DIRECTIVE_ACTIONS.has(action) || targets.length === 0) return [];
        const topic = typeof item?.topic === 'string' && item.topic.trim() ? item.topic.trim().slice(0, 100) : null;
        return [{ action, targets, topic }];
    });
}

/**
 * Whether a restriction covers a member.
 * @param {{user_id: string, role: string}} member
 * @param {object[]} restrictions - Active restrictions
 * @returns {boolean}
 */
export function isMemberRestricted(member, restrictions = []) {
    if (!member) return false;
    return restrictions.some(r =>
        (r.target_user_id && r.target_user_id === member.user_id) ||
        r.target_role === '*' ||
        (r.target_role && r.target_role === member.role)
    );
}

/**
 * Whether the circle's doctor role as a whole is restricted, for a 'doctor' target that is
 * not yet resolved to a member.
 */
export function isDoctorRoleRestricted(restrictions = []) {
    return restrictions.some(r => r.target_role === 'doctor' || r.target_role === '*');
}

/**
 * Maps one directive's targets to stored targets. Names must match a circle member other
 * than the owner; anything else is reported as unresolved and nothing is guessed.
 * @returns {{resolved: Array<{targetUserId?: string, targetRole?: string, label: string}>, unresolved: string[]}}
 */
export function resolveTargets(targets, members, ownerUserId) {
    const resolved = [];
    const unresolved = [];
    const others = members.filter(m => m.user_id !== ownerUserId);
    for (const target of targets) {
        const group = GROUP_TARGETS[target.toLowerCase()];
        if (group) {
            resolved.push({ targetRole: group, label: ROLE_LABELS[group] });
            continue;
        }
        const member = matchMentionedUser(target, others);
        if (member) {
            resolved.push({ targetUserId: member.user_id, label: member.username });
        } else {
            unresolved.push(target);
        }
    }
    return { resolved, unresolved };
}

/**
 * How far before the turn that set a restriction its hidden-history window starts, so the
 * message asking for it (and anything said just before) is covered.
 */
export const RESTRICTION_LOOKBACK_MS = 60_000;

/**
 * Applies this turn's directives and returns what changed.
 * @param {object} params
 * @param {string} params.circleId
 * @param {string} params.ownerUserId - The speaker
 * @param {Array} params.directives - From normalizeDirectives
 * @param {Array} params.members - circle_members rows with usernames
 * @param {string} [params.sourceText] - The user's message
 * @returns {Promise<{restricted: string[], allowed: string[], stillRestricted: string[], unresolved: string[]}>}
 */
export async function applySharingDirectives({ circleId, ownerUserId, directives, members, sourceText = null }) {
    const outcome = { restricted: [], allowed: [], stillRestricted: [], unresolved: [] };
    const allowRequested = [];
    const effectiveFrom = (currentTurn()?.startedAt ?? Date.now()) - RESTRICTION_LOOKBACK_MS;
    for (const directive of directives) {
        const { resolved, unresolved } = resolveTargets(directive.targets, members, ownerUserId);
        outcome.unresolved.push(...unresolved);
        for (const target of resolved) {
            const params = { circleId, ownerUserId, targetUserId: target.targetUserId || null, targetRole: target.targetRole || null, sourceText };
            if (directive.action === 'restrict') {
                await addRestriction({ ...params, topic: directive.topic, effectiveFrom });
                outcome.restricted.push(target.label);
            } else {
                allowRequested.push(target.label);
                // Only a restriction actually lifted is confirmed ("tell my doctor" with none set is not)
                if (await revokeRestrictions(params) > 0) outcome.allowed.push(target.label);
            }
        }
    }

    // Lifting one member's restriction does not lift a group restriction that covers them
    if (allowRequested.length > 0) {
        const active = await getActiveRestrictions(circleId, ownerUserId);
        for (const member of members) {
            if (allowRequested.includes(member.username) && isMemberRestricted(member, active)) {
                outcome.stillRestricted.push(member.username);
            }
        }
    }
    return outcome;
}

/**
 * The sentence confirming this turn's changes to the user, written by code so it states
 * exactly what was stored. Empty when nothing changed.
 * @param {{restricted: string[], allowed: string[], stillRestricted: string[], unresolved: string[]}} outcome
 * @returns {string}
 */
export function buildDirectiveNotice(outcome) {
    if (!outcome) return '';
    const parts = [];
    const restricted = [...new Set(outcome.restricted)];
    const allowed = [...new Set(outcome.allowed)].filter(n => !outcome.stillRestricted.includes(n));
    const still = [...new Set(outcome.stillRestricted)];
    if (restricted.length) {
        parts.push(`Okay, I won't share anything with ${joinNames(restricted)} unless you tell me otherwise.`);
    }
    if (allowed.length) {
        parts.push(`Okay, I can share with ${joinNames(allowed)} again, and I'll still ask you first.`);
    }
    if (still.length) {
        parts.push(`You also asked me earlier not to share with a group that includes ${joinNames(still)}, so that still applies. Tell me if you want to lift it.`);
    }
    if (outcome.unresolved.length && !restricted.length && !allowed.length) {
        parts.push(`Who do you mean by ${joinNames([...new Set(outcome.unresolved)].map(n => `"${n}"`))}? Tell me their name so I can make sure.`);
    }
    return parts.join(' ');
}

/**
 * Active restrictions, or null when they could not be read.
 * @returns {Promise<object[]|null>}
 */
export async function loadRestrictions(circleId, ownerUserId) {
    try {
        return await getActiveRestrictions(circleId, ownerUserId);
    } catch (error) {
        console.error(`[SharingPolicy] Could not read restrictions (circle=${circleId}, owner=${ownerUserId}):`, error.message);
        return null;
    }
}

/**
 * Splits recipients into those the owner allows and those they restricted. When the
 * restrictions cannot be read, everyone is blocked.
 * @param {object} params
 * @param {string} params.circleId
 * @param {string} params.ownerUserId - The user the content comes from
 * @param {Array<{user_id: string, role: string, username?: string}>} params.members
 * @param {string} [params.path] - Caller name, for the log
 * @returns {Promise<{allowed: object[], blocked: object[], failedClosed: boolean}>}
 */
export async function partitionRecipients({ circleId, ownerUserId, members, path = 'unknown' }) {
    const list = members || [];
    if (list.length === 0) return { allowed: [], blocked: [], failedClosed: false };
    const restrictions = await loadRestrictions(circleId, ownerUserId);
    if (restrictions === null) {
        console.warn(`[SharingPolicy] blocked ${list.length} recipient(s) on ${path}: restrictions unavailable`);
        return { allowed: [], blocked: list, failedClosed: true };
    }
    const allowed = [];
    const blocked = [];
    for (const member of list) {
        (isMemberRestricted(member, restrictions) ? blocked : allowed).push(member);
    }
    if (blocked.length) {
        console.warn(`[SharingPolicy] blocked on ${path} (circle=${circleId}, owner=${ownerUserId}): ${blocked.map(m => m.username || m.user_id).join(', ')}`);
    }
    return { allowed, blocked, failedClosed: false };
}

/**
 * The restrictions as prompt text, naming members, or '' when there are none.
 * @param {object[]} restrictions
 * @param {Array} members
 * @returns {string}
 */
export function describeRestrictions(restrictions = [], members = []) {
    const names = restrictions.map(r => {
        if (r.target_role) return ROLE_LABELS[r.target_role] || r.target_role;
        return members.find(m => m.user_id === r.target_user_id)?.username || null;
    }).filter(Boolean);
    return [...new Set(names)].join(', ');
}

/**
 * Names of members who have restricted the reader, so the reader's companion knows some
 * updates are not available: '' when none, null when this could not be checked.
 * @param {string} circleId
 * @param {string} readerUserId
 * @param {Array<{user_id: string, username?: string}>} members
 * @returns {Promise<string|null>}
 */
export async function describeWithheldFrom(circleId, readerUserId, members = []) {
    try {
        const owners = await getOwnersRestrictingReader(circleId, readerUserId);
        const names = owners.map(id => members.find(m => m.user_id === id)?.username || 'another member');
        return joinNames([...new Set(names)]);
    } catch (error) {
        console.error(`[SharingPolicy] Could not check restrictions on reader (circle=${circleId}, reader=${readerUserId}):`, error.message);
        return null;
    }
}

/**
 * Reply-prompt guidance for a reader some members have restricted, or '' when none. It asks
 * for a neutral answer that does not reveal a restriction exists.
 * @param {string|null} withheldFrom - From describeWithheldFrom
 * @returns {string}
 */
export function withheldGuidance(withheldFrom) {
    if (withheldFrom === '') return '';
    const who = withheldFrom === null ? 'some circle members' : withheldFrom;
    return `Recent updates from ${who} are not available to you. If asked about them, say you do not have an update from them that you can share and suggest asking them directly. Do not say or hint that anything is being kept private, and do not guess how they are.`;
}
