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

async function collectEscalateEvents(fn) {
    const emitted = [];
    const listener = (payload) => emitted.push(payload);
    events.on('escalate', listener);
    try {
        return { result: await fn(), emitted };
    } finally {
        events.off('escalate', listener);
    }
}

test('the escalate event names only the recipients that were reached', async () => {
    const { result, emitted } = await collectEscalateEvents(() => escalate(critical()));
    assert.deepEqual(emitted, [{ circleId: 'c1', escalationId: result.escalationId, type: 'CRITICAL', recipients: ['d1', 'g1'] }]);
});

test('no escalate event is sent when nobody was reached', async () => {
    const original = notificationService.sendInApp;
    notificationService.sendInApp = async () => ({ channel: 'in_app', status: 'failed', providerMessageId: null, error: 'db locked' });
    try {
        const { emitted } = await collectEscalateEvents(() => escalate(critical()));
        assert.deepEqual(emitted, []);
        const { emitted: none } = await collectEscalateEvents(() => escalate(critical({ circleId: 'c2', userId: 'p2', messageId: 102 })));
        assert.deepEqual(none, [], 'a circle with no doctor or caregiver');
    } finally {
        notificationService.sendInApp = original;
    }
});

test('a routine inbox escalation is delivered to the doctors and listed as unread', async () => {
    const { recordInboxEscalation } = await import('../services/escalationService.js');
    const { getUnreadEscalationsForUser } = await import('../db/index.js');
    const { result, emitted } = await collectEscalateEvents(() =>
        recordInboxEscalation({ circleId: 'c1', type: 'FACT_REPORT', details: 'gina reported a fall' }));

    assert.deepEqual(result.deliveries.map(d => [d.username, d.status]), [['dr_rao', 'pending']]);
    assert.deepEqual(emitted.map(e => e.recipients), [['d1']]);
    const unread = await getUnreadEscalationsForUser('d1');
    assert.deepEqual(unread.map(e => [e.type, e.patient_username]), [['FACT_REPORT', 'pat']]);
    assert.deepEqual(await getUnreadEscalationsForUser('g1'), [], 'caregivers have no doctor inbox');
    assert.deepEqual(await getUnreadEscalationsForUser('d1', 'c2'), [], 'filtered by circle');
});

test('the unread list carries no patient name for anonymous consultations', async () => {
    const { getUnreadEscalationsForUser } = await import('../db/index.js');
    await escalate(critical({ type: 'ANONYMOUS_CONSULTATION', anonymous: true, notifyCaregivers: false }));
    const unread = await getUnreadEscalationsForUser('d1');
    assert.deepEqual(unread.map(e => [e.type, e.patient_username]), [['ANONYMOUS_CONSULTATION', null]]);
});

test('acknowledging tells the user who raised it, once, naming the doctor', async () => {
    const { acknowledge } = await import('../services/escalationService.js');
    const { getUnreadEscalationsForUser } = await import('../db/index.js');
    await db.run('DELETE FROM messages');
    const { lastID: messageId } = await db.run(
        "INSERT INTO messages (circle_id, user_id, role, message, privacy_level, criticality_level, timestamp) VALUES ('c1', 'g1', 'caregiver', 'pat fell', 'SHARED', 'HIGH', ?)", [Date.now()]);
    const { escalationId } = await escalate(critical({ userId: 'g1', messageId }));

    const { result, sent } = await collectBroadcasts(() => acknowledge(escalationId, 'd1'));
    assert.deepEqual(result, { acknowledged: true, notified: 'g1' });
    assert.deepEqual(sent.map(b => [b.targetUsers, b.reply]), [[['g1'], 'dr_rao has seen the concern I flagged for them.']]);
    const notice = await db.get("SELECT user_id FROM in_app_notifications WHERE type = 'escalation_acknowledged'");
    assert.equal(notice.user_id, 'g1');
    assert.deepEqual(await getUnreadEscalationsForUser('d1'), []);

    const again = await collectBroadcasts(() => acknowledge(escalationId, 'd1'));
    assert.deepEqual(again.result, { acknowledged: false, notified: null });
    assert.deepEqual(again.sent, []);
});

