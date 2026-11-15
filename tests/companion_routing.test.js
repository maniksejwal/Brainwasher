/**
 * @fileoverview tests/companion_routing.test.js
 * Which companion components run on a turn. No LLM calls.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRelevantHandlers } from '../companions/CompanionCoordinator.js';

test('the clinical agent runs on every patient and caregiver turn, keyword or not', () => {
    const msg = 'I threw up twice today and feel dizzy when I stand.';
    assert.ok(getRelevantHandlers('patient', msg, {}).includes('clinicalAgent'));
    assert.ok(getRelevantHandlers('caregiver', msg, {}).includes('clinicalAgent'));
});

test('other roles keep the keyword and medical-content check', () => {
    assert.ok(!getRelevantHandlers('doctor', 'thanks, noted', {}).includes('clinicalAgent'));
    assert.ok(getRelevantHandlers('doctor', 'any pain today?', {}).includes('clinicalAgent'));
});
