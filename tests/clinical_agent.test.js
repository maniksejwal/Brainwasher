/**
 * @fileoverview tests/clinical_agent.test.js
 * The clinical agent trusts the LLM's criticality, retries a failed call once, falls back
 * to MEDIUM after that, and fills its context hints from non-message data. No LLM calls.
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
const callArgs = [];
let replies = [];
mock.module(new URL('../agents/api_client.js', import.meta.url).href, {
    namedExports: {
        makeApiCall: async (prompt, ...rest) => {
            calls.push(prompt);
            callArgs.push(rest);
            const next = replies.shift();
            if (next instanceof Error) throw next;
            return next;
        }
    }
});
mock.module(new URL('../db/queries_facts.js', import.meta.url).href, {
    namedExports: { getCurrentFact: async () => ({ value: 'yes, uses analogies often' }) }
});

const { processClinicalAnalysis, buildClinicalHints, FALLBACK_CRITICALITY, CLINICAL_TEMPERATURE, CLINICAL_USE_CASE } = await import('../companions/agents/clinicalAgent.js');

beforeEach(() => {
    calls.length = 0;
    callArgs.length = 0;
    replies = [];
});

test('the rating uses temperature 0 and the clinical use case, which selects its own model', async () => {
    replies = [{ assessment: 'ok', criticality: 'LOW' }];
    await processClinicalAnalysis('p1', 'patient', 'mild headache', 'c1', {});
    assert.equal(CLINICAL_TEMPERATURE, 0);
    const [history, expectJson, temperature, , useCase] = callArgs[0];
    assert.deepEqual(history, []);
    assert.equal(expectJson, true);
    assert.equal(temperature, 0);
    assert.equal(useCase, CLINICAL_USE_CASE);
});

test('the LLM criticality is used as given, with no keyword override', async () => {
    replies = [{ assessment: 'Mild ache', criticality: 'HIGH', high_category: 'MEDICAL_EMERGENCY' }];
    const result = await processClinicalAnalysis('p1', 'patient', 'I have a little pain', 'c1', {});
    assert.equal(result.criticality, 'HIGH');
    assert.equal(result.highCategory, 'MEDICAL_EMERGENCY');
    assert.equal(result.llmFallback, false);
    assert.equal(calls.length, 1);
    assert.ok(!/\{\{\w+\}\}/.test(calls[0]), 'no unfilled prompt slots');
    assert.ok(calls[0].includes('yes, uses analogies often'));
});

test('a failed call is retried once and the second answer is used', async () => {
    replies = [new Error('throttled'), { assessment: 'Routine', criticality: 'LOW' }];
    const result = await processClinicalAnalysis('p1', 'patient', 'Took my pills', 'c1', {});
    assert.equal(calls.length, 2);
    assert.equal(result.criticality, 'LOW');
    assert.equal(result.llmFallback, false);
});

test('two failures give MEDIUM with llmFallback, never LOW', async () => {
    replies = [{ reply: 'down', isFallback: true }, { assessment: 'no criticality field' }];
    const result = await processClinicalAnalysis('p1', 'patient', 'My chest hurts', 'c1', {});
    assert.equal(calls.length, 2);
    assert.equal(FALLBACK_CRITICALITY, 'MEDIUM');
    assert.equal(result.criticality, 'MEDIUM');
    assert.equal(result.llmFallback, true);
    assert.equal(result.highCategory, null);
});

test('hints come from context, not the message text', () => {
    const quiet = buildClinicalHints({});
    assert.match(quiet.hasSevereIndicators, /^unknown/);
    assert.match(quiet.isSimplePain, /^unknown/);
    assert.equal(quiet.isFallForElderly, 'not applicable');
    assert.equal(quiet.userAge, 'unknown');

    const hints = buildClinicalHints({ stressLevel: 'high', priorCriticality: 'LOW', escalationActive: false, userAge: '72' });
    assert.match(hints.hasSevereIndicators, /^yes/);
    assert.match(hints.isSimplePain, /^possibly/);
    assert.match(hints.isFallForElderly, /72 years old/);
    assert.equal(hints.userAge, '72');

    assert.match(buildClinicalHints({ priorCriticality: 'LOW', escalationActive: true }).isSimplePain, /^unknown/);
    assert.equal(buildClinicalHints({ userAge: 40 }).isFallForElderly, 'not applicable');
});
