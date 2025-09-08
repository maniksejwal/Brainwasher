import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;

async function getDb() {
    if (!db) {
        db = await open({
            filename: './care_circle.db',
            driver: sqlite3.Database
        });
    }
    return db;
}

export async function initializeDatabase() {
    const db = await getDb();
    await db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            role TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            message_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL,
            message TEXT NOT NULL,
            privacy_level TEXT NOT NULL,
            criticality_level TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS facts (
            fact_key TEXT NOT NULL,
            reported_by TEXT NOT NULL,
            value TEXT,
            timestamp INTEGER NOT NULL,
            UNIQUE(fact_key, reported_by) -- ** FIX: Added UNIQUE constraint **
        );
        
        CREATE TABLE IF NOT EXISTS escalations (
            escalation_id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            details TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            is_read INTEGER DEFAULT 0
        );
        
        CREATE TABLE IF NOT EXISTS consent (
            user_id TEXT NOT NULL,
            target_user TEXT NOT NULL,
            consent_level TEXT NOT NULL,
            relationship_type TEXT,
            PRIMARY KEY (user_id, target_user)
        );

        CREATE TABLE IF NOT EXISTS pending_actions (
            action_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            action_type TEXT NOT NULL,
            details TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS implied_consent (
            user_id TEXT NOT NULL,
            topic TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, topic)
        );
    `);
    console.log('[Database] Initialized.');
}

export async function clearDatabase() {
    const db = await getDb();
    await db.exec(`
        DELETE FROM implied_consent;
        DELETE FROM pending_actions;
        DELETE FROM consent;
        DELETE FROM escalations;
        DELETE FROM facts;
        DELETE FROM messages;
        DELETE FROM users;
    `);
    console.log('[Database] Cleared.');
}

// User Functions
export async function addUser(userId, role) {
    const db = await getDb();
    await db.run('INSERT OR IGNORE INTO users (user_id, role, created_at) VALUES (?, ?, ?)', [userId, role, Date.now()]);
}

// Message Functions
export async function addMessage(userId, role, message, privacy, criticality) {
    const db = await getDb();
    await db.run('INSERT INTO messages (user_id, role, message, privacy_level, criticality_level, timestamp) VALUES (?, ?, ?, ?, ?, ?)', [userId, role, message, privacy, criticality, Date.now()]);
}

export async function getRecentMessages(userId, limit = 5) {
    const db = await getDb();
    return db.all('SELECT user_id, message FROM messages WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?', [userId, limit]);
}


// Fact Functions
export async function upsertFact(factKey, userId, factValue) {
    const db = await getDb();
    await db.run(
        `INSERT INTO facts (fact_key, reported_by, value, timestamp) VALUES (?, ?, ?, ?)
         ON CONFLICT(fact_key, reported_by) DO UPDATE SET value = excluded.value, timestamp = excluded.timestamp`, // ** FIX: Use correct composite key **
        [factKey, userId, factValue, Date.now()]
    );
}


export async function getLastFact(factKey) {
    const db = await getDb();
    return db.get('SELECT * FROM facts WHERE fact_key = ? ORDER BY timestamp DESC LIMIT 1', [factKey]);
}

// Escalation Functions
export async function addEscalation(type, details) {
    const db = await getDb();
    await db.run('INSERT INTO escalations (type, details, timestamp) VALUES (?, ?, ?)', [type, details, Date.now()]);
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

// Consent Functions
export async function setUserConsent(userId, targetUser, level, relationship) {
    const db = await getDb();
    await db.run(
        'INSERT INTO consent (user_id, target_user, consent_level, relationship_type) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, target_user) DO UPDATE SET consent_level = excluded.consent_level, relationship_type = excluded.relationship_type',
        [userId, targetUser, level, relationship]
    );
}

export async function addImpliedConsent(userId, topic) {
    const db = await getDb();
    const fifteenMinutes = Date.now() + 15 * 60 * 1000;
    await db.run('INSERT INTO implied_consent (user_id, topic, expires_at) VALUES (?, ?, ?) ON CONFLICT(user_id, topic) DO UPDATE SET expires_at = excluded.expires_at', [userId, topic, fifteenMinutes]);
}

export async function getImpliedConsent(userId, topic) {
    const db = await getDb();
    return db.get('SELECT * FROM implied_consent WHERE user_id = ? AND topic = ? AND expires_at > ?', [userId, topic, Date.now()]);
}


// Pending Action Functions
export async function addPendingAction(actionId, userId, actionType, details) {
    const db = await getDb();
    await db.run('INSERT INTO pending_actions (action_id, user_id, action_type, details, created_at) VALUES (?, ?, ?, ?, ?)', [actionId, userId, actionType, JSON.stringify(details), Date.now()]);
}

export async function getPendingAction(userId) {
    const db = await getDb();
    const row = await db.get('SELECT * FROM pending_actions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId]);
    if (row) {
        row.details = JSON.parse(row.details);
    }
    return row;
}

export async function removePendingAction(actionId) {
    const db = await getDb();
    await db.run('DELETE FROM pending_actions WHERE action_id = ?', [actionId]);
}

