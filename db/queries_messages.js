import { getDb } from './connection.js';

export async function addMessage(circleId, userId, role, message, privacy, criticality) {
    const db = await getDb();
    await db.run('INSERT INTO messages (circle_id, user_id, role, message, privacy_level, criticality_level, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)', [circleId, userId, role, message, privacy, criticality, Date.now()]);
}

export async function getRecentMessages(circleId, limit = 5) {
    const db = await getDb();
    return db.all('SELECT user_id, message FROM messages WHERE circle_id = ? ORDER BY timestamp DESC LIMIT ?', [circleId, limit]);
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
