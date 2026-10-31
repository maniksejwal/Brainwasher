/**
 * @fileoverview db/queries_actions.js
 * This file contains all database query functions related to actions,
 * consent, and escalations. It manages the logic for creating and resolving
 * pending actions, setting consent levels, and logging critical events for doctors.
 */

import { getDb } from './connection.js';

/**
 * Insert an escalation row. New rows start with status OPEN.
 * @param {string} circleId
 * @param {string} type
 * @param {string} details
 * @param {number|null} [messageId] - The message that caused it, when known
 * @returns {Promise<number>} The new escalation ID
 */
export async function addEscalation(circleId, type, details, messageId = null) {
    const db = await getDb();
    const result = await db.run(
        "INSERT INTO escalations (circle_id, type, details, timestamp, status, message_id) VALUES (?, ?, ?, ?, 'OPEN', ?)",
        [circleId, type, details, Date.now(), messageId]
    );
    return result.lastID;
}

/**
 * Insert an escalation unless one of the given types already exists for the same message.
 * Rows without a message ID are never treated as duplicates.
 * @param {string} circleId
 * @param {string} type
 * @param {string} details
 * @param {number|null} messageId
 * @param {string[]} dedupeTypes - Types that count as the same escalation
 * @returns {Promise<{escalationId: number, created: boolean}>}
 */
export async function addEscalationOnce(circleId, type, details, messageId, dedupeTypes) {
    if (messageId != null) {
        const db = await getDb();
        const placeholders = dedupeTypes.map(() => '?').join(', ');
        const existing = await db.get(
            `SELECT escalation_id FROM escalations WHERE message_id = ? AND type IN (${placeholders}) ORDER BY escalation_id LIMIT 1`,
            [messageId, ...dedupeTypes]
        );
        if (existing) {
            return { escalationId: existing.escalation_id, created: false };
        }
    }
    return { escalationId: await addEscalation(circleId, type, details, messageId), created: true };
}

/**
 * Record one recipient of an escalation.
 * @param {object} delivery - { escalationId, userId, role, channel, status, providerMessageId, error }
 * @returns {Promise<number>} The new delivery ID
 */
export async function addEscalationDelivery({ escalationId, userId, role, channel, status, providerMessageId = null, error = null }) {
    const db = await getDb();
    const result = await db.run(
        'INSERT INTO escalation_deliveries (escalation_id, user_id, role, channel, status, provider_message_id, error, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [escalationId, userId, role, channel, status, providerMessageId, error, Date.now()]
    );
    return result.lastID;
}

export async function updateEscalationDelivery(deliveryId, status, error = null) {
    const db = await getDb();
    await db.run('UPDATE escalation_deliveries SET status = ?, error = ? WHERE delivery_id = ?', [status, error, deliveryId]);
}

export async function getEscalationDeliveries(escalationId) {
    const db = await getDb();
    return db.all(`
        SELECT d.*, u.username
        FROM escalation_deliveries d
        LEFT JOIN users u ON u.user_id = d.user_id
        WHERE d.escalation_id = ?
        ORDER BY d.delivery_id ASC
    `, [escalationId]);
}

/**
 * Record that one recipient acknowledged one escalation.
 * @returns {Promise<boolean>} True if the user was a recipient and had not acknowledged it yet
 */
export async function acknowledgeEscalation(escalationId, userId) {
    const db = await getDb();
    const result = await db.run(
        'UPDATE escalation_deliveries SET acknowledged_at = ? WHERE escalation_id = ? AND user_id = ? AND acknowledged_at IS NULL',
        [Date.now(), escalationId, userId]
    );
    if (result.changes === 0) return false;
    await db.run("UPDATE escalations SET status = 'ACKNOWLEDGED' WHERE escalation_id = ? AND status = 'OPEN'", [escalationId]);
    return true;
}

export async function getUnreadEscalationsForCircle(circleId) {
    const db = await getDb();
    return db.all('SELECT * FROM escalations WHERE circle_id = ? AND is_read = 0 ORDER BY timestamp ASC', [circleId]);
}

export async function getUnreadEscalationsForUser(userId) {
    const db = await getDb();
    const escalations = await db.all(`
        SELECT e.*, p.username as patient_username
        FROM escalations e
        JOIN care_circle_members m ON e.circle_id = m.circle_id
        JOIN care_circles c ON e.circle_id = c.circle_id
        JOIN users p ON c.primary_patient_id = p.user_id
        WHERE m.user_id = ? AND m.role = 'doctor' AND e.is_read = 0
        ORDER BY e.timestamp ASC
    `, [userId]);
    
    return escalations;
}


export async function markCircleEscalationsAsRead(circleId) {
    const db = await getDb();
    await db.run('UPDATE escalations SET is_read = 1 WHERE circle_id = ?', [circleId]);
}

export async function addDirective(circleId, doctorId, type, details) {
    const db = await getDb();
    await db.run('INSERT INTO directives (circle_id, doctor_id, type, details, timestamp) VALUES (?, ?, ?, ?, ?)', [circleId, doctorId, type, details, Date.now()]);
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

export async function findPendingAction(userId, circleId, actionType, detailKey, detailValue) {
     const db = await getDb();
    const rows = await db.all('SELECT * FROM pending_actions WHERE user_id = ? AND circle_id = ? AND action_type = ?', [userId, circleId, actionType]);
    
    for (const row of rows) {
        const details = JSON.parse(row.details);
        if (details && details[detailKey] === detailValue) {
            return { ...row, details };
        }
    }
    return null;
}

export async function getActivePendingActions(userId, circleId) {
    const db = await getDb();
    const rows = await db.all('SELECT * FROM pending_actions WHERE user_id = ? AND circle_id = ? ORDER BY created_at ASC', [userId, circleId]);
    return rows.map(row => {
        // Ensure details are parsed from JSON
        row.details = JSON.parse(row.details);
        return row;
    });
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

