import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;

async function initializeDatabase() {
    db = await open({
        filename: './care_circle.db',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT UNIQUE,
            consent_level TEXT DEFAULT 'full',
            relationship_type TEXT DEFAULT 'caregiver'
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipient_id TEXT,
            message TEXT
        );

        CREATE TABLE IF NOT EXISTS facts (
            fact_key TEXT PRIMARY KEY,
            reported_by TEXT,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS escalations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            type TEXT,
            details TEXT,
            is_read INTEGER DEFAULT 0
        );
    `);
    console.log('[Database] Database initialized.');
}

async function addUser(userId) {
    return db.run('INSERT OR IGNORE INTO users (user_id) VALUES (?)', userId);
}

async function getUsers() {
    return db.all('SELECT user_id FROM users');
}

async function addMessage(recipientId, message) {
    return db.run('INSERT INTO messages (recipient_id, message) VALUES (?, ?)', recipientId, message);
}

async function getMessagesForUser(recipientId) {
    const rows = await db.all('SELECT message FROM messages WHERE recipient_id = ?', recipientId);
    return rows.map(r => r.message);
}

async function clearUserMessages(recipientId) {
    return db.run('DELETE FROM messages WHERE recipient_id = ?', recipientId);
}

async function upsertFact(factKey, userId, factValue) {
    return db.run(
        'INSERT INTO facts (fact_key, reported_by, value) VALUES (?, ?, ?) ON CONFLICT(fact_key) DO UPDATE SET reported_by = excluded.reported_by, value = excluded.value',
        [factKey, userId, factValue]
    );
}

async function getFact(factKey) {
    return db.get('SELECT * FROM facts WHERE fact_key = ?', factKey);
}

async function addEscalation(type, details) {
    const result = await db.run('INSERT INTO escalations (type, details) VALUES (?, ?)', type, details);
    return db.get('SELECT * FROM escalations WHERE id = ?', result.lastID);
}


async function getUnreadEscalations() {
    const rows = await db.all('SELECT * FROM escalations WHERE is_read = 0 ORDER BY timestamp ASC');
    return rows;
}

async function markEscalationsAsRead(ids) {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    return db.run(`UPDATE escalations SET is_read = 1 WHERE id IN (${placeholders})`, ids);
}


async function clearAllData() {
    await db.exec('DELETE FROM users; DELETE FROM messages; DELETE FROM facts; DELETE FROM escalations;');
}

export {
    initializeDatabase,
    addUser,
    getUsers,
    addMessage,
    getMessagesForUser,
    clearUserMessages,
    upsertFact,
    getFact,
    addEscalation,
    getUnreadEscalations,
    markEscalationsAsRead,
    clearAllData
};

