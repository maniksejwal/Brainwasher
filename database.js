import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;

async function initializeDatabase() {
  db = await open({
    filename: './carecircle.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      userId TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS facts (
      factKey TEXT,
      userId TEXT,
      factValue BOOLEAN,
      PRIMARY KEY (factKey, userId)
    );
    CREATE TABLE IF NOT EXISTS messages (
        messageId INTEGER PRIMARY KEY AUTOINCREMENT,
        recipientId TEXT,
        content TEXT,
        isRead BOOLEAN DEFAULT 0
    );
    -- New tables for Consent Manager and Escalations
    CREATE TABLE IF NOT EXISTS relationships (
        patientId TEXT NOT NULL,
        caregiverId TEXT NOT NULL,
        relationshipType TEXT,
        consentLevel TEXT, -- e.g., 'full', 'limited', 'none'
        PRIMARY KEY (patientId, caregiverId)
    );
    CREATE TABLE IF NOT EXISTS escalations (
        escalationId INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        isRead BOOLEAN DEFAULT 0
    );
  `);

  console.log('[Database] Connected and tables are ready.');
  return db;
}

// --- New Function for Testing ---
async function resetDatabase() {
    await db.exec('DELETE FROM users');
    await db.exec('DELETE FROM facts');
    await db.exec('DELETE FROM messages');
    await db.exec('DELETE FROM relationships');
    await db.exec('DELETE FROM escalations');
    console.log('[Database] All tables have been reset.');
}


// --- User Functions ---
async function addUser(userId) {
  return db.run('INSERT OR IGNORE INTO users (userId) VALUES (?)', userId);
}
async function userExists(userId) {
    const user = await db.get('SELECT 1 FROM users WHERE userId = ?', userId);
    return !!user;
}
async function getAllUsers() {
    return db.all('SELECT userId FROM users');
}


// --- Fact Functions ---
async function getFact(factKey) {
  return db.all('SELECT userId, factValue FROM facts WHERE factKey = ?', factKey);
}

async function upsertFact(factKey, userId, factValue) {
  return db.run(
    'INSERT INTO facts (factKey, userId, factValue) VALUES (?, ?, ?) ON CONFLICT(factKey, userId) DO UPDATE SET factValue = ?',
    [factKey, userId, factValue, factValue] // Corrected 'value' to 'factValue'
  );
}

// --- Message Queue Functions ---
async function addMessageToQueue(recipientId, content) {
    return db.run('INSERT INTO messages (recipientId, content) VALUES (?, ?)', [recipientId, content]);
}

async function getMessagesForUser(userId) {
    const messages = await db.all('SELECT messageId, content FROM messages WHERE recipientId = ? AND isRead = 0', userId);
    // Mark messages as read after fetching
    if (messages.length > 0) {
        const ids = messages.map(m => m.messageId);
        await db.run(`UPDATE messages SET isRead = 1 WHERE messageId IN (${ids.join(',')})`);
    }
    return messages.map(m => m.content);
}

// --- New Relationship (Consent) Functions ---
async function setRelationship(patientId, caregiverId, relationshipType, consentLevel) {
    return db.run(
        `INSERT INTO relationships (patientId, caregiverId, relationshipType, consentLevel) VALUES (?, ?, ?, ?)
         ON CONFLICT(patientId, caregiverId) DO UPDATE SET relationshipType = ?, consentLevel = ?`,
        [patientId, caregiverId, relationshipType, consentLevel, relationshipType, consentLevel]
    );
}

async function getRelationship(patientId, caregiverId) {
    return db.get('SELECT consentLevel FROM relationships WHERE patientId = ? AND caregiverId = ?', [patientId, caregiverId]);
}


// --- New Escalation Functions ---
async function addEscalation(content) {
    return db.run('INSERT INTO escalations (content) VALUES (?)', content);
}

async function getEscalations() {
    const items = await db.all('SELECT escalationId, content, timestamp FROM escalations WHERE isRead = 0');
    if (items.length > 0) {
        const ids = items.map(i => i.escalationId);
        await db.run(`UPDATE escalations SET isRead = 1 WHERE escalationId IN (${ids.join(',')})`);
    }
    return items;
}

// --- Consolidated Exports ---
export {
    db,
    initializeDatabase,
    resetDatabase,
    addUser,
    userExists,
    getAllUsers,
    getFact,
    upsertFact,
    addMessageToQueue,
    getMessagesForUser,
    setRelationship,
    getRelationship,
    addEscalation,
    getEscalations
};

