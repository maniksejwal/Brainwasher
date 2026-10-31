/**
 * @fileoverview tests/auth_middleware.test.js
 * Tests that the API acts only as the signed-in user: session checks, own-data and
 * circle-membership checks, stream tokens, and which roles a login may choose.
 *
 * Run with: node --test --test-force-exit tests/auth_middleware.test.js
 * Uses an in-memory database and a local HTTP server; no LLM calls are made.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import express from 'express';

let db;
let server;
let baseUrl;
let mayHoldRole;

before(async () => {
    const { setGlobalDb } = await import('../db/index.js');
    const { initializeDatabase } = await import('../db/schema.js');
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    setGlobalDb(db);
    await initializeDatabase();

    const now = Date.now();
    for (const [id, name] of [['p1', 'pat'], ['p2', 'sam'], ['a1', 'root']]) {
        await db.run('INSERT INTO users (user_id, username, created_at) VALUES (?, ?, ?)', [id, name, now]);
    }
    await db.run("INSERT INTO care_circles (circle_id, primary_patient_id, created_at) VALUES ('c1', 'p1', ?)", [now]);
    await db.run("INSERT INTO care_circle_members (circle_id, user_id, role) VALUES ('c1', 'p1', 'patient')");
    await db.run("INSERT INTO system_roles (user_id, role, permissions, created_at) VALUES ('a1', 'admin', '[\"*\"]', ?)", [now]);
    for (const [token, userId, expires] of [['tok-pat', 'p1', now + 60000], ['tok-sam', 'p2', now + 60000], ['tok-root', 'a1', now + 60000], ['tok-old', 'p1', now - 1]]) {
        await db.run('INSERT INTO sessions (session_id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', [token, userId, token, expires, now]);
    }

    const { authenticate, authenticateStream, authorize, requireSelf, requireCircleMember } = await import('../middleware/auth.js');
    ({ mayHoldRole } = await import('../routes/auth.js'));
    const { default: coreRouter } = await import('../routes/core.js');

    const app = express();
    app.use(express.json());
    const ok = (req, res) => res.json({ userId: req.user.userId, body: req.body });
    app.get('/self/:userId', authenticate, requireSelf(), ok);
    app.get('/stream/:userId', authenticateStream, requireSelf(), ok);
    app.get('/header-only', authenticate, ok);
    app.post('/member', authenticate, requireCircleMember, ok);
    app.get('/logs', authenticate, authorize('logs:view'), ok);
    app.use('/', coreRouter);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

beforeEach(() => {
    delete process.env.ALLOW_SELF_ASSIGNED_ROLES;
    delete process.env.ADMIN_USERNAMES;
    delete process.env.REVIEWER_USERNAMES;
});

const call = (path, { token, method = 'GET', body } = {}) => fetch(`${baseUrl}${path}`, {
    method,
    headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
});

test('requests need a valid, unexpired session', async () => {
    assert.equal((await call('/self/p1')).status, 401);
    assert.equal((await call('/self/p1', { token: 'nope' })).status, 401);
    assert.equal((await call('/self/p1', { token: 'tok-old' })).status, 401);
    assert.equal((await call('/self/p1', { token: 'tok-pat' })).status, 200);
});

test('a user can read only their own data; an admin can read anyone\'s', async () => {
    assert.equal((await call('/self/p1', { token: 'tok-sam' })).status, 403);
    assert.equal((await call('/self/p1', { token: 'tok-root' })).status, 200);
});

test('streams accept the token as a query parameter; other routes do not', async () => {
    assert.equal((await call('/stream/p1?token=tok-pat')).status, 200);
    assert.equal((await call('/stream/p1?token=tok-sam')).status, 403, 'not your own stream');
    assert.equal((await call('/header-only?token=tok-pat')).status, 401);
});

test('a sender must be the signed-in user and a member of the circle', async () => {
    assert.equal((await call('/member', { token: 'tok-pat', method: 'POST', body: { circleId: 'c1' } })).status, 200);
    assert.equal((await call('/member', { token: 'tok-pat', method: 'POST', body: { circleId: 'c1', userId: 'p2' } })).status, 403, 'cannot send as someone else');
    assert.equal((await call('/member', { token: 'tok-sam', method: 'POST', body: { circleId: 'c1' } })).status, 403, 'not a member');
    assert.equal((await call('/member', { token: 'tok-pat', method: 'POST', body: {} })).status, 400);
});

test('server logs are for admins only', async () => {
    assert.equal((await call('/logs', { token: 'tok-pat' })).status, 403);
    assert.equal((await call('/logs', { token: 'tok-root' })).status, 200);
});

test('the core routes reject unauthenticated and cross-user requests', async () => {
    assert.equal((await call('/send', { method: 'POST', body: { circleId: 'c1', message: 'hi' } })).status, 401);
    assert.equal((await call('/send', { token: 'tok-sam', method: 'POST', body: { circleId: 'c1', message: 'hi' } })).status, 403);
    assert.equal((await call('/command', { token: 'tok-pat', method: 'POST', body: { circleId: 'c1', userId: 'p2', message: '/help' } })).status, 403);
    assert.equal((await call('/doctor/escalations/unread/p1', { token: 'tok-sam' })).status, 403);
    assert.equal((await call('/doctor/escalations/unread/p1', { token: 'tok-pat' })).status, 200);
    assert.equal((await call('/api/prompts', { token: 'tok-pat' })).status, 403);
    assert.equal((await call('/login', { method: 'POST', body: { username: 'pat' } })).status, 404, 'the username-only login without a session is removed');
});

test('a proposal can be decided only by its own user, and only with a boolean', async () => {
    await db.run("INSERT INTO pending_actions (action_id, circle_id, user_id, action_type, details, created_at) VALUES ('esc_x', 'c1', 'p1', 'escalation_proposal', ?, ?)",
        [JSON.stringify({ type: 'CRITICAL', details: 'd', recipients: [], expiresAt: Date.now() + 60000 }), Date.now()]);
    assert.equal((await call('/api/escalation-proposals/esc_x/decision', { token: 'tok-pat', method: 'POST', body: { accept: 'yes' } })).status, 400);
    assert.equal((await call('/api/escalation-proposals/esc_x/decision', { token: 'tok-sam', method: 'POST', body: { accept: false } })).status, 404);
    const own = await call('/api/escalation-proposals/esc_x/decision', { token: 'tok-pat', method: 'POST', body: { accept: false } });
    assert.equal(own.status, 200);
    assert.equal((await own.json()).status, 'rejected');
    assert.equal((await call('/api/escalation-proposals/esc_x/decision', { token: 'tok-pat', method: 'POST', body: { accept: true } })).status, 404, 'decided once');
});

test('admin and reviewer roles cannot be chosen at login unless granted', () => {
    assert.equal(mayHoldRole('pat', 'user'), true);
    assert.equal(mayHoldRole('pat', 'doctor'), true);
    assert.equal(mayHoldRole('pat', 'admin'), false);
    assert.equal(mayHoldRole('pat', 'reviewer'), false);

    process.env.ADMIN_USERNAMES = 'root, Ops';
    assert.equal(mayHoldRole('ops', 'admin'), true);
    assert.equal(mayHoldRole('pat', 'admin'), false);
    assert.equal(mayHoldRole('ops', 'reviewer'), false, 'admin listing does not grant reviewer');

    process.env.ALLOW_SELF_ASSIGNED_ROLES = 'true';
    assert.equal(mayHoldRole('pat', 'admin'), true);
});
