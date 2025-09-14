import { getDb } from './connection.js';

export async function addEscalation(circleId, type, details) {
    const db = await getDb();
    await db.run('INSERT INTO escalations (circle_id, type, details, timestamp) VALUES (?, ?, ?, ?)', [circleId, type, details, Date.now()]);
}

export async function getUnreadEscalations() {
    const db = await getDb();
    const escalations = await db.all('SELECT * FROM escalations WHERE is_read = 0 ORDER BY timestamp ASC');
    if (escalations.length > 0) {
        const ids = escalations.map(e => e.escalation_id);
        await db.run(`UPDATE escalations SET is_read = 1 WHERE escalation_id IN (${ids.join(',')})`);
    }
    return escalations;
}

export async function updateMemberConsent(circleId, targetUserId, consentLevel) {
    const db = await getDb();
    await db.run(
        'UPDATE care_circle_members SET consent_level = ? WHERE circle_id = ? AND user_id = ?',
        [consentLevel, circleId, targetUserId]
    );
}

export async function addImpliedConsent(userId, circleId, topic) {
    const db = await getDb();
    const fifteenMinutes = Date.now() + 15 * 60 * 1000;
    await db.run('INSERT INTO implied_consent (user_id, circle_id, topic, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, circle_id, topic) DO UPDATE SET expires_at = excluded.expires_at', [userId, circleId, topic, fifteenMinutes]);
}

export async function getImpliedConsent(userId, circleId, topic) {
    const db = await getDb();
    return db.get('SELECT * FROM implied_consent WHERE user_id = ? AND circle_id = ? AND topic = ? AND expires_at > ?', [userId, circleId, topic, Date.now()]);
}

export async function addPendingAction(actionId, circleId, userId, actionType, details) {
    const db = await getDb();
    const detailsJson = JSON.stringify(details || {});
    await db.run('INSERT INTO pending_actions (action_id, circle_id, user_id, action_type, details, created_at) VALUES (?, ?, ?, ?, ?, ?)', [actionId, circleId, userId, actionType, detailsJson, Date.now()]);
}

export async function getPendingAction(actionId) {
    const db = await getDb();
    const row = await db.get('SELECT * FROM pending_actions WHERE action_id = ?', [actionId]);
    if (row) {
        row.details = JSON.parse(row.details);
    }
    return row;
}

export async function removePendingAction(actionId) {
    const db = await getDb();
    await db.run('DELETE FROM pending_actions WHERE action_id = ?', [actionId]);
}
