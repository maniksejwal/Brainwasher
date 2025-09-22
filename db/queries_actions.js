/**
 * @fileoverview db/queries_actions.js
 * This file contains all database query functions related to actions,
 * consent, and escalations. It manages the logic for creating and resolving
 * pending actions, setting consent levels, and logging critical events for doctors.
 */

import { getDb } from './connection.js';

export async function addEscalation(circleId, type, details) {
    const db = await getDb();
    await db.run('INSERT INTO escalations (circle_id, type, details, timestamp) VALUES (?, ?, ?, ?)', [circleId, type, details, Date.now()]);
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

// ** NEW: Fetches ALL active pending actions for a user in a circle **
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

