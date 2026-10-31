/**
 * @fileoverview db/queries_integrations.js
 * Queries for the HealthyMitra integration: seen request IDs (replay protection),
 * external identities, private conversations and idempotency records.
 */
import { getDb } from './connection.js';

// Request IDs are kept a little longer than the accepted request age
export const REQUEST_ID_RETENTION_MS = 10 * 60 * 1000;
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Record a request ID.
 * @returns {Promise<boolean>} False if it was already used within the retention period
 */
export async function recordIntegrationRequestId(requestId, now = Date.now()) {
    const db = await getDb();
    await db.run('DELETE FROM integration_request_ids WHERE received_at < ?', [now - REQUEST_ID_RETENTION_MS]);
    const result = await db.run('INSERT OR IGNORE INTO integration_request_ids (request_id, received_at) VALUES (?, ?)', [requestId, now]);
    return result.changes > 0;
}

export async function findExternalIdentity(provider, externalUserId) {
    const db = await getDb();
    return db.get('SELECT * FROM external_identities WHERE provider = ? AND external_user_id = ?', [provider, externalUserId]);
}

/**
 * Link an external user to a local user. An existing link is kept.
 * @returns {Promise<object>} The link that is stored
 */
export async function addExternalIdentity(provider, externalUserId, userId) {
    const db = await getDb();
    await db.run(
        'INSERT OR IGNORE INTO external_identities (provider, external_user_id, user_id, created_at) VALUES (?, ?, ?, ?)',
        [provider, externalUserId, userId, Date.now()]
    );
    return findExternalIdentity(provider, externalUserId);
}

export async function findConversationByUser(userId) {
    const db = await getDb();
    return db.get('SELECT * FROM conversations WHERE user_id = ?', [userId]);
}

export async function findConversationById(conversationId) {
    const db = await getDb();
    return db.get('SELECT * FROM conversations WHERE conversation_id = ?', [conversationId]);
}

/**
 * Create a user's single conversation unless it already exists.
 * @returns {Promise<{conversation: object, created: boolean}>}
 */
export async function addConversation(conversationId, userId) {
    const db = await getDb();
    const result = await db.run('INSERT OR IGNORE INTO conversations (conversation_id, user_id, created_at) VALUES (?, ?, ?)', [conversationId, userId, Date.now()]);
    return { conversation: await findConversationByUser(userId), created: result.changes > 0 };
}

export async function findIdempotencyRecord(key, now = Date.now()) {
    const db = await getDb();
    await db.run('DELETE FROM integration_idempotency WHERE created_at < ?', [now - IDEMPOTENCY_RETENTION_MS]);
    const row = await db.get('SELECT * FROM integration_idempotency WHERE idempotency_key = ?', [key]);
    return row ? { ...row, response: JSON.parse(row.response) } : null;
}

export async function addIdempotencyRecord(key, purpose, externalUserId, response) {
    const db = await getDb();
    await db.run(
        'INSERT OR IGNORE INTO integration_idempotency (idempotency_key, purpose, external_user_id, response, created_at) VALUES (?, ?, ?, ?, ?)',
        [key, purpose, externalUserId, JSON.stringify(response), Date.now()]
    );
}
