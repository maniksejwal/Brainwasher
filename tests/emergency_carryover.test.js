/**
 * @fileoverview tests/emergency_carryover.test.js
 * The emergency instruction stays on replies for 30 minutes after a HIGH turn, even when the
 * current message is rated lower, without showing one member's private emergency to another.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { setGlobalDb, hasRecentHighMessage } from '../db/index.js';
import { initializeDatabase } from '../db/schema.js';
import { runInTurn } from '../lib/turnContext.js';
import { composeFinalReply, CARRIED_EMERGENCY_SENTENCE } from '../utils/actionClaimGuard.js';
import { getEmergencySentence } from '../config/emergencyGuidance.js';
import { EMERGENCY_CARRY_WINDOW_MS, isEmergencyActive } from '../handlers/message_logic/replyWriter.js';

const MINUTE = 60_000;
let db;

async function addMessage({ circle = 'c1', user = 'p1', criticality = 'HIGH', privacy = 'PRIVATE', minutesAgo = 0 }) {
    await db.run(
        'INSERT INTO messages (circle_id, user_id, role, message, privacy_level, criticality_level, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [circle, user, 'patient', 'text', privacy, criticality, Date.now() - minutesAgo * MINUTE]
    );
}

const inTurn = (userId, fn) => runInTurn({ userId, conversationId: 'conv', jobId: 'job' }, fn);

before(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    setGlobalDb(db);
    await initializeDatabase();
    await db.exec('PRAGMA foreign_keys = OFF');
});

beforeEach(async () => {
    await db.run('DELETE FROM messages');
});

test('the window is 30 minutes', () => {
    assert.equal(EMERGENCY_CARRY_WINDOW_MS, 30 * MINUTE);
});

test('a HIGH turn inside the window keeps the emergency active', async () => {
    await addMessage({ minutesAgo: 29 });
    assert.equal(await isEmergencyActive('c1', 'MEDIUM'), true);
});

test('a HIGH turn outside the window does not', async () => {
    await addMessage({ minutesAgo: 31 });
    assert.equal(await isEmergencyActive('c1', 'MEDIUM'), false);
});

test('a lower-rated turn or another circle does not', async () => {
    await addMessage({ criticality: 'MEDIUM' });
    await addMessage({ circle: 'c2' });
    assert.equal(await isEmergencyActive('c1', 'MEDIUM'), false);
});

test('a HIGH turn uses its approved sentence, not the carried one', async () => {
    await addMessage({});
    assert.equal(await isEmergencyActive('c1', 'HIGH'), false);
});

test('outside an integration turn, another member\'s HIGH turn counts', async () => {
    await addMessage({ user: 'p1' });
    assert.equal(await hasRecentHighMessage('c1', Date.now() - MINUTE), true);
});

test('in an integration turn, another member\'s private HIGH turn stays hidden', async () => {
    await addMessage({ user: 'p1' });
    assert.equal(await inTurn('caregiver', () => isEmergencyActive('c1', 'MEDIUM')), false);
    assert.equal(await inTurn('p1', () => isEmergencyActive('c1', 'MEDIUM')), true);
});

test('in an integration turn, another member\'s public HIGH turn counts', async () => {
    await addMessage({ user: 'p1', privacy: 'PUBLIC' });
    assert.equal(await inTurn('caregiver', () => isEmergencyActive('c1', 'MEDIUM')), true);
});

test('a failed check does not stop the reply', async () => {
    assert.equal(await isEmergencyActive('c1', 'MEDIUM', async () => { throw new Error('db down'); }), false);
});

test('a carried turn opens with the carried sentence and one instruction only', () => {
    const { message } = composeFinalReply({
        modelText: 'Please call 112 now. Who is with you?',
        criticality: 'MEDIUM',
        emergencyActive: true
    });
    assert.ok(message.startsWith(CARRIED_EMERGENCY_SENTENCE));
    assert.equal(message.match(/112/g).length, 1);
    assert.ok(message.includes('Who is with you?'));
});

test('a HIGH turn keeps the approved sentence even when the emergency is active', () => {
    const { message } = composeFinalReply({ modelText: 'I hear you.', criticality: 'HIGH', emergencyActive: true });
    assert.ok(message.startsWith(getEmergencySentence(null)));
    assert.ok(!message.includes(CARRIED_EMERGENCY_SENTENCE));
});

test('with no active emergency a lower-rated reply is unchanged', () => {
    const { message } = composeFinalReply({ modelText: 'How did you sleep?', criticality: 'LOW' });
    assert.equal(message, 'How did you sleep?');
});