test('acknowledging falls back to the patient, keeps anonymous requests anonymous, and skips conflicts', async () => {
    const { acknowledge, recordInboxEscalation } = await import('../services/escalationService.js');

    const { escalationId: noMessage } = await escalate(critical({ messageId: null }));
    const toPatient = await collectBroadcasts(() => acknowledge(noMessage, 'd1'));
    assert.equal(toPatient.result.notified, 'p1');

    const { escalationId: anonymous } = await escalate(critical({ type: 'ANONYMOUS_CONSULTATION', anonymous: true, messageId: 103 }));
    const anon = await collectBroadcasts(() => acknowledge(anonymous, 'd1'));
    assert.deepEqual(anon.sent.map(b => b.reply), ['A doctor has seen your anonymous consultation request.']);

    const { escalationId: conflict } = await recordInboxEscalation({ circleId: 'c1', type: 'CONFLICT', details: 'two reports differ' });
    const quiet = await collectBroadcasts(() => acknowledge(conflict, 'd1'));
    assert.deepEqual(quiet.result, { acknowledged: true, notified: null });
    assert.deepEqual(quiet.sent, []);
});

test('the simulation claim check uses what the turn actually delivered', async () => {
    const { checkTurnActionClaims } = await import('../training/simulation/ai_integration.js');
    const since = Date.now() - 1;
    await escalate(critical({ notifyCaregivers: false }));

    const check = await checkTurnActionClaims({
        circleId: 'c1',
        since,
        messages: [
            "I've flagged this for dr_rao, who will see it in the app.",
            "I've let your caregiver know."
        ]
    });
    assert.equal(check.messages_checked, 2);
    assert.equal(check.messages_with_false_claims, 1, 'nobody else was messaged');
    assert.deepEqual(check.claims.map(c => c.type), ['FAMILY_NOTIFIED']);

    const forwarded = await checkTurnActionClaims({ circleId: 'c1', since, messages: ["I've let your caregiver know."], othersMessaged: ['g1'] });
    assert.equal(forwarded.messages_with_false_claims, 0);

    const later = await checkTurnActionClaims({ circleId: 'c1', since: Date.now() + 1000, messages: ["I've notified your doctor."] });
    assert.equal(later.messages_with_false_claims, 1, 'an escalation from an earlier turn does not count');
});

test('an accepted proposal goes only to the recipients shown who are still in the circle', async () => {
    const { proposeEscalation, decideEscalationProposal, toPublicProposal } = await import('../services/escalationService.js');
    await db.run('DELETE FROM pending_actions');
    const { proposal, question } = await proposeEscalation(critical());
    assert.equal(question, 'Do you want me to alert dr_rao and gina now? Just reply yes.');
    assert.deepEqual(toPublicProposal(proposal).content, { doctors: 'pat reported crushing chest pain', caregivers: 'Urgent health update: pat reported a critical health concern.' });

    // gina leaves before pat accepts, and a new caregiver joins
    await db.run("DELETE FROM care_circle_members WHERE circle_id = 'c1' AND user_id = 'g1'");
    await db.run("INSERT INTO care_circle_members (circle_id, user_id, role) VALUES ('c1', 'p2', 'caregiver')");
    try {
        const decision = await decideEscalationProposal(proposal.actionId, 'p1', true);
        assert.equal(decision.status, 'completed');
        assert.deepEqual(decision.result.deliveries.map(d => d.username), ['dr_rao']);
    } finally {
        await db.run("DELETE FROM care_circle_members WHERE circle_id = 'c1' AND user_id = 'p2'");
        await db.run("INSERT INTO care_circle_members (circle_id, user_id, role) VALUES ('c1', 'g1', 'caregiver')");
    }
});

test('an emergency is sent unanswered only for a patient who consented in advance', async () => {
    const { autoSendDelayFor, EMERGENCY_AUTO_ALERT_DELAY_MS } = await import('../services/escalationService.js');
    const { setEmergencyAutoAlertConsent } = await import('../db/index.js');
    const c1 = { circle_id: 'c1', primary_patient_id: 'p1' };
    assert.equal(await autoSendDelayFor('p1', 'patient', c1), null, 'off by default');

    await setEmergencyAutoAlertConsent('p1', true, EMERGENCY_AUTO_ALERT_DELAY_MS);
    await setEmergencyAutoAlertConsent('g1', true, EMERGENCY_AUTO_ALERT_DELAY_MS);
    try {
        assert.equal(await autoSendDelayFor('p1', 'patient', c1), 5 * 60 * 1000);
        assert.equal(await autoSendDelayFor('g1', 'caregiver', c1), null, 'a caregiver reporting is never sent unanswered');
        assert.equal(await autoSendDelayFor('g1', 'patient', c1), null, 'only the patient of the circle');
    } finally {
        await db.run('DELETE FROM emergency_auto_alert_consent');
    }
});

