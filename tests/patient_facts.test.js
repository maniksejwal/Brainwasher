/**
 * @fileoverview tests/patient_facts.test.js
 * The reply prompt gets what is already known about the patient, with nothing invented.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPatientFacts, buildKnownSection } from '../companions/patientFacts.js';
import { sessionFromTimestamps, SESSION_GAP_MS } from '../handlers/message_logic/knownContext.js';
import { loadPrompt } from '../companions/utils/promptLoader.js';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

test('with nothing known, there are no lines and no section', () => {
    assert.equal(buildPatientFacts({}), '');
    assert.equal(buildKnownSection({}), '');
    assert.equal(buildKnownSection({ knownContextBlock: '  ', longitudinalHint: '' }), '');
});

test('session number and days since the last one are stated, never guessed', () => {
    assert.equal(
        buildPatientFacts({ patientSession: { number: 3, previousEndMs: NOW - 4 * DAY } }, NOW),
        '- Conversation 3 with this patient; the last one was 4 days ago.'
    );
    assert.equal(buildPatientFacts({ patientSession: { number: 1, previousEndMs: null } }, NOW), '- First conversation with this patient.');
    assert.equal(buildPatientFacts({ patientSession: null }, NOW), '');
});

test('only alert types are shown, not their details', () => {
    const text = buildPatientFacts({
        recentEscalations: [
            { type: 'EMERGENCY', details: 'caregiver said something private' },
            { type: 'EMERGENCY', details: 'again' },
            { type: 'CONFLICT', details: 'x' }
        ]
    });
    assert.equal(text, '- Topics flagged earlier in the care circle: EMERGENCY, CONFLICT.');
});

test('the section holds facts, known context and hint, marked as background', () => {
    const section = buildKnownSection({
        patientSession: { number: 1 },
        knownContextBlock: 'KNOWN CONTEXT:\n- living arrangement: alone [2026-11-01]',
        longitudinalHint: 'three earlier sessions'
    });
    assert.ok(section.startsWith('**What we already know (do not ask again):**'));
    assert.ok(section.includes('does not mean any action was taken'));
    assert.ok(section.includes('living arrangement: alone'));
    assert.ok(section.includes('three earlier sessions'));
});

test('a gap over the limit starts a new session', () => {
    const t0 = NOW - 3 * DAY;
    assert.deepEqual(sessionFromTimestamps([], NOW), { number: 1, startMs: NOW, previousEndMs: null });
    assert.deepEqual(sessionFromTimestamps([NOW - 60_000, NOW - 120_000], NOW), { number: 1, startMs: NOW - 120_000, previousEndMs: null });
    assert.deepEqual(
        sessionFromTimestamps([t0, t0 + 60_000, NOW - 2 * DAY, NOW - 60_000], NOW),
        { number: 3, startMs: NOW - 60_000, previousEndMs: NOW - 2 * DAY }
    );
    assert.equal(sessionFromTimestamps([NOW - SESSION_GAP_MS], NOW).number, 1);
});

test('in the reply prompt the facts come before the action contract', () => {
    const prompt = loadPrompt('patient_optimizer', { KNOWN_SECTION: '**What we already know (do not ask again):**\n- x' });
    const facts = prompt.indexOf('What we already know');
    assert.ok(facts > 0);
    assert.ok(prompt.indexOf('**CAPABILITIES') > facts);
    assert.ok(!loadPrompt('patient_optimizer', { KNOWN_SECTION: '' }).includes('{{KNOWN_SECTION}}'));
});
