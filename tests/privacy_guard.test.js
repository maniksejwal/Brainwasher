/**
 * @fileoverview tests/privacy_guard.test.js
 * The privacy guard classifies with the LLM, defaults to PRIVATE, never suggests sharing
 * SENSITIVE content and gates every suggestion, the doctor's included, through consent.
 * Also covers the most-restrictive privacy merge and the empathy physio slots. No LLM calls.
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
let reply = null;
let implied = null;
mock.module(new URL('../agents/api_client.js', import.meta.url).href, {
    namedExports: {
        makeApiCall: async (prompt) => {
            calls.push(prompt);
            if (reply instanceof Error) throw reply;
            return reply;
        }
    }
});

let members = [];
mock.module(new URL('../db/index.js', import.meta.url).href, {
    namedExports: {
        getCircleMembers: async () => members,
        findCircleById: async () => ({ circle_id: 'c1', primary_patient_id: 'p1' }),
        getImpliedConsent: async () => implied
    }
});

const { processPrivacyDecision, splitIntents, withDoctorContent } = await import('../companions/handlers/privacyGuard.js');
const { resolveConflicts } = await import('../companions/utils/responseAggregator.js');
const { physioInputs } = await import('../companions/handlers/empathyHandler.js');
const { loadPrompt } = await import('../companions/utils/promptLoader.js');
const { createPhysiologicalState } = await import('../companions/physio/state.js');

const patient = { user_id: 'p1', username: 'pat', role: 'patient' };
const caregiver = { user_id: 'g1', username: 'gina', role: 'caregiver', consent_level: 'none' };
const doctor = { user_id: 'd1', username: 'drdee', role: 'doctor', consent_level: 'none' };

beforeEach(() => {
    calls.length = 0;
    implied = null;
    members = [patient, caregiver, doctor];
    reply = { privacyLevel: 'PRIVATE', reasoning: 'health content', sharingSuggestion: null };
});

const run = (intent, message = 'hello', extra = {}) =>
    processPrivacyDecision('p1', 'patient', message, 'c1', { members, inputUnderstanding: { intent, ...extra } });

test('the LLM level is used and the prompt has no unfilled slots', async () => {
    reply = { privacyLevel: 'public', reasoning: 'greeting' };
    const result = await run('ASKING_QUESTION', 'Good morning');
    assert.equal(result.level, 'PUBLIC');
    assert.equal(result.llmFallback, false);
    assert.equal(calls.length, 1);
    assert.ok(!/\{\{\w+\}\}/.test(calls[0]));
    assert.ok(calls[0].includes('pat (patient, patient, speaking)'));
});

test('a failed or unusable classification defaults to PRIVATE', async () => {
    reply = new Error('throttled');
    assert.equal((await run('ASKING_QUESTION')).level, 'PRIVATE');
    reply = { reply: 'down', isFallback: true };
    const result = await run('ASKING_QUESTION');
    assert.equal(result.level, 'PRIVATE');
    assert.equal(result.llmFallback, true);
    reply = { privacyLevel: 'TOP_SECRET' };
    assert.equal((await run('ASKING_QUESTION')).level, 'PRIVATE');
});

test('a doctor request needs consent unless the doctor has full or implied consent', async () => {
    const gated = await run('REPORTING_FACT|REQUESTING_DOCTOR', 'I want to see my doctor');
    assert.equal(gated.sharingSuggestion.target, 'doctor');
    assert.equal(gated.sharingSuggestion.requiresConsent, true);
    assert.deepEqual(gated.consentCheck, { required: true, target: 'doctor' });

    members = [patient, { ...doctor, consent_level: 'full' }];
    const allowed = await run('REQUESTING_DOCTOR');
    assert.equal(allowed.sharingSuggestion.target, 'doctor');
    assert.equal(allowed.sharingSuggestion.requiresConsent, undefined);

    members = [patient];
    implied = { topic: 'general' };
    assert.equal((await run('REQUESTING_DOCTOR')).sharingSuggestion.requiresConsent, undefined);
});

test('the classifier suggesting the doctor is gated too, and a circle without a doctor still needs consent', async () => {
    members = [patient, caregiver];
    reply = { privacyLevel: 'PRIVATE', sharingSuggestion: { target: 'doctor', reason: 'symptoms', requiresConsent: false } };
    const result = await run('ASKING_QUESTION');
    assert.equal(result.sharingSuggestion.target, 'doctor');
    assert.equal(result.sharingSuggestion.requiresConsent, true);
});

test('SENSITIVE content gets no sharing suggestion, even for a doctor request', async () => {
    reply = { privacyLevel: 'SENSITIVE', sharingSuggestion: { target: 'gina' } };
    const result = await run('REQUESTING_DOCTOR', 'I relapsed on heroin');
    assert.equal(result.level, 'SENSITIVE');
    assert.equal(result.sharingSuggestion, null);
    assert.equal(result.consentCheck.required, false);
});

test('facts about another member become a gated suggestion; limited consent is marked', async () => {
    const facts = { caregiver_sleep: 'gina has not slept' };
    const result = await run('REPORTING_FACT', 'gina has not slept', { facts, mentionedUsernames: ['gina'] });
    assert.equal(result.sharingSuggestion.target, 'gina');
    assert.equal(result.sharingSuggestion.requiresConsent, true);
    assert.match(result.sharingSuggestion.content_to_share, /gina has not slept/);

    members = [patient, { ...caregiver, consent_level: 'limited' }];
    const limited = await run('REPORTING_FACT', 'gina has not slept', { facts, mentionedUsernames: ['gina'] });
    assert.equal(limited.sharingSuggestion.limitedConsent, true);
});

test('a suggested target outside the circle is dropped', async () => {
    reply = { privacyLevel: 'PRIVATE', sharingSuggestion: { target: 'stranger' } };
    assert.equal((await run('ASKING_QUESTION')).sharingSuggestion, null);
});

test('a request not to share never produces a suggestion, even when the classifier names the person', async () => {
    reply = { privacyLevel: 'PRIVATE', reasoning: 'r', sharingSuggestion: { target: 'gina', reason: 'mentioned', requiresConsent: true } };
    const result = await run('REQUESTING_NON_DISCLOSURE', "Don't tell gina", {
        mentionedUsernames: ['gina'], resolvedUsers: [{ matchedMember: caregiver }]
    });
    assert.equal(result.sharingSuggestion, null);
});

test('a member the speaker restricted is never suggested, and the prompt names them', async () => {
    const restrictions = [{ target_user_id: 'g1', target_role: null }];
    const result = await processPrivacyDecision('p1', 'patient', 'help me talk to gina', 'c1', {
        members, sharingRestrictions: restrictions,
        inputUnderstanding: { intent: 'REQUESTING_MEDIATION', mentionedUsernames: ['gina'], resolvedUsers: [{ matchedMember: caregiver }] }
    });
    assert.equal(result.sharingSuggestion, null);
    assert.ok(calls[0].includes('The speaker asked you not to share with: gina'));

    const unknown = await processPrivacyDecision('p1', 'patient', 'tell my doctor', 'c1', {
        members, sharingRestrictions: null, inputUnderstanding: { intent: 'REQUESTING_DOCTOR' }
    });
    assert.equal(unknown.sharingSuggestion, null, 'unreadable restrictions block every suggestion');
});

test('combined intents are split', () => {
    assert.deepEqual(splitIntents(' reporting_fact | REQUESTING_DOCTOR '), ['REPORTING_FACT', 'REQUESTING_DOCTOR']);
    assert.deepEqual(splitIntents(undefined), []);
});

test('the privacy guard level counts in the most-restrictive merge', () => {
    const resolved = resolveConflicts({ privacyLevel: 'PRIVATE' }, {
        privacyGuard: { result: { level: 'SENSITIVE' } },
        clinicalAgent: { result: { privacyLevel: 'PRIVATE' } }
    });
    assert.equal(resolved.privacyLevel, 'SENSITIVE');
});

test('empathy physio slots are empty without physio data and filled with it', () => {
    const none = physioInputs(undefined);
    assert.equal(none.level, null);
    const plain = loadPrompt('empathy', { MESSAGE: 'hi', ROLE: 'patient', CRITICALITY: 'NONE', ACTIONS_TAKEN: 'none', PHYSIO_CONTEXT: none.physioContext, STRESS_OVERRIDE: none.stressOverride, WITHHELD_NOTE: '' });
    assert.ok(!/\{\{\w+\}\}/.test(plain));
    assert.ok(!plain.includes('PHYSIOLOGICAL CONTEXT'));

    const physio = physioInputs(createPhysiologicalState({}));
    assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(physio.level));
    assert.match(physio.physioContext, /PHYSIOLOGICAL CONTEXT/);
});

test('a doctor suggestion without content is given the message; others are left as they are', () => {
    const members = [{ user_id: 'd1', username: 'Dr. Mehta', role: 'doctor' }, { user_id: 'g1', username: 'Gina', role: 'caregiver' }];
    const msg = 'Can you ask my doctor what I should do?';
    assert.equal(withDoctorContent({ target: 'Dr. Mehta', content_to_share: '' }, msg, members).content_to_share, msg);
    assert.equal(withDoctorContent({ target: 'doctor' }, msg, members).content_to_share, msg);
    assert.equal(withDoctorContent({ target: 'Gina', content_to_share: '' }, msg, members).content_to_share, '');
    assert.equal(withDoctorContent({ target: 'Dr. Mehta', content_to_share: 'vomiting' }, msg, members).content_to_share, 'vomiting');
    assert.equal(withDoctorContent(null, msg, members), null);
});