test('an unanswered proposal from a consenting patient is sent once when due', async () => {
    const { proposeEscalation, runDueAutoAlerts, toPublicProposal, AUTO_SEND_DECISION } = await import('../services/escalationService.js');
    const { setEmergencyAutoAlertConsent } = await import('../db/index.js');
    const { composeFinalReply } = await import('../utils/actionClaimGuard.js');
    await db.run('DELETE FROM pending_actions');
    await setEmergencyAutoAlertConsent('p1', true, 5 * 60 * 1000);
    try {
        const { proposal, question } = await proposeEscalation({ ...critical(), autoSendAfterMs: 5 * 60 * 1000 });
        assert.equal(question, "Do you want me to alert dr_rao and gina now? Just reply yes. If you don't answer within 5 minutes, the alert goes to them automatically, as you set up.");
        assert.ok(toPublicProposal(proposal).autoSendAt > Date.now());
        const { message, violations } = composeFinalReply({ modelText: 'I hear you.', criticality: 'HIGH', question });
        assert.deepEqual(violations, [], 'the question is not an action claim');
        assert.ok(message.endsWith('as you set up.'));

        assert.deepEqual(await runDueAutoAlerts({ now: Date.now() }), [], 'not due yet');

        const due = proposal.autoSendAt + 1;
        const { result: outcomes, sent } = await collectBroadcasts(() => runDueAutoAlerts({ now: due }));
        assert.equal(outcomes.length, 1);
        assert.equal(outcomes[0].status, 'completed');
        assert.deepEqual(outcomes[0].result.deliveries.map(d => d.username).sort(), ['dr_rao', 'gina']);
        const row = await db.get('SELECT details FROM escalations WHERE escalation_id = ?', [outcomes[0].result.escalationId]);
        assert.match(row.details, new RegExp(AUTO_SEND_DECISION));
        const notice = sent.find(b => b.source === 'escalation_auto_sent');
        assert.deepEqual(notice.targetUsers, ['p1']);
        assert.match(notice.reply, /^You didn't answer within 5 minutes, so the alert went out as you set up\. /);

        assert.deepEqual(await runDueAutoAlerts({ now: due + 60000 }), [], 'sent only once');
    } finally {
        await db.run('DELETE FROM emergency_auto_alert_consent');
    }
});

test('a proposal is not sent unanswered without consent, after revoking, or once answered', async () => {
    const { proposeEscalation, runDueAutoAlerts, decideEscalationProposal } = await import('../services/escalationService.js');
    const { setEmergencyAutoAlertConsent, getPendingAction } = await import('../db/index.js');
    const later = Date.now() + 10 * 60 * 1000;
    await db.run('DELETE FROM pending_actions');

    const plain = await proposeEscalation(critical());
    assert.equal(plain.proposal.autoSendAt, null);
    assert.ok(!plain.question.includes('automatically'));
    assert.deepEqual(await runDueAutoAlerts({ now: later }), [], 'no send time without consent');

    await setEmergencyAutoAlertConsent('p1', true, 5 * 60 * 1000);
    const revoked = await proposeEscalation({ ...critical(), autoSendAfterMs: 5 * 60 * 1000 });
    await setEmergencyAutoAlertConsent('p1', false);
    const outcomes = await runDueAutoAlerts({ now: later });
    assert.deepEqual(outcomes.map(o => o.status), ['skipped']);
    assert.equal((await getPendingAction(revoked.proposal.actionId)).details.autoSendAt, null, 'it waits for an answer instead');
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM escalations')).n, 0);

    await setEmergencyAutoAlertConsent('p1', true, 5 * 60 * 1000);
    try {
        const answered = await proposeEscalation({ ...critical(), autoSendAfterMs: 5 * 60 * 1000 });
        assert.equal((await decideEscalationProposal(answered.proposal.actionId, 'p1', false)).status, 'rejected');
        assert.deepEqual(await runDueAutoAlerts({ now: later }), [], 'a "no" before the send time stops it');
        assert.equal((await db.get('SELECT COUNT(*) AS n FROM escalations')).n, 0);
    } finally {
        await db.run('DELETE FROM emergency_auto_alert_consent');
    }
});
