/**
 * @fileoverview db/queries_users.js
 * This file contains all database query functions related to users and care circles.
 * It handles creating, finding, and managing user accounts and their memberships in various circles.
 */

import { getDb } from './connection.js';

export async function findUserByUsername(username) {
    const db = await getDb();
    // Case-insensitive username lookup
    return db.get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username]);
}

export async function findUserById(userId) {
    const db = await getDb();
    return db.get('SELECT * FROM users WHERE user_id = ?', [userId]);
}

export async function findCircleByPatientId(patientId) {
    const db = await getDb();
    const circle = await db.get('SELECT * FROM care_circles WHERE primary_patient_id = ?', [patientId]);
    if (circle) {
        return circle;
    }
    // Fallback: caller may have provided a circle_id instead of patient_id
    return db.get('SELECT * FROM care_circles WHERE circle_id = ?', [patientId]);
}

export async function findCircleById(circleId) {
    const db = await getDb();
    return db.get('SELECT * FROM care_circles WHERE circle_id = ?', [circleId]);
}

export async function findCircleByPatientUsername(patientUsername) {
    const db = await getDb();
    const patient = await findUserByUsername(patientUsername);
    if (!patient) return null;
    return findCircleByPatientId(patient.user_id);
}


export async function addUser(userId, username) {
    const db = await getDb();
    await db.run('INSERT OR IGNORE INTO users (user_id, username, created_at) VALUES (?, ?, ?)', [userId, username, Date.now()]);
}

export async function createCareCircle(circleId, patientId) {
    const db = await getDb();
    await db.run('INSERT OR IGNORE INTO care_circles (circle_id, primary_patient_id, created_at) VALUES (?, ?, ?)', [circleId, patientId, Date.now()]);
    await addMemberToCircle(circleId, patientId, 'patient', 'self');
}

export async function addMemberToCircle(circleId, userId, role, relationship) {
    const db = await getDb();
    const defaultState = JSON.stringify({ state: 'IDLE' });
    await db.run(
        'INSERT OR IGNORE INTO care_circle_members (circle_id, user_id, role, relationship_type, session_state) VALUES (?, ?, ?, ?, ?)',
        [circleId, userId, role, relationship, defaultState]
    );
}

export async function updateMemberRelationship(circleId, userId, relationship) {
    const db = await getDb();
    await db.run('UPDATE care_circle_members SET relationship_type = ? WHERE circle_id = ? AND user_id = ?', [relationship, circleId, userId]);
}

// NEW: Function to update a member's role in a circle.
export async function updateMemberRole(circleId, userId, newRole) {
    const db = await getDb();
    await db.run('UPDATE care_circle_members SET role = ? WHERE circle_id = ? AND user_id = ?', [newRole, circleId, userId]);
}


export async function getMemberInfo(userId, circleId) {
    const db = await getDb();
    return db.get('SELECT * FROM care_circle_members WHERE user_id = ? AND circle_id = ?', [userId, circleId]);
}

export async function getCircleMembers(circleId) {
    const db = await getDb();
    return db.all(`
        SELECT m.user_id, m.role, m.relationship_type, m.consent_level, u.username
        FROM care_circle_members m
        JOIN users u ON m.user_id = u.user_id
        WHERE m.circle_id = ?
    `, [circleId]);
}

export async function getUserCircles(userId) {
    const db = await getDb();
    return db.all(`
        SELECT 
            c.circle_id, 
            c.primary_patient_id, 
            p.username as patient_username, 
            m.role, 
            m.relationship_type,
            m.consent_level
        FROM care_circle_members m
        JOIN care_circles c ON m.circle_id = c.circle_id
        JOIN users p ON c.primary_patient_id = p.user_id
        WHERE m.user_id = ?
        ORDER BY c.primary_patient_id
    `, [userId]);
}

export async function updateUserState(userId, circleId, newState) {
    const db = await getDb();
    const currentStateRaw = await db.get('SELECT session_state FROM care_circle_members WHERE user_id = ? AND circle_id = ?', [userId, circleId]);
    const currentState = currentStateRaw ? JSON.parse(currentStateRaw.session_state) : {};
    const updatedState = { ...currentState, ...newState };
    await db.run('UPDATE care_circle_members SET session_state = ? WHERE user_id = ? AND circle_id = ?', [JSON.stringify(updatedState), userId, circleId]);
}

export async function getUserState(userId, circleId) {
    const db = await getDb();
    const row = await db.get('SELECT session_state FROM care_circle_members WHERE user_id = ? AND circle_id = ?', [userId, circleId]);
    return row ? JSON.parse(row.session_state) : { state: 'IDLE' };
}

/**
 * Find a member in any circle shared with the requesting user
 * Used for Cross-Circle Entity Resolution (Bridging)
 */
export async function findMemberInSharedCircles(targetUsername, requestingUserId) {
    const db = await getDb();
    return db.get(`
        SELECT u.username, u.user_id, m.circle_id, m.role, m.relationship_type, c.primary_patient_id
        FROM users u
        JOIN care_circle_members m ON u.user_id = m.user_id
        JOIN care_circles c ON m.circle_id = c.circle_id
        WHERE u.username = ? COLLATE NOCASE
        AND m.circle_id IN (
            SELECT circle_id FROM care_circle_members WHERE user_id = ?
        )
        LIMIT 1
    `, [targetUsername, requestingUserId]);
}

/**
 * Get user profile data (demographics, etc.)
 */
export async function getUserProfile(userId) {
    const db = await getDb();
    const row = await db.get('SELECT profile_data FROM users WHERE user_id = ?', [userId]);
    try {
        return row?.profile_data ? JSON.parse(row.profile_data) : {};
    } catch (e) {
        return {};
    }
}

/**
 * Update user profile data (merges with existing)
 */
export async function updateUserProfile(userId, data) {
    const db = await getDb();
    const current = await getUserProfile(userId);
    const updated = { ...current, ...data };
    await db.run('UPDATE users SET profile_data = ? WHERE user_id = ?', [JSON.stringify(updated), userId]);
}

/**
 * Get user global preferences
 */
export async function getUserPreferences(userId) {
    const db = await getDb();
    const row = await db.get('SELECT preferences FROM users WHERE user_id = ?', [userId]);
    try {
        return row?.preferences ? JSON.parse(row.preferences) : {};
    } catch (e) {
        return {};
    }
}

/**
 * Update user global preferences (merges with existing)
 */
export async function updateUserPreferences(userId, data) {
    const db = await getDb();
    const current = await getUserPreferences(userId);
    const updated = { ...current, ...data };
    await db.run('UPDATE users SET preferences = ? WHERE user_id = ?', [JSON.stringify(updated), userId]);
}

