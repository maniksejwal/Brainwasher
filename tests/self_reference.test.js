/**
 * @fileoverview tests/self_reference.test.js
 * A speaker's own name is not a third party, and analogy use is stored as a fact.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { setGlobalDb } from '../db/index.js';
import { initializeDatabase } from '../db/schema.js';
import { getCurrentFact } from '../db/queries_facts.js';
import {
    speakerNames,
    normalizeSelfFacts,
    otherMentions,
    recordAnalogyUse
} from '../handlers/message_logic/selfReference.js';

const manik = { username: 'manik_s', profile_data: JSON.stringify({ first_name: 'Manik', full_name: 'Manik Sharma' }) };

before(async () => {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    setGlobalDb(db);
    await initializeDatabase();
    const now = Date.now();
    await db.run('INSERT INTO users (user_id, username, created_at) VALUES (?, ?, ?)', ['p1', 'pat', now]);
    await db.run('INSERT INTO care_circles (circle_id, primary_patient_id, created_at) VALUES (?, ?, ?)', ['c1', 'p1', now]);
});

test('names come from the username and profile, ignoring case', () => {
    assert.deepEqual([...speakerNames(manik)].sort(), ['manik', 'manik sharma', 'manik_s']);
});

test('a broken profile or no speaker still works', () => {
    assert.deepEqual([...speakerNames({ username: 'a', profile_data: '{bad' })], ['a']);
    assert.equal(speakerNames(null).size, 0);
});

test('only facts naming the speaker become self-facts', () => {
    const facts = normalizeSelfFacts({
        mine: { value: 'forgot meds', subject_id: 'Manik' },
        wife: { value: 'worried', subject_id: 'Emily' },
        plain: 'just text'
    }, speakerNames(manik));

    assert.equal(facts.mine.subject_id, 'self');
    assert.equal(facts.wife.subject_id, 'Emily');
    assert.equal(facts.plain, 'just text');
});

test('the speaker is removed from mentions, and others stay', () => {
    assert.deepEqual(otherMentions(['MANIK', 'Emily'], speakerNames(manik)), ['Emily']);
    assert.deepEqual(otherMentions(undefined, speakerNames(manik)), []);
});

test('analogy use is stored, and confidence builds with each use', async () => {
    await recordAnalogyUse('c1', 'p1');
    const first = await getCurrentFact('c1', 'communication_analogy_preference_p1');
    assert.equal(first.reported_by, 'p1');
    assert.equal(first.subject_id, 'p1');
    assert.equal(first.confidence, 0.2);

    for (let i = 0; i < 3; i++) await recordAnalogyUse('c1', 'p1');
    const later = await getCurrentFact('c1', 'communication_analogy_preference_p1');
    assert.ok(later.confidence >= 0.8);
    assert.equal(later.value, 'yes, uses analogies often');
});
