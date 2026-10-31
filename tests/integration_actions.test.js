/**
 * @fileoverview tests/integration_actions.test.js
 * Tests for HealthyMitra actions: in a HealthyMitra circle, alerts and messages to other
 * members are proposed (never sent from here), decided once on the card or in chat, and the
 * user is told what was done only from the result HealthyMitra reports.
 *
 * Run with: node --test --test-force-exit tests/integration_actions.test.js
 * Uses an in-memory database, local HTTP servers for both services and no LLM calls.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import express from 'express';

const KEY = 'actions-test-key';
const OUTBOUND_KEY = 'actions-test-outbound-key';
const BASE = '/api/integrations/healthymitra';
const PATIENT = { userId: 'hm-pat', displayName: 'Asha' };
const CAREGIVER = { userId: 'hm-cg', role: 'caregiver', displayName: 'Ravi' };
const DOCTOR = { userId: 'hm-doc', role: 'doctor', displayName: 'Dr Rao' };

let db, server, hmServer, baseUrl, signRequest, verifySignature, worker, queries, escalation, members, actionsService;
const notices = [];

before(async () => {
    process.env.SERVICE_SECRETS_SOURCE = 'env';
    process.env.HEALTHYMITRA_TO_AI_SECRET = KEY;
    process.env.AI_TO_HEALTHYMITRA_SECRET = OUTBOUND_KEY;
    process.env.INTEGRATION_RATE_LIMIT_PER_MINUTE = '1000';
    const { setGlobalDb } = await import('../db/index.js');
    const { initializeDatabase } = await import('../db/schema.js');
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    setGlobalDb(db);
    await initializeDatabase();

    ({ signRequest, verifySignature } = await import('../lib/serviceAuth.js'));
    worker = await import('../services/conversationJobs.js');
    queries = await import('../db/index.js');
    escalation = await import('../services/escalationService.js');
    members = await import('../services/memberMessaging.js');
    actionsService = await import('../services/integrationActions.js');
    const { captureRawBody } = await import('../middleware/serviceAuth.js');
    const { default: integrationsRouter } = await import('../routes/integrations.js');

    const app = express();
    app.use(express.json({ verify: captureRawBody }));
    app.use(BASE, integrationsRouter);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    // Stand-in for HealthyMitra, recording approved-action notices
    const hm = express();
    hm.use(express.json({ verify: captureRawBody }));
    hm.post('/api/integrations/healthymitra-ai/actions', (req, res) => {
        notices.push({ headers: req.headers, raw: req.rawBody?.toString('utf8') ?? '', body: req.body, path: req.originalUrl });
        res.status(200).json({ received: true });
    });
    await new Promise(resolve => { hmServer = hm.listen(0, resolve); });
    process.env.HEALTHYMITRA_BASE_URL = `http://127.0.0.1:${hmServer.address().port}`;

    // Turns are not run here; messages only sync the circle
    await worker.startConversationWorker({ runTurn: async () => {}, concurrency: 1 });
});

after(() => {
    worker?.stopConversationWorker();
    server?.close();
    hmServer?.close();
});

beforeEach(async () => {
    notices.length = 0;
    for (const table of ['integration_actions', 'conversation_jobs', 'conversation_messages', 'conversations', 'integration_idempotency',
        'integration_request_ids', 'pending_actions', 'escalation_deliveries', 'escalations', 'emergency_auto_alert_consent']) {
        await db.run(`DELETE FROM ${table}`);
    }
});

async function call(method, path, { user, purpose, body }) {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const signed = signRequest(KEY, { method, path, userId: user, purpose, body: raw });
    const res = await fetch(baseUrl + path, {
        method,
        headers: { ...(raw ? { 'Content-Type': 'application/json' } : {}), ...signed, ...(path.endsWith('/conversations') ? { 'Idempotency-Key': `prov-${user}-key` } : {}) },
        body: raw || undefined
    });
    return { status: res.status, body: await res.json() };
}

const provision = async (user, name) => (await call('POST', `${BASE}/conversations`, {
    user, purpose: 'conversation.provision', body: { displayName: name }
})).body.conversationId;

let requestCounter = 0;
const sync = (conversationId, user, extra = {}) => call('POST', `${BASE}/conversations/${conversationId}/messages`, {
    user,
    purpose: 'conversation.message',
    body: { requestId: `req-sync-${++requestCounter}`, text: 'hello', context: { patient: PATIENT, members: [CAREGIVER, DOCTOR], ...extra } }
});

const history = (conversationId, user) => call('GET', `${BASE}/conversations/${conversationId}/messages`, { user, purpose: 'conversation.history' });
const decide = (actionId, user, decision, payloadHash) => call('POST', `${BASE}/actions/${actionId}/decision`, {
    user, purpose: 'action.decision', body: { decision, payloadHash }
});
const report = (actionId, user, recipients) => call('POST', `${BASE}/actions/${actionId}/result`, {
    user, purpose: 'action.result', body: { recipients }
});

async function localId(externalUserId) {
    return (await queries.findExternalIdentity('healthymitra', externalUserId)).user_id;
}

/** A patient conversation with the circle synced, and the local IDs. */
async function setup(extraContext) {
    const conversationId = await provision(PATIENT.userId, 'Asha');
    const caregiverConversation = await provision(CAREGIVER.userId, 'Ravi');
    assert.equal((await sync(conversationId, PATIENT.userId, extraContext)).status, 202);
    const patientId = await localId(PATIENT.userId);
    return { conversationId, caregiverConversation, patientId, circleId: `hmc_${patientId}` };
}

