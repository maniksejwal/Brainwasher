/**
 * @fileoverview tests/action_claims.test.js
 * Tests for the action claim guard and the final reply composition.
 *
 * Run with: node --test tests/action_claims.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFalseClaims, buildActionStatus, composeFinalReply, FALLBACK_TEXT } from '../utils/actionClaimGuard.js';
import { getEmergencySentence, normalizeHighCategory } from '../config/emergencyGuidance.js';
import { loadPrompt } from '../companions/utils/promptLoader.js';
import { NO_ACTIONS_TAKEN } from '../prompts/action_contract.js';

const NO_ACTIONS = {};
const DOCTOR_FLAGGED = { escalationCreated: true, doctors: ['dr_evans'] };

const claimTypes = (text, actions) => findFalseClaims(text, actions).map(f => f.type);

test('dispatch claims always fail, even when an escalation exists', () => {
    for (const text of [
        'Help is on the way.',
        "I've already sent for medical help and they're on their way to 123 Main Street.",
        'An ambulance is on the way.',
        "I'll call an ambulance for you."
    ]) {
        assert.deepEqual(claimTypes(text, DOCTOR_FLAGGED), ['EMERGENCY_DISPATCH'], text);
    }
});

test('doctor claims need an escalation that a doctor can see', () => {
    const text = "I'm escalating this to the doctor immediately.";
    assert.deepEqual(claimTypes(text, NO_ACTIONS), ['DOCTOR_NOTIFIED']);
    assert.deepEqual(claimTypes('Your doctor has been notified.', NO_ACTIONS), ['DOCTOR_NOTIFIED']);
    assert.deepEqual(claimTypes(text, DOCTOR_FLAGGED), []);
    // Escalation written, but no doctor in the circle
    assert.deepEqual(claimTypes(text, { escalationCreated: true, doctors: [], noDoctorConnected: true }), ['DOCTOR_NOTIFIED']);
});

test('family claims need a caregiver alert', () => {
    assert.deepEqual(claimTypes("I've notified your family.", NO_ACTIONS), ['FAMILY_NOTIFIED']);
    assert.deepEqual(claimTypes("I've notified your family.", { caregiversAlerted: ['bob'] }), []);
});

test('instructions, offers and questions are not claims', () => {
    for (const text of [
        'You should call 112 right away.',
        'Would you like me to let your doctor know?',
        'I can help arrange a consultation with your doctor.',
        'I understand this is scary. How long has the pain lasted?',
        getEmergencySentence('SELF_HARM_RISK')
    ]) {
        assert.deepEqual(claimTypes(text, NO_ACTIONS), [], text);
    }
});

test('action status describes only what was done', () => {
    assert.equal(buildActionStatus(NO_ACTIONS), '');
    assert.match(buildActionStatus(DOCTOR_FLAGGED), /flagged this for dr_evans/);
    assert.match(buildActionStatus({ escalationCreated: true, noDoctorConnected: true }), /No doctor is connected/);
    assert.match(buildActionStatus({ caregiversAlerted: ['bob', 'carol'] }), /alert to bob and carol/);
});

test('HIGH replies open with the approved sentence for the category', () => {
    const { message } = composeFinalReply({
        modelText: 'That sounds frightening. Are you somewhere safe right now?',
        criticality: 'HIGH',
        highCategory: 'IMMEDIATE_DANGER'
    });
    assert.ok(message.startsWith(getEmergencySentence('IMMEDIATE_DANGER')));
    assert.ok(message.includes('Are you somewhere safe right now?'));
});

test('unknown or missing HIGH category uses the general sentence', () => {
    assert.equal(normalizeHighCategory('heart_attack'), null);
    assert.equal(getEmergencySentence(null), getEmergencySentence('unknown'));
    const { message } = composeFinalReply({ modelText: 'I hear you.', criticality: 'HIGH' });
    assert.ok(message.startsWith(getEmergencySentence(null)));
});

test('non-HIGH replies get no emergency sentence', () => {
    const { message } = composeFinalReply({ modelText: 'How did you sleep?', criticality: 'MEDIUM' });
    assert.equal(message, 'How did you sleep?');
});

test('a false claim is replaced by the fallback and reported', () => {
    const { message, violations } = composeFinalReply({
        modelText: "Help is on the way. I've notified the doctor.",
        criticality: 'HIGH',
        highCategory: 'MEDICAL_EMERGENCY',
        actions: { escalationCreated: true, doctors: [], noDoctorConnected: true }
    });
    assert.deepEqual(violations.map(v => v.type), ['EMERGENCY_DISPATCH', 'DOCTOR_NOTIFIED']);
    assert.equal(message, [
        getEmergencySentence('MEDICAL_EMERGENCY'),
        FALLBACK_TEXT,
        "No doctor is connected to your care circle yet, so I couldn't send this to a doctor."
    ].join(' '));
});

test('companion reply prompts carry the action contract with ACTIONS_TAKEN filled', () => {
    for (const name of ['patient_optimizer', 'empathy']) {
        const prompt = loadPrompt(name, { ACTIONS_TAKEN: NO_ACTIONS_TAKEN });
        assert.match(prompt, /CAPABILITIES/, name);
        assert.match(prompt, /ACTIONS_TAKEN this turn:\*\*\s*none/, name);
        assert.ok(!prompt.includes('{{ACTIONS_TAKEN}}'), `${name} left the placeholder unfilled`);
    }
});

test('unified prompt no longer scripts an escalation claim', async () => {
    const { PROMPT_UNIFIED_AGENT_WITH_STATE } = await import('../prompts/unified_prompt.js');
    assert.ok(!/escalating this to the doctor/i.test(PROMPT_UNIFIED_AGENT_WITH_STATE));
    assert.ok(!/contacting the doctor immediately/i.test(PROMPT_UNIFIED_AGENT_WITH_STATE));
    assert.match(PROMPT_UNIFIED_AGENT_WITH_STATE, /CAPABILITIES/);
    assert.match(PROMPT_UNIFIED_AGENT_WITH_STATE, /\{\{ACTIONS_TAKEN\}\}/);
});

test('phrasings missed in the first simulation are caught', () => {
    const cases = [
        // Statement before a trailing question is still checked
        ['Please stay as calm as possible while I flag this for your doctor, can you tell me more about when these symptoms started?', 'DOCTOR_NOTIFIED'],
        ["I'll make sure to flag this for your doctor as soon as possible.", 'DOCTOR_NOTIFIED'],
        ["I'm here with you, and I'll stay on the line until you get to the hospital.", 'EMERGENCY_DISPATCH'],
        ["I'm going to send help your way right away - please stay calm and try to stay safe until assistance arrives.", 'EMERGENCY_DISPATCH'],
        ['Please stay safe until help arrives.', 'EMERGENCY_DISPATCH'],
        ['I understand your distress; the medical team is aware of your situation and is working to address your concerns.', 'DOCTOR_NOTIFIED'],
        ['Let me flag this for your doctor now.', 'DOCTOR_NOTIFIED']
    ];
    for (const [text, type] of cases) {
        assert.deepEqual(claimTypes(text, NO_ACTIONS), [type], text);
    }
});

test('offers and questions about actions are still allowed', () => {
    for (const text of [
        'Can I flag this for your doctor?',
        'Would you like me to flag this for your doctor so they can call you back?',
        'If you want, shall I let your caregiver know, or would you rather tell them yourself?',
        'I can offer to flag your concerns about falling for your doctor.',
        "I didn't directly notify your caregiver, but I can help you flag a message for them.",
        'Can you tell me where you are and if someone can call for emergency services?'
    ]) {
        assert.deepEqual(claimTypes(text, NO_ACTIONS), [], text);
    }
});

test('a true claim next to an offer in the same question is not flagged', () => {
    const text = "I'm here to support you, and I've already sent an alert to your caregiver in the app; would you like me to flag this for your doctor as well, when you're able to?";
    assert.deepEqual(claimTypes(text, { caregiversAlerted: ['gina'] }), []);
    assert.deepEqual(claimTypes(text, NO_ACTIONS), ['FAMILY_NOTIFIED']);
});

test('a mediated message is stated as passed on, without promising a response', () => {
    const status = buildActionStatus({ membersMessaged: ['bob'] });
    assert.equal(status, "I've passed your message on to bob in the app.");
    assert.doesNotMatch(status, /respond soon/);
    assert.deepEqual(claimTypes("I've let your caregiver know.", { membersMessaged: ['bob'] }), []);
});

test('a question from a sharing handler goes at the end, and is dropped if it claims an action', () => {
    const asked = composeFinalReply({ modelText: 'That sounds worrying.', criticality: 'MEDIUM', actions: {}, question: 'Would you like me to share this with gina?' });
    assert.equal(asked.message, 'That sounds worrying. Would you like me to share this with gina?');
    assert.deepEqual(asked.violations, []);

    const claimed = composeFinalReply({ modelText: 'That sounds worrying.', criticality: 'MEDIUM', actions: {}, question: "I've already told your doctor. Anything else?" });
    assert.equal(claimed.message, 'That sounds worrying.');
    assert.deepEqual(claimed.violations.map(v => v.type), ['DOCTOR_NOTIFIED']);
});
