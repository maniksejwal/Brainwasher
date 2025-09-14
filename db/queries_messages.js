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
