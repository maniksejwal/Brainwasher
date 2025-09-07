import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;

async function initializeDatabase() {
    db = await open({
        filename: './care_circle.db',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            content TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS facts (
            key TEXT PRIMARY KEY,
            reported_by TEXT,
            value TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS user_consent (
            user_id TEXT,
            target_user_id TEXT,
            relationship_type TEXT DEFAULT 'other',
            closeness_score INTEGER DEFAULT 5,
            consent_level TEXT,
            PRIMARY KEY (user_id, target_user_id)
        );
        CREATE TABLE IF NOT EXISTS pending_actions (
            user_id TEXT PRIMARY KEY,
            action_type TEXT,
            payload TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
     console.log('Database initialized successfully.');
}

// ... (addUser, getUsers, addMessage, etc. are unchanged)
async function addUser(userId) {
    await db.run('INSERT OR IGNORE INTO users (id) VALUES (?)', userId);
}

async function getUsers() {
    const rows = await db.all('SELECT id FROM users');
    return rows.map(row => row.id);
}

async function addMessage(userId, content) {
    await db.run('INSERT INTO messages (user_id, content) VALUES (?, ?)', userId, content);
}

async function getConversationHistory(limit = 20) {
    return await db.all(`
        SELECT user_id, content, timestamp 
        FROM messages 
        WHERE user_id != 'doctor'
        ORDER BY timestamp DESC 
        LIMIT ?`, limit);
}


async function upsertFact(key, reportedBy, value) {
    await db.run(`
        INSERT INTO facts (key, reported_by, value, timestamp) 
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
        reported_by = excluded.reported_by,
        value = excluded.value,
        timestamp = excluded.timestamp
    `, key, reportedBy, value);
}


async function getFact(key) {
    return await db.get('SELECT * FROM facts WHERE key = ?', key);
}

async function updateUserConsent(userId, targetUserId, level) {
    await db.run(`
        INSERT INTO user_consent (user_id, target_user_id, consent_level) VALUES (?, ?, ?)
        ON CONFLICT(user_id, target_user_id) DO UPDATE SET consent_level = excluded.consent_level
    `, userId, targetUserId, level);
}

async function updateRelationship(userId, targetUserId, relationshipType, closenessScore) {
    await db.run(`
        INSERT INTO user_consent (user_id, target_user_id, relationship_type, closeness_score) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, target_user_id) DO UPDATE SET 
            relationship_type = excluded.relationship_type,
            closeness_score = excluded.closeness_score
    `, userId, targetUserId, relationshipType, closenessScore);
}


async function getConsentLevel(fromUser, toUser) {
    const result = await db.get('SELECT consent_level FROM user_consent WHERE user_id = ? AND target_user_id = ?', fromUser, toUser);
    return result?.consent_level || 'none'; // Default to 'none' if not set
}


async function clearAllData() {
    await db.exec('DELETE FROM users; DELETE FROM messages; DELETE FROM facts; DELETE FROM user_consent; DELETE FROM pending_actions;');
}


// --- New functions for Per-Message Consent ---
async function createPendingAction(userId, actionType, payload) {
    await db.run(
        'INSERT OR REPLACE INTO pending_actions (user_id, action_type, payload) VALUES (?, ?, ?)',
        userId, actionType, JSON.stringify(payload)
    );
}

async function getPendingAction(userId) {
    const row = await db.get('SELECT * FROM pending_actions WHERE user_id = ?', userId);
    if (row) {
        return {
            actionType: row.action_type,
            payload: JSON.parse(row.payload)
        };
    }
    return null;
}

async function deletePendingAction(userId) {
    await db.run('DELETE FROM pending_actions WHERE user_id = ?', userId);
}


export { 
    initializeDatabase, 
    addUser, 
    getUsers,
    addMessage, 
    upsertFact, 
    getFact, 
    updateUserConsent, 
    getConsentLevel,
    getConversationHistory,
    updateRelationship,
    clearAllData,
    createPendingAction,
    getPendingAction,
    deletePendingAction
};

