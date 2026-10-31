/**
 * @fileoverview tests/integration_conversation.test.js
 * Tests for HealthyMitra conversations: message submission with a context snapshot, the
 * cached circle, jobs (order, retries, failures, restart recovery), the transcript and
 * history cursors, and private history in integration turns.
 *
 * Run with: node --test --test-force-exit tests/integration_conversation.test.js
 * Uses an in-memory database, a local HTTP server and a stand-in for the message pipeline;
 * no LLM calls are made.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import express from 'express';

const KEY = 'conversation-test-key';
const BASE = '/api/integrations/healthymitra';
const PATIENT = { userId: 'hm-pat', displayName: 'Asha' };
const CAREGIVER = { userId: 'hm-cg', role: 'caregiver', displayName: 'Ravi' };
const DOCTOR = { userId: 'hm-doc', role: 'doctor', displayName: 'Dr Rao' };

let db, server, baseUrl, signRequest, events, worker, turnContext, queries;
const turns = [];
let turnBehaviour = async () => {};

// Stand-in for the message pipeline: replies to the speaker, and to the caregiver when asked
async function fakeTurn(job) {
    turns.push(job.text);
    await turnBehaviour(job);
    events.emit('broadcast', { targetUsers: [job.user_id], reply: `echo: ${job.text}`, circleId: job.circle_id });
}

before(async () => {
    process.env.SERVICE_SECRETS_SOURCE = 'env';
    process.env.HEALTHYMITRA_TO_AI_SECRET = KEY;
    process.env.INTEGRATION_RATE_LIMIT_PER_MINUTE = '1000';
    const { setGlobalDb } = await import('../db/index.js');
    const { initializeDatabase } = await import('../db/schema.js');
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    setGlobalDb(db);
    await initializeDatabase();

    ({ signRequest } = await import('../lib/serviceAuth.js'));
    ({ events } = await import('../orchestrator.js'));
    worker = await import('../services/conversationJobs.js');
    turnContext = await import('../lib/turnContext.js');
    queries = await import('../db/index.js');
    const { captureRawBody } = await import('../middleware/serviceAuth.js');
    const { default: integrationsRouter } = await import('../routes/integrations.js');

    const app = express();
    app.use(express.json({ verify: captureRawBody }));
    app.use(BASE, integrationsRouter);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    await worker.startConversationWorker({ runTurn: fakeTurn, concurrency: 2 });
});

after(() => {
    worker?.stopConversationWorker();
    server?.close();
});

beforeEach(async () => {
    turns.length = 0;
    turnBehaviour = async () => {};
    for (const table of ['conversation_jobs', 'conversation_messages', 'conversations', 'integration_idempotency', 'integration_request_ids', 'pending_actions', 'messages']) {
        await db.run(`DELETE FROM ${table}`);
    }
});

async function call(method, path, { user, purpose, body, headers = {} }) {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const signed = signRequest(KEY, { method, path, userId: user, purpose, body: raw });
    const res = await fetch(baseUrl + path, {
        method,
        headers: { ...(raw ? { 'Content-Type': 'application/json' } : {}), ...signed, ...headers },
        body: raw || undefined
    });
    return { status: res.status, body: await res.json() };
}

const provision = async (user, name) => (await call('POST', `${BASE}/conversations`, {
    user, purpose: 'conversation.provision', body: { displayName: name }, headers: { 'Idempotency-Key': `prov-${user}` }
})).body.conversationId;

const context = (members = [CAREGIVER, DOCTOR]) => ({ patient: PATIENT, members });

const send = (conversationId, user, requestId, text, ctx = context()) => call('POST', `${BASE}/conversations/${conversationId}/messages`, {
    user, purpose: 'conversation.message', body: { requestId, text, context: ctx }
});

const history = (conversationId, user, query = '') => call('GET', `${BASE}/conversations/${conversationId}/messages${query}`, {
    user, purpose: 'conversation.history'
});

async function settled(conversationId, user) {
    for (let i = 0; i < 100; i++) {
        const page = await history(conversationId, user);
        if (!page.body.processing) return page.body;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('jobs did not finish');
}

test('a message is saved, processed, and its reply is in the history', async () => {
    const conversationId = await provision(PATIENT.userId, 'Asha');
    const sent = await send(conversationId, PATIENT.userId, 'req-00000001', 'I feel dizzy');
    assert.equal(sent.status, 202);
    assert.equal(sent.body.status, 'accepted');
    assert.match(sent.body.messageId, /^msg_/);

    const page = await settled(conversationId, PATIENT.userId);
    assert.deepEqual(page.messages.map(m => [m.sender, m.text]), [['user', 'I feel dizzy'], ['agent', 'echo: I feel dizzy']]);
    const [mine, reply] = page.messages;
    assert.deepEqual(mine.job, { jobId: sent.body.jobId, status: 'completed' });
    assert.equal(mine.requestId, 'req-00000001');
    assert.equal(reply.jobId, sent.body.jobId, 'the reply is linked to the turn');
    assert.equal(reply.patientUserId, PATIENT.userId);

    const polled = await history(conversationId, PATIENT.userId, `?after=${page.cursor.next}`);
    assert.deepEqual(polled.body.messages, [], 'nothing new after the cursor');
    assert.equal(polled.body.cursor.next, page.cursor.next);
});

test('a retry with the same request ID returns the same message and does not run twice', async () => {
    const conversationId = await provision(PATIENT.userId, 'Asha');
    const first = await send(conversationId, PATIENT.userId, 'req-00000002', 'hello');
    const retry = await send(conversationId, PATIENT.userId, 'req-00000002', 'hello');
    assert.equal(retry.status, 200);
    assert.equal(retry.body.messageId, first.body.messageId);
    assert.equal(retry.body.jobId, first.body.jobId);
    const reused = await send(conversationId, PATIENT.userId, 'req-00000002', 'something else');
    assert.equal(reused.status, 422);
    assert.equal(reused.body.error.code, 'request_id_reused');

    const page = await settled(conversationId, PATIENT.userId);
    assert.equal(page.messages.filter(m => m.sender === 'user').length, 1);
    assert.deepEqual(turns, ['hello']);
});

test("one conversation's messages run in order, one at a time", async () => {
    const conversationId = await provision(PATIENT.userId, 'Asha');
    let running = 0;
    let overlapped = false;
    turnBehaviour = async () => {
        running += 1;
        if (running > 1) overlapped = true;
        await new Promise(resolve => setTimeout(resolve, 30));
        running -= 1;
    };
    for (const n of [1, 2, 3]) await send(conversationId, PATIENT.userId, `req-order-${n}`, `message ${n}`);
    const page = await settled(conversationId, PATIENT.userId);
    assert.deepEqual(turns, ['message 1', 'message 2', 'message 3']);
    assert.equal(overlapped, false);
    // All three are saved on arrival; the replies follow in the same order
    assert.deepEqual(page.messages.map(m => m.text), ['message 1', 'message 2', 'message 3', 'echo: message 1', 'echo: message 2', 'echo: message 3']);
});

test('a failing turn marks its job failed', async () => {
    const conversationId = await provision(PATIENT.userId, 'Asha');
    turnBehaviour = async () => { throw new Error('model unavailable'); };
    await send(conversationId, PATIENT.userId, 'req-00000003', 'hello');
    const page = await settled(conversationId, PATIENT.userId);
    assert.equal(page.messages[0].job.status, 'failed');
    assert.equal(page.messages.length, 1, 'no reply is invented');
});

test('the context snapshot updates the cached circle and must include the requester', async () => {
    const patientConversation = await provision(PATIENT.userId, 'Asha');
    await send(patientConversation, PATIENT.userId, 'req-ctx-0001', 'hi');
    await settled(patientConversation, PATIENT.userId);

    const local = async (externalId) => (await db.get("SELECT user_id FROM external_identities WHERE external_user_id = ?", [externalId])).user_id;
    const circleId = `hmc_${await local(PATIENT.userId)}`;
    const roles = async () => Object.fromEntries((await db.all(
        'SELECT ei.external_user_id AS id, m.role FROM care_circle_members m JOIN external_identities ei ON ei.user_id = m.user_id WHERE m.circle_id = ?', [circleId]
    )).map(r => [r.id, r.role]));
    assert.deepEqual(await roles(), { 'hm-pat': 'patient', 'hm-cg': 'caregiver', 'hm-doc': 'doctor' });

    // The doctor's connection ended, and the caregiver's role changed
    await send(patientConversation, PATIENT.userId, 'req-ctx-0002', 'again', context([{ ...CAREGIVER, role: 'doctor' }]));
    await settled(patientConversation, PATIENT.userId);
    assert.deepEqual(await roles(), { 'hm-pat': 'patient', 'hm-cg': 'doctor' });

    const caregiverConversation = await provision(CAREGIVER.userId, 'Ravi');
    const outsider = await send(caregiverConversation, CAREGIVER.userId, 'req-ctx-0003', 'how is she?', context([DOCTOR]));
    assert.equal(outsider.status, 403);
    assert.equal(outsider.body.error.code, 'context_mismatch');
});

test("a conversation is readable and writable only by its owner", async () => {
    const patientConversation = await provision(PATIENT.userId, 'Asha');
    await provision(CAREGIVER.userId, 'Ravi');
    const read = await history(patientConversation, CAREGIVER.userId);
    assert.equal(read.status, 404);
    assert.equal(read.body.error.code, 'conversation_not_found');
    const write = await send(patientConversation, CAREGIVER.userId, 'req-own-0001', 'hi');
    assert.equal(write.status, 404);
});

test("messages to another member go to that member's conversation, not the speaker's", async () => {
    const patientConversation = await provision(PATIENT.userId, 'Asha');
    const caregiverConversation = await provision(CAREGIVER.userId, 'Ravi');
    const caregiverLocal = (await db.get("SELECT user_id FROM external_identities WHERE external_user_id = 'hm-cg'")).user_id;
    turnBehaviour = async (job) => {
        events.emit('broadcast', { targetUsers: [caregiverLocal], message: 'Asha asked me to tell you she is fine.', circleId: job.circle_id });
    };
    await send(patientConversation, PATIENT.userId, 'req-fwd-0001', 'tell Ravi I am fine');
    const patientPage = await settled(patientConversation, PATIENT.userId);
    assert.deepEqual(patientPage.messages.map(m => m.text), ['tell Ravi I am fine', 'echo: tell Ravi I am fine']);

    const caregiverPage = (await history(caregiverConversation, CAREGIVER.userId)).body;
    assert.deepEqual(caregiverPage.messages.map(m => [m.sender, m.text, m.jobId]), [['agent', 'Asha asked me to tell you she is fine.', null]]);
    assert.equal(caregiverPage.messages[0].patientUserId, PATIENT.userId);
});

test('history pages backwards and lists open alert proposals', async () => {
    const conversationId = await provision(PATIENT.userId, 'Asha');
    for (const n of [1, 2, 3]) await send(conversationId, PATIENT.userId, `req-page-${n}`, `m${n}`);
    await settled(conversationId, PATIENT.userId);

    const latest = (await history(conversationId, PATIENT.userId, '?limit=2')).body;
    assert.deepEqual(latest.messages.map(m => m.text), ['m3', 'echo: m3']);
    assert.ok(latest.cursor.previous);
    const older = (await history(conversationId, PATIENT.userId, `?before=${latest.cursor.previous}&limit=10`)).body;
    assert.deepEqual(older.messages.map(m => m.text), ['m1', 'echo: m1', 'm2', 'echo: m2']);
    assert.equal(older.cursor.previous, null);
    assert.equal((await history(conversationId, PATIENT.userId, '?after=1&before=2')).status, 400);

    const patientLocal = (await db.get("SELECT user_id FROM external_identities WHERE external_user_id = 'hm-pat'")).user_id;
    const proposal = { actionId: 'esc_1', type: 'CRITICAL', details: 'chest pain', recipients: [{ userId: 'x', username: 'Ravi', role: 'caregiver' }], notifyDoctors: false, notifyCaregivers: true, caregiverMessage: 'Please check on Asha.', expiresAt: Date.now() + 60000, autoSendAt: null };
    await queries.addPendingAction('esc_1', `hmc_${patientLocal}`, patientLocal, 'escalation_proposal', proposal);
    const withProposal = (await history(conversationId, PATIENT.userId)).body;
    assert.deepEqual(withProposal.openProposals.map(p => [p.actionId, p.recipients[0].username]), [['esc_1', 'Ravi']]);
});

test('jobs interrupted by a restart are retried once, then marked failed', async () => {
    const conversationId = await provision(PATIENT.userId, 'Asha');
    const patientLocal = (await db.get("SELECT user_id FROM external_identities WHERE external_user_id = 'hm-pat'")).user_id;
    worker.stopConversationWorker();
    try {
        for (const [n, attempts] of [[1, 1], [2, 2]]) {
            await db.run("INSERT INTO conversation_messages (message_id, conversation_id, sender, request_id, circle_id, text, job_id, created_at) VALUES (?, ?, 'user', ?, ?, ?, ?, ?)",
                [`msg_r${n}`, conversationId, `req-restart-${n}`, `hmc_${patientLocal}`, `restart ${n}`, `job_r${n}`, Date.now() + n]);
            await db.run("INSERT INTO conversation_jobs (job_id, conversation_id, message_id, user_id, circle_id, status, attempts, created_at) VALUES (?, ?, ?, ?, ?, 'processing', ?, ?)",
                [`job_r${n}`, conversationId, `msg_r${n}`, patientLocal, `hmc_${patientLocal}`, attempts, Date.now() + n]);
        }
    } finally {
        await worker.startConversationWorker({ runTurn: fakeTurn, concurrency: 2 });
    }
    const page = await settled(conversationId, PATIENT.userId);
    const status = Object.fromEntries(page.messages.filter(m => m.sender === 'user').map(m => [m.text, m.job.status]));
    assert.deepEqual(status, { 'restart 1': 'completed', 'restart 2': 'failed' });
    assert.deepEqual(turns, ['restart 1']);
});

test("in an integration turn the agents see only the speaker's messages and others' public ones", async () => {
    const now = Date.now();
    await db.run("INSERT OR IGNORE INTO users (user_id, username, created_at) VALUES ('p', 'privacy-patient', ?)", [now]);
    await db.run("INSERT OR IGNORE INTO care_circles (circle_id, primary_patient_id, created_at) VALUES ('cx', 'p', ?)", [now]);
    for (const [user, text, privacy, offset] of [['p', 'my private worry', 'PRIVATE', 1], ['c', 'caregiver private', 'PRIVATE', 2], ['c', 'caregiver public', 'PUBLIC', 3], ['c', 'caregiver limited', 'LIMITED', 4]]) {
        await db.run("INSERT INTO messages (circle_id, user_id, role, message, privacy_level, criticality_level, timestamp) VALUES ('cx', ?, 'x', ?, ?, 'NONE', ?)", [user, text, privacy, now + offset]);
    }
    const all = (await queries.getRecentMessages('cx', 10)).map(m => m.message);
    assert.equal(all.length, 4, 'outside a turn nothing changes');
    const asPatient = await turnContext.runInTurn({ userId: 'p', conversationId: 'conv_x', jobId: 'job_x' }, () => queries.getRecentMessages('cx', 10));
    assert.deepEqual(asPatient.map(m => m.message), ['caregiver public', 'my private worry']);

    const saved = await turnContext.runInTurn({ userId: 'p', conversationId: 'conv_x', jobId: 'job_x' }, () => queries.addMessage('cx', 'p', 'patient', 'new', 'PRIVATE', 'NONE'));
    assert.equal((await db.get('SELECT conversation_id FROM messages WHERE message_id = ?', [saved])).conversation_id, 'conv_x');
});
