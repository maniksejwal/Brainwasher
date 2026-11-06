/**
 * @fileoverview tests/fact_storage.test.js
 * Facts from the extractor are stored as readable values under the right subject.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { setGlobalDb } from '../db/index.js';
import { initializeDatabase } from '../db/schema.js';
import { flattenFacts, handleFactProcessing } from '../handlers/message_logic/conflictHandler.js';

let db;

before(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    setGlobalDb(db);
    await initializeDatabase();
    await db.exec('PRAGMA foreign_keys = OFF');
    await db.run('INSERT INTO users (user_id, username, created_at) VALUES (?, ?, ?)', ['p1', 'pat', Date.now()]);
});

test('a speaker wrapper is removed and empty values are dropped', () => {
    assert.deepEqual(
        flattenFacts({ speaker: { medication_adherence: 'skipped evening dose', symptom_report: '' } }),
        { medication_adherence: 'skipped evening dose' }
    );
});

test('a wrapper with the speaker\'s own name is treated as the speaker', () => {
    assert.deepEqual(flattenFacts({ Pat: { location: 'home' } }, new Set(['pat'])), { location: 'home' });
});

test('an others wrapper stays about another person, and a named one keeps its subject', () => {
    assert.deepEqual(flattenFacts({ others: { other_person_symptom: 'dizzy', mood: 'low' } }), {
        other_person_symptom: 'dizzy',
        other_person_mood: 'low'
    });
    assert.deepEqual(flattenFacts({ Priya: { symptom: 'dizzy' } }), {
        Priya_symptom: { value: 'dizzy', subject_id: 'Priya' }
    });
});

test('plain and rich facts pass through, unless empty', () => {
    const rich = { value: 'home', subject_id: 'self' };
    assert.deepEqual(
        flattenFacts({ a: 'text', rich, none: 'none', blank: { value: '' }, nothing: null }),
        { a: 'text', rich }
    );
});

test('a nested value is kept as readable text', () => {
    assert.deepEqual(flattenFacts({ speaker: { vitals: { bp: '150/95' } } }), { vitals: '{"bp":"150/95"}' });
});

test('stored rows hold the real values, never [object Object]', async () => {
    await handleFactProcessing('p1', 'c1', {
        facts: { speaker: { living_arrangement: 'alone', symptom_report: '' }, pat: { support: 'son visits on Sundays' } }
    });
    const rows = await db.all('SELECT fact_key, value, subject_id FROM facts_v2 ORDER BY fact_key');
    assert.deepEqual(rows, [
        { fact_key: 'living_arrangement', value: 'alone', subject_id: 'p1' },
        { fact_key: 'support', value: 'son visits on Sundays', subject_id: 'p1' }
    ]);
});
