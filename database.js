import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;

async function initializeDatabase() {
  db = await open({
    filename: './carecircle.db',
    driver: sqlite3.Database
  });

  // Create tables if they don't exist
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
  `);

  console.log('[Database] Connected and tables are ready.');
  return db;
}

// --- User Functions ---
export async function addUser(userId) {
  return db.run('INSERT OR IGNORE INTO users (userId) VALUES (?)', userId);
}
export async function userExists(userId) {
    const user = await db.get('SELECT 1 FROM users WHERE userId = ?', userId);
    return !!user;
}
export async function getAllUsers() {
    return db.all('SELECT userId FROM users');
}


// --- Fact Functions ---
export async function getFact(factKey) {
  return db.all('SELECT userId, factValue FROM facts WHERE factKey = ?', factKey);
}

export async function upsertFact(factKey, userId, factValue) {
  return db.run(
    'INSERT INTO facts (factKey, userId, factValue) VALUES (?, ?, ?) ON CONFLICT(factKey, userId) DO UPDATE SET factValue = ?',
    [factKey, userId, factValue, factValue]
  );
}

// --- Message Queue Functions ---
export async function addMessageToQueue(recipientId, content) {
    return db.run('INSERT INTO messages (recipientId, content) VALUES (?, ?)', [recipientId, content]);
}

export async function getMessagesForUser(userId) {
    const messages = await db.all('SELECT messageId, content FROM messages WHERE recipientId = ? AND isRead = 0', userId);
    // Mark messages as read after fetching
    if (messages.length > 0) {
        const ids = messages.map(m => m.messageId);
        await db.run(`UPDATE messages SET isRead = 1 WHERE messageId IN (${ids.join(',')})`);
    }
    return messages.map(m => m.content);
}


export { db, initializeDatabase };