const proposeAlert = (patientId, circleId, extra = {}) => escalation.proposeEscalation({
    circleId,
    userId: patientId,
    type: 'CRITICAL',
    details: 'Asha reported chest pain at 09:10.',
    notifyDoctors: true,
    notifyCaregivers: true,
    caregiverMessage: 'Urgent health update: Asha reported chest pain.',
    patientUsername: 'Asha',
    ...extra
});

async function agentTexts(conversationId, user) {
    await worker.transcriptIdle();
    return (await history(conversationId, user)).body.messages.filter(m => m.sender === 'agent').map(m => m.text);
}

test('an alert in a HealthyMitra circle is proposed with HealthyMitra recipient IDs and nothing is sent', async () => {
    const { conversationId, caregiverConversation, patientId, circleId } = await setup();
    const { proposal, question } = await proposeAlert(patientId, circleId);
    assert.match(question, /alert Ravi and Dr Rao|alert Dr Rao and Ravi/);

    const page = (await history(conversationId, PATIENT.userId)).body;
    assert.equal(page.openProposals.length, 1);
    const [card] = page.openProposals;
    assert.equal(card.actionId, proposal.actionId);
    assert.equal(card.kind, 'escalation');
    assert.equal(card.type, 'CRITICAL');
    assert.equal(card.status, 'pending');
    assert.equal(card.patientUserId, PATIENT.userId);
    assert.deepEqual(card.recipients.map(r => r.userId).sort(), [CAREGIVER.userId, DOCTOR.userId].sort());
    assert.deepEqual(card.content, { doctors: 'Asha reported chest pain at 09:10.', caregivers: 'Urgent health update: Asha reported chest pain.' });
    assert.match(card.payloadHash, /^[0-9a-f]{64}$/);
    assert.equal(card.version, 1);

    assert.equal((await db.get('SELECT COUNT(*) AS n FROM escalations')).n, 0, 'no escalation is sent from here');
    assert.deepEqual(await agentTexts(caregiverConversation, CAREGIVER.userId), [], 'the caregiver is not messaged');
});

