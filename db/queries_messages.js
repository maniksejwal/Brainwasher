import { getDb } from './connection.js';
import { currentTurn } from '../lib/turnContext.js';

/**
 * Save a message.
 * @returns {Promise<number>} The new message ID
 */
export async function addMessage(circleId, userId, role, message, privacy, criticality) {
    const db = await getDb();
    const conversationId = currentTurn()?.conversationId ?? null;
    const result = await db.run('INSERT INTO messages (circle_id, user_id, role, message, privacy_level, criticality_level, timestamp, conversation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [circleId, userId, role, message, privacy, criticality, Date.now(), conversationId]);
    return result.lastID;
}

/**
 * SQL condition, on messages aliased m, true when the reader may not see m because its author
 * restricted the reader (as a member or by role) and m falls inside that restriction's window:
 * from effective_from (created_at for older rows) until revoked_at. A message written during
 * the window stays hidden after the restriction is lifted. Binds the reader's user ID twice.
 */
const HIDDEN_BY_RESTRICTION = `EXISTS (
    SELECT 1 FROM sharing_restrictions r
    WHERE r.circle_id = m.circle_id AND r.owner_user_id = m.user_id
      AND m.timestamp >= COALESCE(r.effective_from, r.created_at)
      AND (r.revoked_at IS NULL OR m.timestamp < r.revoked_at)
      AND (r.target_user_id = ? OR r.target_role = '*'
           OR r.target_role = (SELECT role FROM care_circle_members c WHERE c.circle_id = m.circle_id AND c.user_id = ?)))`;

/**
 * The visibility condition for a reader in a turn, on messages aliased m: their own messages,
 * plus other members' PUBLIC messages not hidden by a sharing restriction. Binds the reader's
 * user ID three times.
 */
const VISIBLE_TO_READER = `(m.user_id = ? OR (m.privacy_level = 'PUBLIC' AND NOT ${HIDDEN_BY_RESTRICTION}))`;

/**
 * Runs a read with the restriction filter; if the filter cannot be evaluated (for example the
 * restrictions table is unreadable), falls back to the reader's own messages only.
 */
async function readFailClosed(db, method, filtered, ownOnly) {
    try {
        return await db[method](...filtered);
    } catch (error) {
        console.error("[Messages] Restriction filter failed; returning the reader's own messages only:", error.message);
        return db[method](...ownOnly);
    }
}

/**
 * Whether a HIGH turn was saved in the circle since a time. In a HealthyMitra conversation
 * turn only messages that speaker may read count, as in getRecentMessages, so one member's
 * private or restricted emergency is not revealed to another.
 * @param {string} circleId - Care circle ID
 * @param {number} since - Earliest timestamp, in milliseconds
 * @returns {Promise<boolean>} Whether there is one
 */
export async function hasRecentHighMessage(circleId, since) {
    const db = await getDb();
    const turn = currentTurn();
    const base = "SELECT 1 FROM messages m WHERE m.circle_id = ? AND m.criticality_level = 'HIGH' AND m.timestamp >= ?";
    if (!turn) return Boolean(await db.get(`${base} LIMIT 1`, [circleId, since]));
    const u = turn.userId;
    const row = await readFailClosed(db, 'get',
        [`${base} AND ${VISIBLE_TO_READER} LIMIT 1`, [circleId, since, u, u, u]],
        [`${base} AND m.user_id = ? LIMIT 1`, [circleId, since, u]]);
    return Boolean(row);
}

/**
 * The most recent messages in a circle, newest first. In a HealthyMitra conversation turn
 * (lib/turnContext.js) only the speaker's own messages and other members' PUBLIC messages
 * are returned, so one member's private conversation never reaches another's agent. A PUBLIC
 * message is also left out when its author restricted the speaker at the time it was written
 * (services/sharingPolicy.js); if that cannot be checked, only the speaker's own are returned.
 */
export async function getRecentMessages(circleId, limit = 5) {
    const db = await getDb();
    const turn = currentTurn();
    if (turn) {
        const u = turn.userId;
        return readFailClosed(db, 'all',
            [`SELECT m.user_id, m.message FROM messages m WHERE m.circle_id = ? AND ${VISIBLE_TO_READER} ORDER BY m.timestamp DESC LIMIT ?`, [circleId, u, u, u, limit]],
            ['SELECT m.user_id, m.message FROM messages m WHERE m.circle_id = ? AND m.user_id = ? ORDER BY m.timestamp DESC LIMIT ?', [circleId, u, limit]]);
    }
    return db.all('SELECT user_id, message FROM messages WHERE circle_id = ? ORDER BY timestamp DESC LIMIT ?', [circleId, limit]);
}

/**
 * The criticality of the speaker's own most recent message in the circle, or null.
 * Only the speaker's messages are read, so no other member's private content is used.
 * @param {string} circleId - Care circle ID
 * @param {string} userId - The speaker
 * @returns {Promise<string|null>}
 */
export async function getLastCriticality(circleId, userId) {
    const db = await getDb();
    const row = await db.get(
        'SELECT criticality_level FROM messages WHERE circle_id = ? AND user_id = ? ORDER BY timestamp DESC, message_id DESC LIMIT 1',
        [circleId, userId]
    );
    return row?.criticality_level || null;
}

export async function upsertFact(circleId, factKey, userId, factValue) {
    const db = await getDb();
    const now = Date.now();
    await db.run(
        `INSERT INTO facts (circle_id, fact_key, reported_by, value, timestamp) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(circle_id, fact_key, reported_by) DO UPDATE SET value = excluded.value, timestamp = excluded.timestamp`,
        [circleId, factKey, userId, factValue, now]
    );
    await db.run('INSERT INTO fact_history (circle_id, fact_key, reported_by, value, timestamp) VALUES (?, ?, ?, ?, ?)', [circleId, factKey, userId, factValue, now]);
}

export async function getLastFact(circleId, factKey) {
    const db = await getDb();
    return db.get('SELECT * FROM facts WHERE circle_id = ? AND fact_key = ? ORDER BY timestamp DESC LIMIT 1', [circleId, factKey]);
}

export async function getFactHistory(circleId, factKey = 'all', limit = 10) {
    const db = await getDb();
    if (factKey === 'all') {
        return db.all('SELECT * FROM fact_history WHERE circle_id = ? ORDER BY timestamp DESC LIMIT ?', [circleId, limit]);
    }
    return db.all('SELECT * FROM fact_history WHERE circle_id = ? AND fact_key = ? ORDER BY timestamp DESC LIMIT ?', [circleId, factKey, limit]);
}

/**
 * Get total unread messages count for a user across all circles.
 * (Excludes user's own messages)
 */
export async function getTotalUnreadMessageCount(userId) {
    const db = await getDb();
    const result = await db.get(`
        SELECT COUNT(*) as count 
        FROM messages m
        JOIN care_circle_members cm ON m.circle_id = cm.circle_id
        WHERE cm.user_id = ?
          AND m.user_id != ? -- Don't count own messages
          AND m.timestamp > cm.last_read_timestamp
    `, [userId, userId]);
    return result?.count || 0;
}

/**
 * Mark a circle as read for a user (updates last_read_timestamp)
 */
export async function markCircleRead(userId, circleId) {
    const db = await getDb();
    await db.run(`
        UPDATE care_circle_members 
        SET last_read_timestamp = ? 
        WHERE user_id = ? AND circle_id = ?
    `, [Date.now(), userId, circleId]);
}
