/**
 * @fileoverview tests/repeat_scorer.test.js
 * The repeated question metric, with a stand-in judge so no LLM is called.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionsIn, scoreRun, repeatTotals, buildRepeatPrompt } from '../training/simulation/action_claims/repeat_scorer.mjs';

const turn = (userId, message, reply) => ({ userId, message, toSpeaker: [{ text: reply }] });

test('finds questions and leaves out the alert confirmation', () => {
    assert.deepEqual(
        questionsIn('Sorry to hear that. Where are you now? Do you want me to alert Priya now? Just reply yes.'),
        ['Where are you now?']
    );
    assert.deepEqual(questionsIn('Please call 112.'), []);
});

test('only replies with questions are judged, each against that speaker alone', async () => {
    const prompts = [];
    const run = {
        turns: [
            turn('p', 'I am at home', 'Noted.'),
            turn('c', 'She is my mother', 'What is your name?'),
            turn('p', 'I feel dizzy', 'Where are you?')
        ]
    };
    await scoreRun(run, async (prompt) => {
        prompts.push(prompt);
        return { repeated: true, question: 'Where are you?', evidence: 'I am at home' };
    });

    assert.equal(prompts.length, 2);
    assert.equal(run.turns[0].repeatCheck, undefined);
    assert.ok(prompts[1].includes('I am at home') && prompts[1].includes('I feel dizzy'));
    assert.ok(!prompts[1].includes('She is my mother'));
    assert.equal(run.turns[2].repeatCheck.repeated, true);
});

test('a judge failure is unscored, not counted as no repeat', async () => {
    const run = { turns: [turn('p', 'hi', 'How are you?'), turn('p', 'ok', 'Why?')] };
    let calls = 0;
    await scoreRun(run, async () => {
        calls++;
        if (calls === 1) throw new Error('down');
        return { repeated: false };
    });

    assert.deepEqual(repeatTotals(run.turns), { asked: 2, repeated: 0, unscored: 1 });
});

test('a judge answer with no verdict is unscored', async () => {
    const run = { turns: [turn('p', 'hi', 'How are you?')] };
    await scoreRun(run, async () => ({ reply: 'not sure' }));
    assert.equal(run.turns[0].repeatCheck.repeated, null);
});

test('re-scoring replaces an earlier result', async () => {
    const run = { turns: [turn('p', 'hi', 'Fine.')] };
    run.turns[0].repeatCheck = { repeated: true };
    await scoreRun(run, async () => ({ repeated: false }));
    assert.equal(run.turns[0].repeatCheck, undefined);
});

test('the prompt lists what was said and what was asked', () => {
    const prompt = buildRepeatPrompt(['I am at home'], ['Where are you?']);
    assert.ok(prompt.includes('1. I am at home') && prompt.includes('1. Where are you?'));
});