test('the card decides an action once, for the exact content, and only for its owner', async () => {
    const { patientId, circleId } = await setup();
    const { proposal } = await proposeAlert(patientId, circleId);
    const hash = (await actionsService.getOpenActionsForUser(patientId))[0].payloadHash;

    const wrongHash = await decide(proposal.actionId, PATIENT.userId, 'approve', 'f'.repeat(64));
    assert.equal(wrongHash.status, 409);
    assert.equal(wrongHash.body.error.code, 'payload_changed');

    const notOwner = await decide(proposal.actionId, CAREGIVER.userId, 'approve', hash);
    assert.equal(notOwner.status, 404);

    const approved = await decide(proposal.actionId, PATIENT.userId, 'approve', hash);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.action.status, 'approved');
    assert.equal(approved.body.action.decision, 'user_card');
    assert.equal(approved.body.changed, true);

    const again = await decide(proposal.actionId, PATIENT.userId, 'approve', hash);
    assert.equal(again.status, 200);
    assert.equal(again.body.changed, false, 'a double click changes nothing');

    const reject = await decide(proposal.actionId, PATIENT.userId, 'reject', hash);
    assert.equal(reject.status, 409);
    assert.equal(reject.body.error.code, 'already_decided');

    assert.equal(await queries.getPendingAction(proposal.actionId), undefined, 'the chat question is answered too');
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM escalations')).n, 0, 'approval alone sends nothing');
    assert.equal(notices.length, 0, 'a card decision came from HealthyMitra, so it is not echoed back');
});

test('the result HealthyMitra reports is recorded once and is what the user is told', async () => {
    const { conversationId, patientId, circleId } = await setup();
    const { proposal } = await proposeAlert(patientId, circleId);
    const hash = (await actionsService.getOpenActionsForUser(patientId))[0].payloadHash;

    const early = await report(proposal.actionId, PATIENT.userId, [{ userId: CAREGIVER.userId, status: 'delivered' }]);
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, 'action_not_approved');

    await decide(proposal.actionId, PATIENT.userId, 'approve', hash);
    const unknown = await report(proposal.actionId, PATIENT.userId, [{ userId: 'hm-someone-else', status: 'delivered' }]);
    assert.equal(unknown.status, 400);

    const recipients = [
        { userId: CAREGIVER.userId, status: 'delivered', resultId: 'msg-1' },
        { userId: DOCTOR.userId, status: 'failed' }
    ];
    const recorded = await report(proposal.actionId, PATIENT.userId, recipients);
    assert.equal(recorded.status, 200);
    assert.equal(recorded.body.changed, true);
    assert.equal(recorded.body.action.status, 'failed', 'not every recipient was reached');
    assert.deepEqual(recorded.body.action.results.map(r => [r.userId, r.status]).sort(), [[CAREGIVER.userId, 'delivered'], [DOCTOR.userId, 'failed']]);

    const repeat = await report(proposal.actionId, PATIENT.userId, recipients);
    assert.equal(repeat.body.changed, false);

    const texts = await agentTexts(conversationId, PATIENT.userId);
    assert.deepEqual(texts, ["I've sent an alert to Ravi in the app. I couldn't send this to Dr Rao."], 'told once, from the result');

    const deliveries = await db.all('SELECT user_id, channel, status, provider_message_id FROM escalation_deliveries ORDER BY status');
    assert.deepEqual(deliveries, [
        { user_id: await localId(CAREGIVER.userId), channel: 'healthymitra', status: 'delivered', provider_message_id: 'msg-1' },
        { user_id: await localId(DOCTOR.userId), channel: 'healthymitra', status: 'failed', provider_message_id: null }
    ]);
    assert.equal((await history(conversationId, PATIENT.userId)).body.openProposals.length, 0, 'a finished action is no longer open');
});

