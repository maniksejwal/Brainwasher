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
 * Get one escalation with the user whose message caused it, when known.
 * @returns {Promise<object|undefined>} The escalation row plus `author_id` and `patient_id`
 */
export async function getEscalationById(escalationId) {
    const db = await getDb();
    return db.get(`
        SELECT e.*, m.user_id AS author_id, c.primary_patient_id AS patient_id
        FROM escalations e
        LEFT JOIN messages m ON m.message_id = e.message_id
        LEFT JOIN care_circles c ON c.circle_id = e.circle_id
        WHERE e.escalation_id = ?
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
    // is_read follows the status so older readers of the column stay correct
    await db.run("UPDATE escalations SET status = 'ACKNOWLEDGED', is_read = 1 WHERE escalation_id = ? AND status = 'OPEN'", [escalationId]);
    return true;
}

/**
 * Open escalations in a circle, oldest first. Used as context for the agents.
 */
export async function getUnreadEscalationsForCircle(circleId) {
    const db = await getDb();
    return db.all("SELECT * FROM escalations WHERE circle_id = ? AND status = 'OPEN' ORDER BY timestamp ASC", [circleId]);
}

/**
 * Escalations sent to a doctor that the doctor has not acknowledged, oldest first.
 * Based on delivery rows, so a doctor sees only what was sent to them. Anonymous
 * consultations (ANONYMOUS_CONSULTATION, CONSULT) do not carry the patient's username.
 * @param {string} userId - The doctor
 * @param {string} [circleId] - Limit to one circle
 */
export async function getUnreadEscalationsForUser(userId, circleId = null) {
    const db = await getDb();
    const params = [userId];
    let circleFilter = '';
    if (circleId) {
        circleFilter = 'AND e.circle_id = ?';
        params.push(circleId);
    }
    return db.all(`
        SELECT e.*,
            CASE WHEN e.type IN ('ANONYMOUS_CONSULTATION', 'CONSULT') THEN NULL ELSE p.username END AS patient_username
        FROM escalation_deliveries d
        JOIN escalations e ON e.escalation_id = d.escalation_id
        JOIN care_circles c ON e.circle_id = c.circle_id
        JOIN users p ON c.primary_patient_id = p.user_id
        WHERE d.user_id = ? AND d.role = 'doctor' AND d.status != 'failed' AND d.acknowledged_at IS NULL ${circleFilter}
        ORDER BY e.timestamp ASC
    `, params);
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

/**
 * Remove a pending action.
 * @returns {Promise<boolean>} True if this call removed it (false if it was already gone),
 *   so a caller can use the removal to claim the action exactly once
 */
export async function removePendingAction(actionId) {
    const db = await getDb();
    const result = await db.run('DELETE FROM pending_actions WHERE action_id = ?', [actionId]);
    return result.changes > 0;
}


/**
 * A patient's current consent to emergency alerts being sent when they do not answer.
 * @returns {Promise<{user_id: string, delay_ms: number, consented_at: number}|null>} Null when not consented or revoked
 */
export async function getEmergencyAutoAlertConsent(userId) {
    const db = await getDb();
    const row = await db.get('SELECT * FROM emergency_auto_alert_consent WHERE user_id = ? AND revoked_at IS NULL', [userId]);
    return row ?? null;
}

/**
 * Give or revoke a patient's consent. Giving it again replaces the delay and time.
 * @param {string} userId
 * @param {boolean} enabled
 * @param {number} delayMs - The wait the patient consented to
 */
export async function setEmergencyAutoAlertConsent(userId, enabled, delayMs) {
    const db = await getDb();
    const now = Date.now();
    if (enabled) {
        await db.run(
            `INSERT INTO emergency_auto_alert_consent (user_id, delay_ms, consented_at, revoked_at) VALUES (?, ?, ?, NULL)
             ON CONFLICT(user_id) DO UPDATE SET delay_ms = excluded.delay_ms, consented_at = excluded.consented_at, revoked_at = NULL`,
            [userId, delayMs, now]
        );
    } else {
        await db.run('UPDATE emergency_auto_alert_consent SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [now, userId]);
    }
}

/**
 * Open alert proposals whose automatic send time has passed.
 * @param {number} now
 */
export async function getDueAutoSendProposals(now) {
    const db = await getDb();
    const rows = await db.all("SELECT * FROM pending_actions WHERE action_type = 'escalation_proposal'");
    return rows
        .map(row => ({ ...row, details: JSON.parse(row.details) }))
        .filter(row => row.details.autoSendAt && row.details.autoSendAt <= now);
}
