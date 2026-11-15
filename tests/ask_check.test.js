/**
 * @fileoverview tests/ask_check.test.js
 * A reply that ignores the patient's open asks is written once more, and asks the final
 * reply addresses are closed. No LLM calls are made.
 */
import { test, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
let verdicts = [];
mock.module(new URL('../agents/api_client.js', import.meta.url).href, {
    namedExports: { makeApiCall: async (prompt) => { calls.push(prompt); return verdicts.shift(); } }
});

const sqlite3 = (await import('sqlite3')).default;
const { open } = await import('sqlite');
const { setGlobalDb } = await import('../db/index.js');
const { initializeDatabase } = await import('../db/schema.js');
const { updateOpenAsks, getOpenAsks } = await import('../db/queries_asks.js');
const { checkReplyAddressesAsks } = await import('../companions/agents/askChecker.js');
const { ensureAsksAddressed } = await import('../handlers/message_logic/replyWriter.js');
const { buildKnownSection } = await import('../companions/patientFacts.js');

let db;
let asks;

before(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    setGlobalDb(db);
    await initializeDatabase();
});

beforeEach(async () => {
    calls.length = 0;
    verdicts = [];
    await db.run('DELETE FROM open_asks');
    asks = await updateOpenAsks('c1', 'p1', {
        asks: [{ text: 'move the appointment back a week', kind: 'request' }, { text: 'is the rash serious', kind: 'question' }]
    });
});

const run = (overrides = {}) => {
    const writes = [];
    return {
        writes,
        promise: ensureAsksAddressed({
            userId: 'p1', role: 'patient', message: 'Can we push it back?', circleId: 'c1',
            analysis: { criticality: 'NONE', replyContext: { openAsks: asks } },
            modelText: 'Work sounds stressful. What else is going on?',
            actions: {},
            write: async (violations, extra) => { writes.push(extra); return overrides.retryText ?? 'You can call the clinic to move it. A small red spot is usually harmless.'; },
            ...overrides.params
        })
    };
};

test('the checker reads numbers, and an ask it leaves out counts as missed', async () => {
    const [a, b] = asks;
    verdicts = [{ addressed: [String(a.ask_id), 999], not_addressed: [] }];
    const result = await checkReplyAddressesAsks('reply', asks, 'msg');
    assert.deepEqual(result.addressed, [a.ask_id]);
    assert.deepEqual(result.missed.map(x => x.ask_id), [b.ask_id]);
    assert.ok(calls[0].includes(`${a.ask_id}. request: move the appointment back a week`));
});

test('a reply that addresses every ask is kept, and the asks close', async () => {
    verdicts = [{ addressed: asks.map(a => a.ask_id), not_addressed: [] }];
    const { promise, writes } = run();
    const { text, report } = await promise;
    assert.equal(text, 'Work sounds stressful. What else is going on?');
    assert.equal(writes.length, 0);
    assert.deepEqual(report, { open: 2, addressed: 2, missed: 0, retried: false, closed: 2 });
    assert.deepEqual(await getOpenAsks('c1', 'p1'), []);
});

test('a reply that misses asks is written again naming them, and the better one is used', async () => {
    verdicts = [{ addressed: [], not_addressed: asks.map(a => a.ask_id) }, { addressed: asks.map(a => a.ask_id), not_addressed: [] }];
    const { promise, writes } = run();
    const { text, report } = await promise;
    assert.equal(writes.length, 1);
    assert.equal(writes[0].missedAsks.length, 2);
    assert.ok(text.startsWith('You can call the clinic'));
    assert.equal(report.retried, true);
    assert.equal(report.closed, 2);
});

test('a retry that addresses less, or makes a false claim, is not used', async () => {
    verdicts = [{ addressed: [asks[0].ask_id], not_addressed: [asks[1].ask_id] }, { addressed: [], not_addressed: [] }];
    let { promise } = run();
    let result = await promise;
    assert.equal(result.text, 'Work sounds stressful. What else is going on?');
    assert.equal(result.report.closed, 1);
    assert.equal((await getOpenAsks('c1', 'p1')).length, 1);

    asks = await getOpenAsks('c1', 'p1');
    verdicts = [{ addressed: [], not_addressed: [asks[0].ask_id] }];
    ({ promise } = run({ retryText: "I've told your doctor and they will call you." }));
    result = await promise;
    assert.equal(result.text, 'Work sounds stressful. What else is going on?');
    assert.equal(result.report.retried, false);
    assert.equal(calls.length, 3, 'no recheck of a retry that failed the false claim check');
});

test('HIGH turns, other roles, no open asks and a failed check change nothing', async () => {
    for (const params of [
        { analysis: { criticality: 'HIGH', replyContext: { openAsks: asks } } },
        { role: 'caregiver' },
        { analysis: { criticality: 'NONE', replyContext: { openAsks: [] } } }
    ]) {
        const { text, report } = await run({ params }).promise;
        assert.equal(text, 'Work sounds stressful. What else is going on?');
        assert.equal(report, null);
    }
    assert.equal(calls.length, 0);
    verdicts = [{ reply: 'not json' }];
    assert.equal((await run().promise).report, null);
    assert.equal((await getOpenAsks('c1', 'p1')).length, 2);
});

test('a repeat given as text instead of a number still counts as a repeat', async () => {
    const after = await updateOpenAsks('c1', 'p1', { asks: [{ text: 'push it back', kind: 'request', same_as: 'Move the appointment back a week' }] });
    assert.equal(after.length, 2);
    assert.equal(after.find(a => a.text === 'move the appointment back a week').times_asked, 2);
});

test('the rewrite prompt names what the previous draft missed', () => {
    const section = buildKnownSection({ missedAsks: [{ kind: 'question', text: 'is the rash serious', times_asked: 3 }] });
    assert.ok(section.includes('**Your previous draft did not address:**'));
    assert.ok(section.includes('- question: is the rash serious (asked 3 times)'));
});