test('a "yes" in chat approves the action and tells HealthyMitra with a signed request', async () => {
    const { patientId, circleId } = await setup();
    const { proposal } = await proposeAlert(patientId, circleId);

    const decision = await escalation.decideEscalationProposal(proposal.actionId, patientId, true);
    assert.equal(decision.status, 'approved');
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM escalations')).n, 0);

    for (let i = 0; i < 50 && notices.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(notices.length, 1);
    const [notice] = notices;
    assert.equal(notice.headers['x-hm-purpose'], 'action.approved');
    assert.equal(notice.headers['x-hm-user-id'], PATIENT.userId);
    assert.equal(notice.body.action.actionId, proposal.actionId);
    assert.equal(notice.body.action.decision, 'user_chat');
    const fields = {
        method: 'POST', path: notice.path, timestamp: notice.headers['x-hm-timestamp'], requestId: notice.headers['x-hm-request-id'],
        userId: notice.headers['x-hm-user-id'], purpose: notice.headers['x-hm-purpose'], body: notice.raw
    };
    assert.ok(verifySignature([OUTBOUND_KEY], fields, notice.headers['x-hm-signature']), 'signed with the outbound key');

    const repeat = await escalation.decideEscalationProposal(proposal.actionId, patientId, true);
    assert.equal(repeat.status, 'not_found', 'the question is already answered');
});

test('an unanswered emergency is approved by prior consent from the HealthyMitra snapshot', async () => {
    const { conversationId, patientId, circleId } = await setup({ allowedActions: { emergencyAutoAlert: { delayMs: 60_000 } } });
    assert.ok(await queries.getEmergencyAutoAlertConsent(patientId), 'consent comes from the snapshot');
    const delay = await escalation.autoSendDelayFor(patientId, 'patient', await queries.findCircleById(circleId));
    const { proposal, question } = await proposeAlert(patientId, circleId, { autoSendAfterMs: delay });
    assert.match(question, /within 1 minute/);

    const outcomes = await escalation.runDueAutoAlerts({ now: Date.now() + 61_000 });
    assert.deepEqual(outcomes.map(o => [o.actionId, o.status]), [[proposal.actionId, 'approved']]);
    const [open] = await actionsService.getOpenActionsForUser(patientId);
    assert.equal(open.status, 'approved');
    assert.equal(open.decision, 'auto_by_prior_consent');
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM escalations')).n, 0, 'HealthyMitra sends it');

    await report(proposal.actionId, PATIENT.userId, [
        { userId: CAREGIVER.userId, status: 'delivered' },
        { userId: DOCTOR.userId, status: 'delivered' }
    ]);
    const [told] = await agentTexts(conversationId, PATIENT.userId);
    assert.match(told, /^You didn't answer within 1 minute, so the alert went out as you set up\. /);

    // A snapshot without the setting revokes it
    await sync(conversationId, PATIENT.userId);
    assert.equal(await queries.getEmergencyAutoAlertConsent(patientId), null);
});

test('a message to another member is proposed, card-only, and a rejection sends nothing', async () => {
    const { conversationId, caregiverConversation, patientId, circleId } = await setup();
    const caregiver = (await queries.getCircleMembers(circleId)).find(m => m.role === 'caregiver');

    const shared = await members.shareWithMembers({ userId: patientId, circleId, members: [caregiver], message: 'Asha says she took her tablets.', patientUsername: 'Asha' });
    assert.deepEqual(shared.actions, {}, 'nobody was messaged');
    assert.equal(shared.proposal.kind, 'send_member_message');
    assert.match(shared.question, /drafted a message for Ravi/);
    assert.deepEqual(await queries.getActivePendingActions(patientId, circleId), [], 'a chat "yes" cannot send it');

    const [card] = (await history(conversationId, PATIENT.userId)).body.openProposals;
    assert.equal(card.type, 'MEMBER_MESSAGE');
    assert.deepEqual(card.recipients, [{ userId: CAREGIVER.userId, username: 'Ravi', role: 'caregiver' }]);
    assert.deepEqual(card.content, { doctors: null, caregivers: 'Asha says she took her tablets.' });

    const rejected = await decide(card.actionId, PATIENT.userId, 'reject', card.payloadHash);
    assert.equal(rejected.body.action.status, 'rejected');
    assert.deepEqual(await agentTexts(conversationId, PATIENT.userId), ["Okay, I haven't sent it."]);
    assert.deepEqual(await agentTexts(caregiverConversation, CAREGIVER.userId), []);
});

test('in a local circle a message to another member is still sent directly', async () => {
    if (!(await queries.findUserById('local-pat'))) {
        await queries.addUser('local-pat', 'Meera');
        await queries.addUser('local-cg', 'Kiran');
    }
    await queries.createCareCircle('circle-local', 'local-pat');
    await queries.addMemberToCircle('circle-local', 'local-cg', 'caregiver', null);
    const caregiver = (await queries.getCircleMembers('circle-local')).find(m => m.user_id === 'local-cg');
    const shared = await members.shareWithMembers({ userId: 'local-pat', circleId: 'circle-local', members: [caregiver], message: 'hi', patientUsername: 'Meera' });
    assert.deepEqual(shared.actions, { membersMessaged: ['Kiran'] });
    assert.equal(shared.proposal, null);
});

test('a decision after expiry expires the action and sends nothing', async () => {
    const { conversationId, patientId, circleId } = await setup();
    const { proposal } = await proposeAlert(patientId, circleId, { ttlMs: 1 });
    await new Promise(resolve => setTimeout(resolve, 5));
    const row = await queries.getIntegrationAction(proposal.actionId);
    const expired = await decide(proposal.actionId, PATIENT.userId, 'approve', row.payload_hash);
    assert.equal(expired.status, 200);
    assert.equal(expired.body.action.status, 'expired');
    assert.match((await agentTexts(conversationId, PATIENT.userId))[0], /haven't sent it/);
});

test('escalation tiers and doctor requests propose instead of sending in a HealthyMitra circle', async () => {
    const { patientId, circleId } = await setup();
    const { handleTieredEscalation } = await import('../handlers/message_logic/sharing/escalationTiers.js');
    const { handleDoctorRequest } = await import('../handlers/message_logic/sharing/doctorRequests.js');
    const analysis = { criticality: 'MEDIUM', sharingSuggestion: { content_to_share: 'dizzy since morning' }, message_id: null };

    const caregiverTier = await handleTieredEscalation(patientId, 'patient', 'I feel dizzy', circleId, analysis, 0.6);
    assert.equal(caregiverTier.action, 'ESCALATION_PROPOSED');
    assert.equal(caregiverTier.escalated, false);
    assert.deepEqual(caregiverTier.proposal.recipients.map(r => r.username), ['Ravi']);
    assert.match(caregiverTier.question, /alert Ravi/);

    // No anonymous consultation through HealthyMitra: the user sees and accepts a consultation
    const anonymousTier = await handleTieredEscalation(patientId, 'patient', 'I feel dizzy', circleId, analysis, 0.9);
    assert.equal(anonymousTier.proposal.type, 'CONSULTATION');
    assert.match(anonymousTier.proposal.details, /^User 'Asha' consultation requested/);

    const doctorRequest = await handleDoctorRequest(patientId, circleId, { intent: 'REQUESTING_DOCTOR', sharingSuggestion: { content_to_share: 'wants to talk' } });
    assert.equal(doctorRequest.action, 'ESCALATION_PROPOSED');
    assert.deepEqual(doctorRequest.proposal.recipients.map(r => r.username), ['Dr Rao']);

    assert.equal((await db.get('SELECT COUNT(*) AS n FROM escalations')).n, 0);
    // A newer proposal replaces the older open one, so only its card can be accepted
    const open = await actionsService.getOpenActionsForUser(patientId);
    assert.deepEqual(open.map(a => a.actionId), [doctorRequest.proposal.actionId]);
    assert.equal((await queries.getIntegrationAction(caregiverTier.proposal.actionId)).status, 'expired');
});
