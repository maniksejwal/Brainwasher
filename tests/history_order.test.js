/**
 * @fileoverview tests/history_order.test.js
 * Repetition detection must read the user's newest messages, not their oldest.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { setGlobalDb } from '../db/index.js';
import { initializeDatabase } from '../db/schema.js';
import { processHistoryAnalysis } from '../companions/handlers/historyAnalyzer.js';

let db;

async function addMessages(circleId, texts) {
    const base = Date.now() - 100000;
    for (const [i, text] of texts.entries()) {
        await db.run(
            'INSERT INTO messages (circle_id, user_id, role, message, privacy_level, criticality_level, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [circleId, 'p1', 'patient', text, 'PRIVATE', 'NONE', base + i]
        );
    }
}

before(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    setGlobalDb(db);
    await initializeDatabase();
    const now = Date.now();
    await db.run('INSERT INTO users (user_id, username, created_at) VALUES (?, ?, ?)', ['p1', 'pat', now]);
    for (const circleId of ['recent', 'old']) {
        await db.run('INSERT INTO care_circles (circle_id, primary_patient_id, created_at) VALUES (?, ?, ?)', [circleId, 'p1', now]);
    }
});

test('a repeat among the newest messages is detected', async () => {
    await addMessages('recent', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'g']);
    const result = await processHistoryAnalysis('p1', 'patient', 'g', 'recent', {});
    assert.equal(result.isRepetitive, true);
});

test('a repeat older than the newest five messages is ignored', async () => {
    await addMessages('old', ['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g']);
    const result = await processHistoryAnalysis('p1', 'patient', 'g', 'old', {});
    assert.equal(result.isRepetitive, false);
});
