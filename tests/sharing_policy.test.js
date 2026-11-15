/**
 * @fileoverview tests/sharing_policy.test.js
 * A user's "don't tell X" is stored, mapped to members in code, and enforced on every send
 * path: consent suggestions, member messages, escalations and emergency proposals. Reading
 * the restrictions failing blocks sending. Uses an in-memory database; no LLM calls.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { setGlobalDb } from '../db/index.js';
import { initializeDatabase } from '../db/schema.js';
import {
    normalizeDirectives, applySharingDirectives, buildDirectiveNotice, partitionRecipients,
    describeRestrictions, loadRestrictions, describeWithheldFrom, withheldGuidance, RESTRICTION_LOOKBACK_MS
} from '../services/sharingPolicy.js';
import { addRestriction, revokeRestrictions } from '../db/queries_sharing_restrictions.js';
import { getRecentMessages, hasRecentHighMessage } from '../db/queries_messages.js';
import { runInTurn } from '../lib/turnContext.js';
import { evaluateConsent } from '../companions/handlers/consentManager.js';
import { shareWithMembers } from '../services/memberMessaging.js';
import { escalate, proposeEscalation } from '../services/escalationService.js';
import { events } from '../orchestrator.js';
import { buildKnownSection } from '../companions/patientFacts.js';
import { composeFinalReply } from '../utils/actionClaimGuard.js';

let db;
const patient = { user_id: 'p1', username: 'Ramesh Sharma', role: 'patient', relationship_type: null };
const daughter = { user_id: 'g1', username: 'Priya Sharma', role: 'caregiver', relationship_type: 'daughter' };
const son = { user_id: 'g2', username: 'Arjun Sharma', role: 'caregiver', relationship_type: 'son' };
const doctor = { user_id: 'd1', username: 'Dr. Anjali Mehta', role: 'doctor', relationship_type: null };
const members = [patient, daughter, son, doctor];

before(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    setGlobalDb(db);
    await initializeDatabase();
    const now = Date.now();
    for (const m of members) {
        await db.run('INSERT INTO users (user_id, username, created_at) VALUES (?, ?, ?)', [m.user_id, m.username, now]);
    }
    await db.run('INSERT INTO care_circles (circle_id, primary_patient_id, created_at) VALUES (?, ?, ?)', ['c1', 'p1', now]);
    for (const m of members) {
        await db.run('INSERT INTO care_circle_members (circle_id, user_id, role, relationship_type) VALUES (?, ?, ?, ?)', ['c1', m.user_id, m.role, m.relationship_type]);
    }
});

beforeEach(async () => {
    await db.run('DELETE FROM sharing_restrictions');
    await db.run('DELETE FROM messages');
    await db.run('DELETE FROM pending_actions');
    await db.run('DELETE FROM escalation_deliveries');
    await db.run('DELETE FROM escalations');
});

const restrict = (targets, extra = {}) => applySharingDirectives({
    circleId: 'c1', ownerUserId: 'p1', members, sourceText: "Don't tell my daughter",
    directives: normalizeDirectives([{ action: 'restrict', targets, topic: 'medication', ...extra }])
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

test('malformed directives are dropped', () => {
    assert.deepEqual(normalizeDirectives([
        { action: 'restrict', targets: ['Priya Sharma'], topic: '  ' },
        { action: 'forget', targets: ['Priya Sharma'] },
        { action: 'allow', targets: [] },
        null
    ]), [{ action: 'restrict', targets: ['Priya Sharma'], topic: null }]);
    assert.deepEqual(normalizeDirectives('nope'), []);
});

test('a restriction is stored for the named member and confirmed by code', async () => {
    const outcome = await restrict(['Priya Sharma']);
    assert.deepEqual(outcome.restricted, ['Priya Sharma']);
    assert.equal(buildDirectiveNotice(outcome), "Okay, I won't share anything with Priya Sharma unless you tell me otherwise.");

    const again = await restrict(['Priya Sharma']);
    assert.deepEqual(again.restricted, ['Priya Sharma']);
    const rows = await loadRestrictions('c1', 'p1');
    assert.equal(rows.length, 1, 'the same restriction is not stored twice');
    assert.equal(describeRestrictions(rows, members), 'Priya Sharma');
});

test('the owner cannot be a target and unknown names are asked about, not guessed', async () => {
    const outcome = await restrict(['Ramesh Sharma', 'my neighbour']);
    assert.deepEqual(outcome.restricted, []);
    assert.deepEqual(outcome.unresolved, ['Ramesh Sharma', 'my neighbour']);
    assert.match(buildDirectiveNotice(outcome), /Who do you mean by "Ramesh Sharma" and "my neighbour"\?/);
    assert.deepEqual(await loadRestrictions('c1', 'p1'), []);
});

test('allow lifts a member restriction but not a group one that still covers them', async () => {
    await restrict(['Priya Sharma', 'all_caregivers']);
    const outcome = await applySharingDirectives({
        circleId: 'c1', ownerUserId: 'p1', members,
        directives: normalizeDirectives([{ action: 'allow', targets: ['Priya Sharma'] }])
    });
    assert.deepEqual(outcome.allowed, ['Priya Sharma']);
    assert.deepEqual(outcome.stillRestricted, ['Priya Sharma']);
    assert.match(buildDirectiveNotice(outcome), /still applies/);

    const rows = await db.all('SELECT target_user_id, target_role, revoked_at FROM sharing_restrictions ORDER BY restriction_id');
    assert.equal(rows[0].target_user_id, 'g1');
    assert.ok(rows[0].revoked_at, 'the member restriction is revoked, and kept for audit');
    assert.equal(rows[1].target_role, 'caregiver');
    assert.equal(rows[1].revoked_at, null);
});

test('allowing someone who was never restricted changes nothing and confirms nothing', async () => {
    const outcome = await applySharingDirectives({
        circleId: 'c1', ownerUserId: 'p1', members,
        directives: normalizeDirectives([{ action: 'allow', targets: ['Dr. Anjali Mehta'] }])
    });
    assert.deepEqual(outcome.allowed, []);
    assert.equal(buildDirectiveNotice(outcome), '');
});

test('groups cover members by role, and everyone covers all', async () => {
    await restrict(['all_doctors']);
    let split = await partitionRecipients({ circleId: 'c1', ownerUserId: 'p1', members: [daughter, doctor] });
    assert.deepEqual(split.blocked.map(m => m.user_id), ['d1']);

    await restrict(['everyone']);
    split = await partitionRecipients({ circleId: 'c1', ownerUserId: 'p1', members: [daughter, son, doctor] });
    assert.deepEqual(split.allowed, []);
});

test('restrictions belong to their owner: a caregiver sharing is not limited by the patient', async () => {
    await restrict(['Dr. Anjali Mehta']);
    const split = await partitionRecipients({ circleId: 'c1', ownerUserId: 'g1', members: [doctor] });
    assert.deepEqual(split.allowed.map(m => m.user_id), ['d1']);
});

test('the consent gate never suggests a restricted member or a restricted doctor role', async () => {
    await restrict(['Priya Sharma', 'all_doctors']);
    const restrictions = await loadRestrictions('c1', 'p1');
    const gate = (target) => evaluateConsent({ target, reason: 'r' }, 'p1', 'c1', {}, members, [], restrictions);
    assert.equal(await gate('Priya Sharma'), null);
    assert.equal(await gate('doctor'), null);
    assert.equal((await gate('Arjun Sharma')).target, 'Arjun Sharma');
    // Restrictions that could not be read block every suggestion
    assert.equal(await evaluateConsent({ target: 'Arjun Sharma' }, 'p1', 'c1', {}, members, [], null), null);
});

test('a member message is not sent to a restricted member', async () => {
    await restrict(['Priya Sharma']);
    const { result, sent } = await collectBroadcasts(() => shareWithMembers({
        userId: 'p1', circleId: 'c1', members: [daughter, son], message: 'Dad wants to talk'
    }));
    assert.deepEqual(result.blocked, ['Priya Sharma']);
    assert.deepEqual(result.actions.membersMessaged, ['Arjun Sharma']);
    assert.deepEqual(sent.flatMap(s => s.targetUsers), ['g2']);

    const none = await shareWithMembers({ userId: 'p1', circleId: 'c1', members: [daughter], message: 'x' });
    assert.deepEqual(none, { actions: {}, proposal: null, question: null, blocked: ['Priya Sharma'] });
});

test('an escalation the user did not approve leaves restricted members out', async () => {
    await restrict(['Priya Sharma']);
    const result = await escalate({
        circleId: 'c1', userId: 'p1', type: 'CRITICAL', details: 'chest pain', messageId: 1,
        notifyCaregivers: true, caregiverMessage: 'Please check on Ramesh.', patientUsername: 'Ramesh Sharma'
    });
    assert.deepEqual(result.deliveries.map(d => d.username).sort(), ['Arjun Sharma', 'Dr. Anjali Mehta']);
});

test('a non-emergency proposal leaves restricted members out', async () => {
    await restrict(['all_doctors']);
    const { proposal, question } = await proposeEscalation({
        circleId: 'c1', userId: 'p1', type: 'CRITICAL', details: 'd', messageId: 2,
        notifyCaregivers: true, caregiverMessage: 'c', patientUsername: 'Ramesh Sharma'
    });
    assert.deepEqual(proposal.recipients.map(r => r.username), ['Priya Sharma', 'Arjun Sharma']);
    assert.equal(question, 'Do you want me to alert Priya Sharma and Arjun Sharma now? Just reply yes.');
});

test('an emergency proposal names the restriction, asks explicitly and is never sent automatically', async () => {
    await restrict(['Priya Sharma']);
    const { proposal, question } = await proposeEscalation({
        circleId: 'c1', userId: 'p1', type: 'CRITICAL', details: 'd', messageId: 3,
        notifyCaregivers: true, caregiverMessage: 'c', patientUsername: 'Ramesh Sharma',
        autoSendAfterMs: 5 * 60 * 1000, emergency: true
    });
    assert.deepEqual(proposal.recipients.map(r => r.username).sort(), ['Arjun Sharma', 'Dr. Anjali Mehta', 'Priya Sharma']);
    assert.deepEqual(proposal.overridesRestrictionFor, ['Priya Sharma']);
    assert.equal(proposal.autoSendAt, null);
    assert.match(question, /^You asked me not to share with Priya Sharma\. Because this could be an emergency, I'd like to alert them anyway, but only if you say so\. Do you want me to alert/);
    assert.ok(!question.includes('automatically'));
});

test('an emergency proposal with no restrictions keeps its automatic send', async () => {
    const { proposal, question } = await proposeEscalation({
        circleId: 'c1', userId: 'p1', type: 'CRITICAL', details: 'd', messageId: 4,
        notifyCaregivers: true, caregiverMessage: 'c', patientUsername: 'Ramesh Sharma',
        autoSendAfterMs: 5 * 60 * 1000, emergency: true
    });
    assert.ok(proposal.autoSendAt);
    assert.deepEqual(proposal.overridesRestrictionFor, []);
    assert.match(question, /^Do you want me to alert/);
});

test('when restrictions cannot be read, nobody is sent to', async () => {
    await db.run('ALTER TABLE sharing_restrictions RENAME TO sharing_restrictions_off');
    try {
        const split = await partitionRecipients({ circleId: 'c1', ownerUserId: 'p1', members: [daughter, doctor] });
        assert.equal(split.failedClosed, true);
        assert.deepEqual(split.allowed, []);
        const { sent } = await collectBroadcasts(() => shareWithMembers({ userId: 'p1', circleId: 'c1', members: [son], message: 'x' }));
        assert.deepEqual(sent, []);
    } finally {
        await db.run('ALTER TABLE sharing_restrictions_off RENAME TO sharing_restrictions');
    }
});

test('the reply prompt states the limits, and the final reply carries the code-written notice', () => {
    const known = buildKnownSection({ sharingRestrictionText: 'Priya Sharma' });
    assert.match(known, /the patient asked you not to share with Priya Sharma/);
    assert.match(buildKnownSection({ sharingRestrictionText: null }), /Do not offer to tell, alert or share with anyone/);
    assert.equal(buildKnownSection({ sharingRestrictionText: '' }), '');

    const { message } = composeFinalReply({
        modelText: 'I hear you.', criticality: 'NONE',
        notice: "Okay, I won't share anything with Priya Sharma unless you tell me otherwise."
    });
    assert.equal(message, "I hear you. Okay, I won't share anything with Priya Sharma unless you tell me otherwise.");
});

test('a stored restriction needs exactly one target', async () => {
    await assert.rejects(addRestriction({ circleId: 'c1', ownerUserId: 'p1' }));
    await assert.rejects(addRestriction({ circleId: 'c1', ownerUserId: 'p1', targetRole: 'neighbour' }));
});

// History reads: a restriction hides the owner's messages written inside its window

const T0 = 1_000_000_000_000;
const MIN = 60_000;
const saveAt = (userId, text, at, privacy = 'PUBLIC', criticality = 'NONE') => db.run(
    'INSERT INTO messages (circle_id, user_id, role, message, privacy_level, criticality_level, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['c1', userId, members.find(m => m.user_id === userId).role, text, privacy, criticality, at]);
const readAs = (userId) => runInTurn({ userId, conversationId: 'conv', jobId: 'job' }, () => getRecentMessages('c1', 20))
    .then(rows => rows.map(r => r.message).sort());

test("a restricted member cannot read the owner's messages inside the window, even PUBLIC ones", async () => {
    await saveAt('p1', 'before', T0 - 10 * MIN);
    await saveAt('p1', 'just before', T0 - 30_000);
    await saveAt('p1', 'during', T0 + 5 * MIN);
    await saveAt('g1', 'priya own', T0 + 6 * MIN, 'PRIVATE');
    await saveAt('d1', 'doctor note', T0 + 7 * MIN);
    await addRestriction({ circleId: 'c1', ownerUserId: 'p1', targetUserId: 'g1', nowMs: T0, effectiveFrom: T0 - MIN });

    assert.deepEqual(await readAs('g1'), ['before', 'doctor note', 'priya own']);
    // Others are unaffected: the doctor still sees the patient's PUBLIC messages
    assert.deepEqual(await readAs('d1'), ['before', 'doctor note', 'during', 'just before']);
    assert.deepEqual(await readAs('p1'), ['before', 'doctor note', 'during', 'just before']);
});

test('lifting a restriction shows new messages but keeps the window hidden', async () => {
    await addRestriction({ circleId: 'c1', ownerUserId: 'p1', targetUserId: 'g1', nowMs: T0, effectiveFrom: T0 - MIN });
    await saveAt('p1', 'during', T0 + MIN);
    await revokeRestrictions({ circleId: 'c1', ownerUserId: 'p1', targetUserId: 'g1', nowMs: T0 + 10 * MIN });
    await saveAt('p1', 'after', T0 + 11 * MIN);
    assert.deepEqual(await readAs('g1'), ['after']);
});

test('a role restriction hides the window from every member with that role', async () => {
    await addRestriction({ circleId: 'c1', ownerUserId: 'p1', targetRole: 'caregiver', nowMs: T0, effectiveFrom: T0 - MIN });
    await saveAt('p1', 'during', T0 + MIN);
    assert.deepEqual(await readAs('g1'), []);
    assert.deepEqual(await readAs('g2'), []);
    assert.deepEqual(await readAs('d1'), ['during']);
});

test("a restricted member is not told of the owner's emergency through the carry-over check", async () => {
    await addRestriction({ circleId: 'c1', ownerUserId: 'p1', targetUserId: 'g1', nowMs: T0, effectiveFrom: T0 - MIN });
    await saveAt('p1', 'chest pain', T0 + MIN, 'PUBLIC', 'HIGH');
    const highFor = (u) => runInTurn({ userId: u, conversationId: 'conv', jobId: 'job' }, () => hasRecentHighMessage('c1', T0));
    assert.equal(await highFor('g1'), false);
    assert.equal(await highFor('d1'), true);
});

test('when restrictions cannot be read, a reader gets only their own messages', async () => {
    await saveAt('p1', 'patient public', T0);
    await saveAt('g1', 'priya own', T0 + MIN);
    await db.run('ALTER TABLE sharing_restrictions RENAME TO sharing_restrictions_off');
    try {
        assert.deepEqual(await readAs('g1'), ['priya own']);
    } finally {
        await db.run('ALTER TABLE sharing_restrictions_off RENAME TO sharing_restrictions');
    }
});

test('a restriction set in a turn starts a minute before the turn', async () => {
    const startedAt = Date.now();
    await runInTurn({ userId: 'p1', conversationId: 'conv', jobId: 'job', startedAt }, () => restrict(['Priya Sharma']));
    const row = await db.get('SELECT effective_from, created_at FROM sharing_restrictions');
    assert.equal(row.effective_from, startedAt - RESTRICTION_LOOKBACK_MS);
    assert.ok(row.created_at >= startedAt);
});

test("the restricted reader's prompt asks for a neutral answer that reveals nothing", async () => {
    await restrict(['Priya Sharma']);
    assert.equal(await describeWithheldFrom('c1', 'g1', members), 'Ramesh Sharma');
    assert.equal(await describeWithheldFrom('c1', 'd1', members), '');
    const guidance = withheldGuidance('Ramesh Sharma');
    assert.match(guidance, /do not have an update from them that you can share/);
    assert.match(guidance, /Do not say or hint that anything is being kept private/);
    assert.equal(withheldGuidance(''), '');
    assert.match(withheldGuidance(null), /some circle members/);
    assert.match(buildKnownSection({ withheldFrom: 'Ramesh Sharma' }), /Updates not available/);
});
