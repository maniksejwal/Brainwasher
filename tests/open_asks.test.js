/**
 * @fileoverview tests/open_asks.test.js
 * A patient's questions and requests are tracked across turns until answered or dropped.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { setGlobalDb } from '../db/index.js';
import { initializeDatabase } from '../db/schema.js';
import { getOpenAsks, updateOpenAsks, formatOpenAsks, OPEN_ASK_MAX_AGE_MS } from '../db/queries_asks.js';
import { buildAsksContext } from '../companions/handlers/inputUnderstanding.js';
import { buildKnownSection } from '../companions/patientFacts.js';

let db;
const NOW = 1_800_000_000_000;

before(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    setGlobalDb(db);
    await initializeDatabase();
});

beforeEach(async () => {
    await db.run('DELETE FROM open_asks');
});

test('questions and requests are stored; rhetorical and malformed ones are not', async () => {
    const asks = await updateOpenAsks('c1', 'p1', {
        asks: [
            { text: 'move the appointment back a week', kind: 'request', same_as: null },
            { text: 'is it just stress', kind: 'rhetorical' },
            { text: '', kind: 'question' },
            { text: 'x', kind: 'demand' }
        ]
    }, NOW);
    assert.deepEqual(asks.map(a => [a.kind, a.text, a.times_asked]), [['request', 'move the appointment back a week', 1]]);
});

test('asking again counts as a repeat, not a new ask', async () => {
    const [first] = await updateOpenAsks('c1', 'p1', { asks: [{ text: 'reschedule', kind: 'request' }] }, NOW);
    const asks = await updateOpenAsks('c1', 'p1', { asks: [{ text: 'push it back', kind: 'request', same_as: first.ask_id }] }, NOW + 60_000);
    assert.equal(asks.length, 1);
    assert.equal(asks[0].times_asked, 2);
    assert.equal(asks[0].last_asked_at, NOW + 60_000);
});

test('answered and dropped asks close; an unknown or another patient\'s ID changes nothing', async () => {
    const [a] = await updateOpenAsks('c1', 'p1', { asks: [{ text: 'why is my sugar high', kind: 'question' }] }, NOW);
    const [other] = await updateOpenAsks('c1', 'p2', { asks: [{ text: 'other patient', kind: 'question' }] }, NOW);
    await updateOpenAsks('c1', 'p1', { resolved: [{ id: other.ask_id, how: 'answered' }, { id: 999, how: 'answered' }, { id: a.ask_id, how: 'maybe' }] }, NOW);
    assert.equal((await getOpenAsks('c1', 'p1', NOW)).length, 1);
    assert.equal((await getOpenAsks('c1', 'p2', NOW)).length, 1);

    const after = await updateOpenAsks('c1', 'p1', { resolved: [{ id: a.ask_id, how: 'answered' }] }, NOW);
    assert.deepEqual(after, []);
    assert.equal((await db.get('SELECT status FROM open_asks WHERE ask_id = ?', [a.ask_id])).status, 'answered');
});

test('an ask not raised for a week is no longer open', async () => {
    await updateOpenAsks('c1', 'p1', { asks: [{ text: 'old', kind: 'question' }] }, NOW);
    assert.equal((await getOpenAsks('c1', 'p1', NOW + OPEN_ASK_MAX_AGE_MS + 1)).length, 0);
});

test('the model gets IDs and the last reply; patients only', async () => {
    await updateOpenAsks('c1', 'p1', { asks: [{ text: 'reschedule', kind: 'request' }] });
    const history = [
        { user_id: 'p1', role: 'patient', message: 'can we reschedule?' },
        { user_id: 'agent', role: 'patient_agent', message: 'Work sounds stressful.' },
        { user_id: 'agent', role: 'caregiver_agent', message: 'to caregiver' }
    ];
    const text = await buildAsksContext('patient', 'c1', 'p1', history);
    assert.match(text, /- \[\d+\] request: reschedule/);
    assert.ok(text.includes('"Work sounds stressful."'));
    assert.equal(await buildAsksContext('caregiver', 'c1', 'p1', history), '');
});

test('the reply prompt lists what the patient is still waiting for, without IDs', () => {
    const section = buildKnownSection({ openAsks: [{ ask_id: 7, kind: 'request', text: 'reschedule', times_asked: 2 }] });
    assert.ok(section.includes('**Still waiting for an answer:**'));
    assert.ok(section.includes('- request: reschedule (asked 2 times)'));
    assert.ok(!section.includes('[7]'));
    assert.equal(formatOpenAsks([]), '');
    assert.equal(buildKnownSection({ openAsks: [] }), '');
});
