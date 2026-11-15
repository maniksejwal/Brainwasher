/**
 * @fileoverview tests/action_selector.test.js
 * The action selector plans a patient's turn, never runs for HIGH turns or other roles,
 * and its plan reaches the reply prompt. No LLM calls are made.
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
let reply = {};
mock.module(new URL('../agents/api_client.js', import.meta.url).href, {
    // reply is one answer for every call, or a list answered in order
    namedExports: { makeApiCall: async (prompt) => { calls.push(prompt); return Array.isArray(reply) ? reply.shift() : reply; } }
});

const { selectAction, formatHistory, availableActionsByStress, getRecentActions, clearRecentActions, leavesAskUnanswered } = await import('../companions/agents/actionSelector.js');
const { buildPlannedAction } = await import('../companions/agents/patientOptimizer.js');
const { loadPrompt } = await import('../companions/utils/promptLoader.js');

const history = [
    { user_id: 'p1', role: 'patient', message: 'I keep forgetting my evening pills' },
    { user_id: 'agent', role: 'patient_agent', message: 'What usually gets in the way in the evening?' },
    { user_id: 'g1', role: 'caregiver', message: 'private: she hides them' },
    { user_id: 'agent', role: 'caregiver_agent', message: 'Thanks for telling me.' }
];

beforeEach(() => {
    calls.length = 0;
    clearRecentActions();
    reply = { action: 'empathic_reflection', frames_component: 'Empathy', stress_gate_check: 'passed', strategy_note: 'Reflect the frustration first.' };
});

test('a patient turn gets a plan, and the prompt has no unfilled slots', async () => {
    const plan = await selectAction('p1', 'patient', 'I am just tired of it', { history });
    assert.equal(plan.selectedAction, 'empathic_reflection');
    assert.equal(plan.framesComponent, 'Empathy');
    assert.equal(plan.strategyNote, 'Reflect the frustration first.');
    assert.equal(calls.length, 1);
    assert.ok(!/\{\{\w+\}\}/.test(calls[0]));
    assert.ok(calls[0].includes('Last companion reply was a question: true'));
});

test('recent actions are remembered per patient and shown to the selector', async () => {
    clearRecentActions();
    await selectAction('p1', 'patient', 'a', { circleId: 'c1' });
    reply = { action: 'open_question', stress_gate_check: 'passed' };
    await selectAction('p1', 'patient', 'b', { circleId: 'c1' });
    await selectAction('p1', 'patient', 'c', { circleId: 'c1' });
    await selectAction('p1', 'patient', 'd', { circleId: 'c1' });
    assert.ok(calls[0].includes('Recent actions (most recent last): none'));
    assert.ok(calls[1].includes('Recent actions (most recent last): empathic_reflection'));
    assert.deepEqual(getRecentActions('c1', 'p1'), ['open_question', 'open_question', 'open_question']);
    assert.deepEqual(getRecentActions('c2', 'p1'), []);
});

test('repeating an action makes no second call', async () => {
    await selectAction('p1', 'patient', 'still scared', { circleId: 'c1' });
    await selectAction('p1', 'patient', 'really scared', { circleId: 'c1' });
    assert.equal(calls.length, 2);
    assert.deepEqual(getRecentActions('c1', 'p1'), ['empathic_reflection', 'empathic_reflection']);
});

const reschedule = [{ ask_id: 1, kind: 'request', text: 'move the appointment back a week', times_asked: 2 }];

test('the second look depends on open asks, not on the message wording', () => {
    assert.equal(leavesAskUnanswered(reschedule, 'empathic_reflection', null), true);
    assert.equal(leavesAskUnanswered(reschedule, 'give_options', null), false);
    assert.equal(leavesAskUnanswered(reschedule, 'empathic_reflection', 'give_facts'), false);
    assert.equal(leavesAskUnanswered([], 'empathic_reflection', null), false);
    assert.equal(leavesAskUnanswered(undefined, 'open_question', null), false);
});

test('a filler question with no open ask makes no second call', async () => {
    await selectAction('p1', 'patient', 'Work is crazy, you know?', { circleId: 'c1', openAsks: [] });
    assert.equal(calls.length, 1);
});

test('an unanswered ask gets one second look, and the open asks are in the prompt', async () => {
    reply = [
        { action: 'empathic_reflection', stress_gate_check: 'passed', strategy_note: 'Reflect the stress.' },
        { action: 'give_options', stress_gate_check: 'passed', strategy_note: 'Offer ways to rebook.' }
    ];
    const plan = await selectAction('p1', 'patient', 'Work has been crazy.', { circleId: 'c1', openAsks: reschedule });
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes('request: move the appointment back a week (asked 2 times)'));
    assert.ok(!calls[0].includes('[1]'));
    assert.ok(calls[1].includes('SECOND LOOK'));
    assert.deepEqual([plan.selectedAction, plan.strategyNote, plan.rechecked], ['give_options', 'Offer ways to rebook.', true]);
});

test('on the second look the model may keep its choice', async () => {
    reply = [
        { action: 'validate', stress_gate_check: 'passed' },
        { action: 'validate', stress_gate_check: 'passed', strategy_note: 'They need support first.' }
    ];
    const asks = [{ ask_id: 2, kind: 'question', text: 'why this happened to them', times_asked: 1 }];
    const plan = await selectAction('p1', 'patient', 'Why did this happen to me?', { circleId: 'c1', openAsks: asks });
    assert.equal(plan.selectedAction, 'validate');
    assert.equal(calls.length, 2);
});

test('a failed second look keeps the first plan', async () => {
    reply = [{ action: 'empathic_reflection', stress_gate_check: 'passed' }, { reply: 'not json' }];
    const plan = await selectAction('p1', 'patient', 'Can you help?', { circleId: 'c1', openAsks: reschedule });
    assert.equal(plan.selectedAction, 'empathic_reflection');
    assert.equal(plan.rechecked, undefined);
});

test('HIGH turns and other roles make no selector call', async () => {
    assert.equal(await selectAction('p1', 'patient', 'chest pain', { clinicalAssessment: { criticality: 'HIGH' } }), null);
    assert.equal(await selectAction('g1', 'caregiver', 'how is she?', {}), null);
    assert.equal(calls.length, 0);
});

test('other members\' messages are not shown to the selector', async () => {
    const text = formatHistory(history, 'p1');
    assert.equal(text, 'Patient: I keep forgetting my evening pills\nCompanion: What usually gets in the way in the evening?');
    await selectAction('p1', 'patient', 'hi', { history });
    assert.ok(!calls[0].includes('she hides them'));
});

test('a blocked or unknown action becomes validate', async () => {
    reply = { action: 'give_options', stress_gate_check: 'blocked' };
    assert.equal((await selectAction('p1', 'patient', 'x', {})).selectedAction, 'validate');
    clearRecentActions();
    reply = { action: 'call_for_help', stress_gate_check: 'passed' };
    const plan = await selectAction('p1', 'patient', 'x', {});
    assert.deepEqual([plan.selectedAction, plan.framesComponent], ['validate', 'Responsibility']);
});

test('a failed or unparseable call gives no plan', async () => {
    reply = { reply: 'not json at all' };
    assert.equal(await selectAction('p1', 'patient', 'x', {}), null);
});

test('without physio data the medium-stress actions are offered, without the unported ones', () => {
    const actions = availableActionsByStress('medium');
    assert.ok(actions.includes('open_question'));
    assert.ok(!actions.includes('challenger_insight') && !actions.includes('loss_frame'));
});

test('the plan reaches the reply prompt before the action contract, and is absent without one', () => {
    const line = buildPlannedAction({ selectedAction: 'give_facts', framesComponent: 'Feedback', strategyNote: 'Explain why evening doses matter.' });
    assert.ok(line.startsWith('**Planned action this turn:** give_facts (FRAMES: Feedback).'));
    const prompt = loadPrompt('patient_optimizer', { PLANNED_ACTION: line, KNOWN_SECTION: '' });
    assert.ok(prompt.indexOf('Planned action this turn') < prompt.indexOf('**CAPABILITIES'));
    assert.equal(buildPlannedAction({}), '');
});
