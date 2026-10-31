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

/**
 * Save a user's message once per request ID.
 * @returns {Promise<{message: object, created: boolean}>} The stored message (the first one
 *   for a repeated request ID)
 */
export async function addUserConversationMessage({ messageId, conversationId, requestId, circleId, text, jobId }) {
    const db = await getDb();
    const result = await db.run(
        `INSERT OR IGNORE INTO conversation_messages (message_id, conversation_id, sender, request_id, circle_id, text, job_id, created_at)
         VALUES (?, ?, 'user', ?, ?, ?, ?, ?)`,
        [messageId, conversationId, requestId, circleId, text, jobId, Date.now()]
    );
    const message = await db.get('SELECT * FROM conversation_messages WHERE conversation_id = ? AND request_id = ?', [conversationId, requestId]);
    return { message, created: result.changes > 0 };
}

export async function addAgentConversationMessage({ messageId, conversationId, circleId, text, proposal = null, source = null, jobId = null }) {
    const db = await getDb();
    await db.run(
        `INSERT INTO conversation_messages (message_id, conversation_id, sender, circle_id, text, proposal, source, job_id, created_at)
         VALUES (?, ?, 'agent', ?, ?, ?, ?, ?, ?)`,
        [messageId, conversationId, circleId, text, proposal ? JSON.stringify(proposal) : null, source, jobId, Date.now()]
    );
}

/**
 * One page of a conversation, oldest first, with each user message's job and the HealthyMitra
 * ID of the patient the message was about.
 * @param {string} conversationId
 * @param {{after?: number, before?: number, limit: number}} page - Neither cursor: the latest page
 */
export async function getConversationMessages(conversationId, { after = null, before = null, limit }) {
    const db = await getDb();
    const select = `
        SELECT m.*, j.status AS job_status, ei.external_user_id AS patient_external_id
        FROM conversation_messages m
        LEFT JOIN conversation_jobs j ON j.job_id = m.job_id AND m.sender = 'user'
        LEFT JOIN care_circles c ON c.circle_id = m.circle_id
        LEFT JOIN external_identities ei ON ei.user_id = c.primary_patient_id
        WHERE m.conversation_id = ?`;
    if (after != null) {
        return db.all(`${select} AND m.message_seq > ? ORDER BY m.message_seq ASC LIMIT ?`, [conversationId, after, limit]);
    }
    const rows = before != null
        ? await db.all(`${select} AND m.message_seq < ? ORDER BY m.message_seq DESC LIMIT ?`, [conversationId, before, limit])
        : await db.all(`${select} ORDER BY m.message_seq DESC LIMIT ?`, [conversationId, limit]);
    return rows.reverse();
}

export async function hasConversationMessagesBefore(conversationId, seq) {
    const db = await getDb();
    return Boolean(await db.get('SELECT 1 FROM conversation_messages WHERE conversation_id = ? AND message_seq < ? LIMIT 1', [conversationId, seq]));
}

export async function addConversationJob({ jobId, conversationId, messageId, userId, circleId }) {
    const db = await getDb();
    await db.run(
        `INSERT OR IGNORE INTO conversation_jobs (job_id, conversation_id, message_id, user_id, circle_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'accepted', ?)`,
        [jobId, conversationId, messageId, userId, circleId, Date.now()]
    );
    return db.get('SELECT * FROM conversation_jobs WHERE job_id = ?', [jobId]);
}

/**
 * Claim the oldest accepted job whose conversation has no job in progress, so each
 * conversation's turns run one at a time and in order. A single statement, so two workers
 * can never claim the same job.
 * @returns {Promise<object|undefined>} The claimed job with its message text
 */
export async function claimNextConversationJob(now = Date.now()) {
    const db = await getDb();
    const job = await db.get(`
        UPDATE conversation_jobs SET status = 'processing', attempts = attempts + 1, started_at = ?
        WHERE job_id = (
            SELECT j.job_id FROM conversation_jobs j
            WHERE j.status = 'accepted'
              AND NOT EXISTS (SELECT 1 FROM conversation_jobs p WHERE p.conversation_id = j.conversation_id AND p.status = 'processing')
            ORDER BY j.created_at ASC, j.rowid ASC LIMIT 1
        )
        RETURNING *`, [now]);
    if (!job) return undefined;
    const message = await db.get('SELECT text FROM conversation_messages WHERE message_id = ?', [job.message_id]);
    return { ...job, text: message?.text ?? '' };
}

export async function finishConversationJob(jobId, status, error = null) {
    const db = await getDb();
    await db.run('UPDATE conversation_jobs SET status = ?, error = ?, finished_at = ? WHERE job_id = ?', [status, error, Date.now(), jobId]);
}

/**
 * After a restart: jobs left processing are retried once, then marked failed.
 * @returns {Promise<{retried: number, failed: number}>}
 */
export async function recoverInterruptedConversationJobs(maxAttempts) {
    const db = await getDb();
    const retried = await db.run("UPDATE conversation_jobs SET status = 'accepted' WHERE status = 'processing' AND attempts < ?", [maxAttempts]);
    const failed = await db.run("UPDATE conversation_jobs SET status = 'failed', error = 'interrupted', finished_at = ? WHERE status = 'processing'", [Date.now()]);
    return { retried: retried.changes, failed: failed.changes };
}

/**
 * Remove members no longer in a circle's snapshot. The patient always stays.
 */
export async function removeCircleMembersExcept(circleId, keepUserIds) {
    const db = await getDb();
    const placeholders = keepUserIds.map(() => '?').join(', ');
    await db.run(
        `DELETE FROM care_circle_members WHERE circle_id = ? AND user_id NOT IN (${placeholders})
         AND user_id != (SELECT primary_patient_id FROM care_circles WHERE circle_id = ?)`,
        [circleId, ...keepUserIds, circleId]
    );
}

/**
 * Alert proposals waiting for this user's answer, in every circle.
 */
export async function getOpenProposalsForUser(userId) {
    const db = await getDb();
    const rows = await db.all("SELECT * FROM pending_actions WHERE user_id = ? AND action_type = 'escalation_proposal' ORDER BY created_at ASC", [userId]);
    return rows.map(row => ({ ...row, details: JSON.parse(row.details) }));
}

export async function hasUnfinishedConversationJobs(conversationId) {
    const db = await getDb();
    return Boolean(await db.get("SELECT 1 FROM conversation_jobs WHERE conversation_id = ? AND status IN ('accepted', 'processing') LIMIT 1", [conversationId]));
}
