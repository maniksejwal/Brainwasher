/**
 * @fileoverview db/queries_sharing_restrictions.js
 * Who a user asked the companion not to share with. Rows are never deleted: revoking one
 * sets revoked_at, so the history of what the user asked stays available.
 */
import { getDb } from './connection.js';

export const RESTRICTION_ROLES = new Set(['caregiver', 'doctor', '*']);

/**
 * Active restrictions a user has set in a circle, oldest first.
 * @param {string} circleId
 * @param {string} ownerUserId
 * @returns {Promise<object[]>}
 */
export async function getActiveRestrictions(circleId, ownerUserId) {
    const db = await getDb();
    return db.all(
        `SELECT restriction_id, target_user_id, target_role, topic, created_at FROM sharing_restrictions
         WHERE circle_id = ? AND owner_user_id = ? AND revoked_at IS NULL
         ORDER BY created_at ASC, restriction_id ASC`,
        [circleId, ownerUserId]
    );
}

/**
 * Adds a restriction unless the same one is already active.
 * @param {object} params
 * @param {string} params.circleId
 * @param {string} params.ownerUserId
 * @param {string|null} [params.targetUserId] - One member
 * @param {string|null} [params.targetRole] - 'caregiver', 'doctor' or '*'
 * @param {string|null} [params.topic] - What the user said it is about, for display only
 * @param {string|null} [params.sourceText] - The user's message, for audit
 * @param {number} [params.nowMs]
 * @param {number} [params.effectiveFrom] - Start of the hidden-history window; defaults to nowMs
 * @returns {Promise<boolean>} True when a new row was added
 */
export async function addRestriction({ circleId, ownerUserId, targetUserId = null, targetRole = null, topic = null, sourceText = null, nowMs = Date.now(), effectiveFrom = nowMs }) {
    if (Boolean(targetUserId) === Boolean(targetRole)) {
        throw new Error('[SharingRestrictions] Exactly one of targetUserId or targetRole is required');
    }
    if (targetRole && !RESTRICTION_ROLES.has(targetRole)) {
        throw new Error(`[SharingRestrictions] Unknown target role: ${targetRole}`);
    }
    const db = await getDb();
    const existing = await db.get(
        `SELECT restriction_id FROM sharing_restrictions
         WHERE circle_id = ? AND owner_user_id = ? AND revoked_at IS NULL
           AND target_user_id IS ? AND target_role IS ?`,
        [circleId, ownerUserId, targetUserId, targetRole]
    );
    if (existing) return false;
    await db.run(
        `INSERT INTO sharing_restrictions (circle_id, owner_user_id, target_user_id, target_role, topic, source_text, created_at, effective_from)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [circleId, ownerUserId, targetUserId, targetRole, topic, sourceText ? String(sourceText).slice(0, 300) : null, nowMs, effectiveFrom]
    );
    return true;
}

/**
 * Revokes the active restrictions with exactly this target.
 * @returns {Promise<number>} How many were revoked
 */
export async function revokeRestrictions({ circleId, ownerUserId, targetUserId = null, targetRole = null, sourceText = null, nowMs = Date.now() }) {
    const db = await getDb();
    const result = await db.run(
        `UPDATE sharing_restrictions SET revoked_at = ?, revoked_source_text = ?
         WHERE circle_id = ? AND owner_user_id = ? AND revoked_at IS NULL
           AND target_user_id IS ? AND target_role IS ?`,
        [nowMs, sourceText ? String(sourceText).slice(0, 300) : null, circleId, ownerUserId, targetUserId, targetRole]
    );
    return result?.changes || 0;
}

/**
 * Members with an active restriction covering a reader (by user or by role), for telling
 * the reader's companion that some updates are not available. Distinct owner user IDs.
 * @param {string} circleId
 * @param {string} readerUserId
 * @returns {Promise<string[]>}
 */
export async function getOwnersRestrictingReader(circleId, readerUserId) {
    const db = await getDb();
    const rows = await db.all(
        `SELECT DISTINCT r.owner_user_id FROM sharing_restrictions r
         WHERE r.circle_id = ? AND r.revoked_at IS NULL AND r.owner_user_id <> ?
           AND (r.target_user_id = ? OR r.target_role = '*'
                OR r.target_role = (SELECT role FROM care_circle_members WHERE circle_id = ? AND user_id = ?))`,
        [circleId, readerUserId, readerUserId, circleId, readerUserId]
    );
    return rows.map(r => r.owner_user_id);
}
