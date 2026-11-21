/**
 * @fileoverview tests/demo_mock.test.js
 * Tests for the scripted demo mode (services/demoMock.js): script order, the caregiver
 * hand-off, fallback for other users and reset. In-memory database; no LLM calls.
 *
 * Run with: node --test --test-force-exit tests/demo_mock.test.js
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let events, demo, runTurn;
const sent = [];
const fallbackJobs = [];

before(async () => {
    process.env.DEMO_REPLY_DELAY_MS = '0';
    const { setGlobalDb, addUser } = await import('../db/index.js');
    const { initializeDatabase } = await import('../db/schema.js');
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    setGlobalDb(db);
    await initializeDatabase();
    await addUser('u-karthik', 'Karthik Raman');
    await addUser('u-divya', 'Divya Karthik');
    await addUser('u-other', 'Someone Else');

    ({ events } = await import('../orchestrator.js'));
    demo = await import('../services/demoMock.js');
    events.on('broadcast', payload => sent.push({ to: payload.targetUsers[0], text: payload.reply }));
    runTurn = demo.createDemoRunTurn(async job => { fallbackJobs.push(job); });
});

beforeEach(() => {
    sent.length = 0;
    fallbackJobs.length = 0;
    demo.resetDemoMock();
});

const karthik = text => runTurn({ user_id: 'u-karthik', circle_id: 'c1', text });
const divya = text => runTurn({ user_id: 'u-divya', circle_id: 'c2', text });

test('mock mode is off unless DEMO_MOCK_MODE=true', () => {
    delete process.env.DEMO_MOCK_MODE;
    assert.equal(demo.isDemoMockEnabled(), false);
    process.env.DEMO_MOCK_MODE = 'true';
    assert.equal(demo.isDemoMockEnabled(), true);
    delete process.env.DEMO_MOCK_MODE;
});

test('the full scenario runs in order and hands off to the caregiver', async () => {
    await karthik('vomiting, weak, thinking of stopping');
    assert.match(sent.at(-1).text, /safety check/);
    await karthik('no pain');
    await karthik('dose increased');
    await karthik('sugar 120');
    assert.match(sent.at(-1).text, /HbA1c[\s\S]*299 credits/);
    await karthik('Book it');
    assert.match(sent.at(-1).text, /Booked/);

    sent.length = 0;
    await karthik('Sure');
    assert.deepEqual(sent.map(m => m.to), ['u-karthik', 'u-divya']);
    assert.match(sent[1].text, /snoring less/);

    sent.length = 0;
    await karthik('any news?');
    assert.match(sent[0].text, /still waiting/);

    sent.length = 0;
    await divya('Yes, much less!');
    assert.deepEqual(sent.map(m => m.to), ['u-divya', 'u-karthik']);
    assert.match(sent[1].text, /snoring much less/);

    await karthik('Yes please');
    assert.match(sent.at(-1).text, /share this summary/);
});

test('reset starts the script again', async () => {
    await karthik('hi');
    await karthik('/demo reset');
    sent.length = 0;
    await karthik('hi again');
    assert.match(sent[0].text, /safety check/);
});

test('other users still go through the real pipeline', async () => {
    await runTurn({ user_id: 'u-other', circle_id: 'c3', text: 'hello' });
    assert.equal(fallbackJobs.length, 1);
    assert.equal(sent.length, 0);
});
