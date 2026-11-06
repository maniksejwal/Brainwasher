/**
 * @fileoverview tests/known_context.test.js
 * Fact retrieval returns only what a patient has said about themselves, in readable form.
 */
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { setGlobalDb } from '../db/index.js';
import { initializeDatabase } from '../db/schema.js';
import { addFact, retrieveRelevantFacts } from '../db/queries_facts.js';
import { loadKnownContext } from '../handlers/message_logic/knownContext.js';
import { getLongitudinalHint } from '../companions/physio/tensornetsBridge.js';

const DAY = 86_400_000;
let db;

const own = (key, value, extra = {}) =>
    addFact('c1', key, value, { reportedBy: 'p1', subjectId: 'p1', ...extra });
const get = (extra = {}) => retrieveRelevantFacts({ circleId: 'c1', subjectId: 'p1', ...extra });

before(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    setGlobalDb(db);
    await initializeDatabase();
    await db.exec('PRAGMA foreign_keys = OFF');
});

beforeEach(async () => {
    await db.run('DELETE FROM facts_v2');
});

afterEach(() => {
    delete process.env.TENSORNETS_URL;
});

test('a fact stored with the default sensitivity is found', async () => {
    await own('living_arrangement', 'alone');
    const { block, facts } = await get();
    assert.equal(facts.length, 1);
    assert.ok(block.includes('living arrangement: alone'));
});

test('another reporter\'s statement about the patient is left out', async () => {
    await addFact('c1', 'medication_adherence', 'hiding pills', { reportedBy: 'g1', subjectId: 'p1' });
    assert.deepEqual(await get(), { block: '', facts: [] });
});

test('facts about others, with no subject, and old unreadable rows are left out', async () => {
    await own('other_person_symptom', 'dizzy');
    await own('speaker', '[object Object]');
    await own('symptom_report', '');
    await addFact('c1', 'location', 'home', { reportedBy: 'p1', subjectId: null });
    await addFact('c1', 'mood', 'low', { reportedBy: 'g1', subjectId: 'g1' });
    assert.deepEqual(await get(), { block: '', facts: [] });
});

test('private, sensitive, expired, low-confidence and replaced facts are left out', async () => {
    await own('a', 'x', { sensitivity: 'private' });
    await own('b', 'x', { sensitivity: 'sensitive' });
    await own('c', 'x', { validUntil: Date.now() - 1000 });
    await own('d', 'x', { confidence: 0.2 });
    await own('e', 'old');
    await own('e', 'new');
    const { facts } = await get();
    assert.deepEqual(facts.map(f => f.value), ['new']);
});

test('this session\'s facts are labelled apart from older ones', async () => {
    await own('location', 'home');
    await own('living_arrangement', 'alone', { observedAt: Date.now() - 10 * DAY, validFrom: Date.now() - 10 * DAY });
    const { block } = await get();
    assert.ok(block.indexOf('CURRENT SESSION:') < block.indexOf('location: home'));
    assert.ok(block.indexOf('KNOWN CONTEXT:') < block.indexOf('living arrangement: alone'));
});

test('older facts are limited, but safety-critical ones always stay', async () => {
    const old = { observedAt: Date.now() - 400 * DAY, validFrom: Date.now() - 400 * DAY };
    await own('allergy_note', 'penicillin', { ...old, category: 'allergy', confidence: 0.5 });
    await own('newer', 'x', { observedAt: Date.now() - 2 * DAY, validFrom: Date.now() - 2 * DAY });
    await own('older', 'y', old);
    const { facts } = await get({ topK: 1 });
    assert.deepEqual(facts.map(f => f.fact_key).sort(), ['allergy_note', 'newer']);
});

test('the speaker\'s ID is not shown in a fact key', async () => {
    await own('communication_analogy_preference_p1', 'yes');
    const { block } = await get();
    assert.ok(block.includes('communication analogy preference: yes'));
    assert.ok(!block.includes('p1'));
});

test('only patients get known context', async () => {
    await own('location', 'home');
    assert.ok((await loadKnownContext('patient', 'c1', 'p1')).knownContextBlock.includes('home'));
    assert.deepEqual(await loadKnownContext('caregiver', 'c1', 'p1'), { knownContextBlock: '', longitudinalHint: '' });
});

test('with no TENSORNETS_URL no request is made', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('should not run'); });
    assert.equal(await getLongitudinalHint('p1'), '');
    assert.equal(fetchMock.mock.callCount(), 0);
});

test('the hint is returned, and a failed or slow server gives an empty hint', async (t) => {
    process.env.TENSORNETS_URL = 'http://bridge.test';
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ hint: 'three sessions' }) }));
    assert.equal(await getLongitudinalHint('p/1'), 'three sessions');
    assert.equal(fetchMock.mock.calls[0].arguments[0], 'http://bridge.test/therapy/prompt-hint/p%2F1');
    assert.ok(fetchMock.mock.calls[0].arguments[1].signal instanceof AbortSignal);

    fetchMock.mock.mockImplementation(async () => { throw new Error('timeout'); });
    assert.equal(await getLongitudinalHint('p1'), '');
});
