/**
 * @fileoverview tests/integration_auth.test.js
 * Tests for the HealthyMitra integration routes: signed requests (signature, expiry,
 * replay, purpose, key rotation, rate limit), no user sessions, and idempotent
 * provisioning of one identity and one private conversation per HealthyMitra user.
 *
 * Run with: node --test --test-force-exit tests/integration_auth.test.js
 * Uses an in-memory database and a local HTTP server; no LLM calls are made.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import express from 'express';

const KEY = 'test-current-key';
const PATH = '/api/integrations/healthymitra/conversations';

let db, server, baseUrl, signRequest, resetServiceKeys, resetRateLimits;

before(async () => {
    process.env.SERVICE_SECRETS_SOURCE = 'env';
    const { setGlobalDb } = await import('../db/index.js');
    const { initializeDatabase } = await import('../db/schema.js');
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    setGlobalDb(db);
    await initializeDatabase();

    ({ signRequest } = await import('../lib/serviceAuth.js'));
    ({ resetServiceKeys } = await import('../lib/serviceSecrets.js'));
    const serviceAuth = await import('../middleware/serviceAuth.js');
    resetRateLimits = serviceAuth.resetRateLimits;
    const { default: integrationsRouter } = await import('../routes/integrations.js');

    const app = express();
    app.use(express.json({ verify: serviceAuth.captureRawBody }));
    app.use('/api/integrations/healthymitra', integrationsRouter);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

beforeEach(async () => {
    process.env.HEALTHYMITRA_TO_AI_SECRET = KEY;
    delete process.env.HEALTHYMITRA_TO_AI_SECRET_PREVIOUS;
    delete process.env.INTEGRATION_RATE_LIMIT_PER_MINUTE;
    resetServiceKeys();
    resetRateLimits();
    for (const table of ['integration_request_ids', 'integration_idempotency', 'conversations', 'external_identities']) {
        await db.run(`DELETE FROM ${table}`);
    }
    await db.run("DELETE FROM users WHERE user_id LIKE 'hm_%'");
});

/**
 * Send a provisioning request. `sign` overrides what is signed, `send` what is sent.
 */
async function provision({ user = 'hm-user-1', displayName = 'Asha', key = KEY, idempotencyKey = 'idem-0001', sign = {}, send = {}, headers = {} } = {}) {
    const body = JSON.stringify({ displayName });
    const signed = signRequest(key, { method: 'POST', path: PATH, userId: user, purpose: 'conversation.provision', body, ...sign });
    const res = await fetch(baseUrl + (send.path ?? PATH), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, ...signed, ...headers },
        body: send.body ?? body
    });
    return { status: res.status, body: await res.json() };
}

test('a signed request provisions one identity and one conversation', async () => {
    const first = await provision();
    assert.equal(first.status, 201);
    assert.match(first.body.conversationId, /^conv_/);
    assert.equal(first.body.created, true);

    const again = await provision({ idempotencyKey: 'idem-0002' });
    assert.equal(again.status, 200, 'a new key for the same user finds the same conversation');
    assert.equal(again.body.conversationId, first.body.conversationId);

    const identity = await db.get("SELECT * FROM external_identities WHERE external_user_id = 'hm-user-1'");
    assert.equal(identity.provider, 'healthymitra');
    assert.equal((await db.get('SELECT username FROM users WHERE user_id = ?', [identity.user_id])).username, 'Asha');
});

test('concurrent first requests create one user and one conversation', async () => {
    const results = await Promise.all([1, 2, 3].map(n => provision({ idempotencyKey: `idem-con${n}` })));
    assert.equal(new Set(results.map(r => r.body.conversationId)).size, 1);
    assert.equal(results.filter(r => r.status === 201).length, 1);
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM external_identities')).n, 1);
    assert.equal((await db.get("SELECT COUNT(*) AS n FROM users WHERE user_id LIKE 'hm_%'")).n, 1);
});

