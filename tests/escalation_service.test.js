/**
 * @fileoverview tests/escalation_service.test.js
 * Tests for services/escalationService.js: one escalation per message, recipients from
 * circle membership, recorded deliveries, and an action record that counts only
 * deliveries that reached someone.
 *
 * Run with: node --test --test-force-exit tests/escalation_service.test.js
 * Uses an in-memory database; no LLM calls are made.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;
let escalate, toActionRecord, notificationService, events, addClient, removeClient, buildActionStatus, acknowledgeEscalation;

before(async () => {
    const { setGlobalDb } = await import('../db/index.js');
    const { initializeDatabase } = await import('../db/schema.js');
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    setGlobalDb(db);
    await initializeDatabase();

    const now = Date.now();
    for (const [id, name] of [['p1', 'pat'], ['g1', 'gina'], ['d1', 'dr_rao'], ['p2', 'solo']]) {
        await db.run('INSERT INTO users (user_id, username, created_at) VALUES (?, ?, ?)', [id, name, now]);
    }
    await db.run('INSERT INTO care_circles (circle_id, primary_patient_id, created_at) VALUES (?, ?, ?)', ['c1', 'p1', now]);
    await db.run('INSERT INTO care_circles (circle_id, primary_patient_id, created_at) VALUES (?, ?, ?)', ['c2', 'p2', now]);
    for (const [circle, user, role] of [['c1', 'p1', 'patient'], ['c1', 'g1', 'caregiver'], ['c1', 'd1', 'doctor'], ['c2', 'p2', 'patient']]) {
        await db.run('INSERT INTO care_circle_members (circle_id, user_id, role) VALUES (?, ?, ?)', [circle, user, role]);
    }

    ({ escalate, toActionRecord } = await import('../services/escalationService.js'));
    ({ notificationService } = await import('../notifications/NotificationService.js'));
    ({ events } = await import('../orchestrator.js'));
    ({ addClient, removeClient } = await import('../lib/sse.js'));
    ({ buildActionStatus } = await import('../utils/actionClaimGuard.js'));
    ({ acknowledgeEscalation } = await import('../db/index.js'));
});

beforeEach(async () => {
    await db.run('DELETE FROM escalation_deliveries');
    await db.run('DELETE FROM escalations');
    await db.run('DELETE FROM in_app_notifications');
});

async function collectBroadcasts(fn) {
    const sent = [];
    const listener = (payload) => sent.push(payload);
    events.on('broadcast', listener);
    try {
        return { result: await fn(), sent };
    } finally {
        events.off('broadcast', listener);
    }
}

const critical = (overrides = {}) => ({
    circleId: 'c1',
    userId: 'p1',
    type: 'CRITICAL',
    details: 'pat reported crushing chest pain',
    messageId: 101,
    notifyCaregivers: true,
    caregiverMessage: 'Urgent health update: pat reported a critical health concern.',
    patientUsername: 'pat',
    ...overrides
});

test('escalation reaches the doctor and caregiver, recorded as pending when they are offline', async () => {
    const { result, sent } = await collectBroadcasts(() => escalate(critical()));

    assert.equal(result.duplicate, false);
    assert.deepEqual(result.actions.doctors, ['dr_rao']);
    assert.deepEqual(result.actions.caregiversAlerted, ['gina']);
    assert.equal(result.actions.noDoctorConnected, false);
    assert.deepEqual(result.deliveries.map(d => [d.username, d.status]), [['dr_rao', 'pending'], ['gina', 'pending']]);

    const rows = await db.all('SELECT type, status, message_id FROM escalations');
    assert.deepEqual(rows, [{ type: 'CRITICAL', status: 'OPEN', message_id: 101 }]);
    assert.equal((await db.all('SELECT * FROM escalation_deliveries')).length, 2);
    assert.equal((await db.all('SELECT * FROM in_app_notifications')).length, 2);

    // The caregiver gets the live alert; the patient gets nothing from the service
    assert.ok(sent.some(b => b.targetUsers.includes('g1')));
    assert.ok(sent.every(b => !b.targetUsers.includes('p1')));
});

test('a second escalation for the same message sends nothing and reports the first', async () => {
    await escalate(critical());
    const { result, sent } = await collectBroadcasts(() => escalate(critical({ type: 'CONSULTATION' })));

    assert.equal(result.duplicate, true);
    assert.equal(sent.length, 0);
    assert.deepEqual(result.actions.doctors, ['dr_rao']);
    assert.equal((await db.all('SELECT * FROM escalations')).length, 1);
    assert.equal((await db.all('SELECT * FROM escalation_deliveries')).length, 2);
});

test('escalations without a message ID are never treated as duplicates', async () => {
    await escalate(critical({ messageId: null }));
    await escalate(critical({ messageId: null }));
    assert.equal((await db.all('SELECT * FROM escalations')).length, 2);
});

test('a circle with no doctor reports that no doctor is connected', async () => {
    const result = await escalate(critical({ circleId: 'c2', userId: 'p2', patientUsername: 'solo' }));

    assert.deepEqual(result.actions.doctors, []);
    assert.equal(result.actions.noDoctorConnected, true);
    assert.equal(result.doctorReached, false);
    assert.match(buildActionStatus(result.actions), /No doctor is connected/);
});

test('a recipient with the app open is recorded as delivered', async () => {
    addClient('d1', { write() {} });
    try {
        const result = await escalate(critical());
        assert.equal(result.deliveries.find(d => d.username === 'dr_rao').status, 'delivered');
        assert.equal(result.deliveries.find(d => d.username === 'gina').status, 'pending');
    } finally {
        removeClient('d1');
    }
});

test('a failed or timed-out send is never counted as reaching anyone', async () => {
    const original = notificationService.sendInApp;
    notificationService.sendInApp = async (userId) => userId === 'd1'
        ? { channel: 'in_app', status: 'failed', providerMessageId: null, error: 'db locked' }
        : new Promise(() => {}); // never resolves
    try {
        const result = await escalate(critical({ timeoutMs: 20 }));

        assert.deepEqual(result.actions.doctors, []);
        assert.deepEqual(result.actions.caregiversAlerted, []);
        assert.deepEqual(result.actions.failedRecipients, ['dr_rao', 'gina']);
        assert.equal(result.doctorReached, false);
        const stored = await db.all('SELECT status, error FROM escalation_deliveries ORDER BY delivery_id');
        assert.deepEqual(stored, [{ status: 'failed', error: 'db locked' }, { status: 'failed', error: 'timeout' }]);

        const status = buildActionStatus(result.actions);
        assert.doesNotMatch(status, /flagged this for/);
        assert.match(status, /couldn't send this to dr_rao and gina/);
    } finally {
        notificationService.sendInApp = original;
    }
});

test('caregiver-only escalations do not report a missing doctor', async () => {
    const result = await escalate(critical({ type: 'CAREGIVER_NOTIFICATION', notifyDoctors: false }));
    assert.deepEqual(result.actions.doctors, []);
    assert.deepEqual(result.actions.caregiversAlerted, ['gina']);
    assert.equal(result.actions.noDoctorConnected, false);
});

test('an unknown escalation type is rejected', async () => {
    await assert.rejects(() => escalate(critical({ type: 'FACT_REPORT' })), /Unknown escalation type/);
});

test('one doctor acknowledges one escalation', async () => {
    const { escalationId } = await escalate(critical());
    assert.equal(await acknowledgeEscalation(escalationId, 'd1'), true);
    assert.equal(await acknowledgeEscalation(escalationId, 'd1'), false, 'already acknowledged');
    assert.equal(await acknowledgeEscalation(escalationId, 'p1'), false, 'not a recipient');

    const row = await db.get('SELECT status FROM escalations WHERE escalation_id = ?', [escalationId]);
    assert.equal(row.status, 'ACKNOWLEDGED');
});

test('toActionRecord marks anonymous consultations', () => {
    const record = toActionRecord([], { doctorsWanted: true, circleHasDoctor: true, anonymous: true });
    assert.equal(record.anonymousConsultation, true);
    assert.match(buildActionStatus(record), /anonymous consultation/);
});