test('a repeated idempotency key returns the first response, and only for the same user', async () => {
    const first = await provision();
    const repeat = await provision();
    assert.deepEqual(repeat, first);
    const other = await provision({ user: 'hm-user-2' });
    assert.equal(other.status, 422);
    assert.equal(other.body.error.code, 'idempotency_key_reused');
});

test('the same display name for two users is only a label', async () => {
    await provision({ user: 'hm-a', idempotencyKey: 'idem-aaaa' });
    await provision({ user: 'hm-b', idempotencyKey: 'idem-bbbb' });
    const names = (await db.all("SELECT username FROM users WHERE user_id LIKE 'hm_%' ORDER BY username")).map(r => r.username);
    assert.deepEqual(names, ['Asha', 'Asha 2']);
});

test('unsigned, mis-signed, expired, replayed and wrong-purpose requests are rejected', async () => {
    const unsigned = await fetch(baseUrl + PATH, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem-0001', Authorization: 'Bearer tok-pat' }, body: '{}' });
    assert.equal(unsigned.status, 401, 'a user session token is not accepted');
    assert.equal((await unsigned.json()).error.code, 'unsigned_request');

    assert.equal((await provision({ key: 'wrong-key' })).body.error.code, 'invalid_signature');
    assert.equal((await provision({ send: { body: JSON.stringify({ displayName: 'Mallory' }) } })).body.error.code, 'invalid_signature', 'the body is covered');
    assert.equal((await provision({ headers: { 'X-HM-User-Id': 'hm-user-2' } })).body.error.code, 'invalid_signature', 'the user is covered');
    assert.equal((await provision({ sign: { timestamp: Date.now() - 6 * 60 * 1000 } })).body.error.code, 'expired_request');
    assert.equal((await provision({ sign: { purpose: 'conversation.history' } })).body.error.code, 'purpose_mismatch');

    const requestId = 'fixed-request-id';
    assert.equal((await provision({ sign: { requestId } })).status, 201);
    const replay = await provision({ sign: { requestId }, idempotencyKey: 'idem-0009' });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.error.code, 'replayed_request');
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM conversations')).n, 1);
});

test('during a rotation both keys verify; without keys the routes are closed', async () => {
    process.env.HEALTHYMITRA_TO_AI_SECRET = 'new-key';
    process.env.HEALTHYMITRA_TO_AI_SECRET_PREVIOUS = KEY;
    resetServiceKeys();
    assert.equal((await provision({ key: KEY })).status, 201, 'the previous key still works');
    assert.equal((await provision({ key: 'new-key', idempotencyKey: 'idem-0002' })).status, 200);

    delete process.env.HEALTHYMITRA_TO_AI_SECRET;
    delete process.env.HEALTHYMITRA_TO_AI_SECRET_PREVIOUS;
    resetServiceKeys();
    const closed = await provision({ idempotencyKey: 'idem-0003' });
    assert.equal(closed.status, 503);
    assert.equal(closed.body.error.code, 'not_configured');
});

test('requests are rate limited per HealthyMitra user', async () => {
    process.env.INTEGRATION_RATE_LIMIT_PER_MINUTE = '2';
    assert.equal((await provision({ idempotencyKey: 'idem-r001' })).status, 201);
    assert.equal((await provision({ idempotencyKey: 'idem-r002' })).status, 200);
    const limited = await provision({ idempotencyKey: 'idem-r003' });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'rate_limited');
    assert.equal((await provision({ user: 'hm-other', idempotencyKey: 'idem-r004' })).status, 201, 'another user has their own limit');
});

test('a missing idempotency key and unknown routes are rejected', async () => {
    const missing = await provision({ idempotencyKey: '' });
    assert.equal(missing.status, 400);
    const unknown = await provision({ send: { path: '/api/integrations/healthymitra/nope' }, sign: { path: '/api/integrations/healthymitra/nope' } });
    assert.equal(unknown.status, 404);
});
