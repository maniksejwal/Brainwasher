/**
 * Regression tests for AGENT_BEHAVIOR_ISSUES_AND_FIX_PLAN.md fixes:
 *  #2  clinical assessment runs before (and feeds) dependent handlers
 *  #4  doctor requests route on combined (pipe-separated) intents
 *  #7  companions receive the most recent history, oldest-first
 *  #9a simulation reports actions actually executed
 *
 * Run with: node --test --experimental-test-module-mocks tests/agent_fixes.test.js
 * No LLM calls are made: handler modules and makeApiCall are mocked.
 */
import { test, mock, before } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const url = (p) => new URL(p, import.meta.url).href;

// --- Mocks (must be registered before the modules under test are imported) ---

const callOrder = [];
const seenContexts = {};
const prompts = [];
// Set to override the next makeApiCall result (e.g. an emergency confidence score)
let nextApiResult = null;

function stubHandler(name, result) {
    return async (userId, role, message, circleId, context) => {
        callOrder.push(`start:${name}`);
        seenContexts[name] = context;
        await new Promise(r => setTimeout(r, name === 'clinicalAgent' ? 30 : 1));
        callOrder.push(`end:${name}`);
        return result;
    };
}

const handlerModules = {
    '../companions/handlers/inputUnderstanding.js': ['processInputUnderstanding', 'inputUnderstanding', { intent: 'REPORTING_FACT' }],
    '../companions/handlers/historyAnalyzer.js': ['processHistoryAnalysis', 'historyAnalyzer', {}],
    '../companions/handlers/empathyHandler.js': ['processEmpathyDecision', 'empathyHandler', { level: 'MEDIUM' }],
    '../companions/handlers/privacyGuard.js': ['processPrivacyDecision', 'privacyGuard', { level: 'PRIVATE' }],
    '../companions/handlers/stateTracker.js': ['processStateTracking', 'stateTracker', {}],
    '../companions/agents/clinicalAgent.js': ['processClinicalAnalysis', 'clinicalAgent', { assessment: 'Possible cardiac event', criticality: 'HIGH' }],
    '../companions/agents/escalationManager.js': ['processEscalation', 'escalationManager', { required: true }],
};
for (const [path, [exportName, name, result]] of Object.entries(handlerModules)) {
    mock.module(url(path), { exports: { [exportName]: stubHandler(name, result) } });
}

// patientOptimizer is NOT mocked: its real prompt-building is under test for #7.
// doctorOptimizer is left real (unused for patients; other modules need its full exports).
mock.module(url('../agents/api_client.js'), {
    exports: {
        makeApiCall: async (prompt) => {
            prompts.push(prompt);
            const result = nextApiResult ?? { reply: 'ok' };
            nextApiResult = null;
            return result;
        }
    }
});

// --- Shared in-memory database ---

let db;
before(async () => {
    const { setGlobalDb } = await import('../db/index.js');
    const { initializeDatabase } = await import('../db/schema.js');
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    setGlobalDb(db);
    await initializeDatabase();

    const now = Date.now();
    await db.run('INSERT INTO users (user_id, username, created_at) VALUES (?, ?, ?)', ['p1', 'pat', now]);
    await db.run('INSERT INTO care_circles (circle_id, primary_patient_id, created_at) VALUES (?, ?, ?)', ['c1', 'p1', now]);
    await db.run('INSERT INTO care_circle_members (circle_id, user_id, role) VALUES (?, ?, ?)', ['c1', 'p1', 'patient']);
});

// Delivery rows reference escalations, so they are removed first
async function clearEscalations() {
    await db.run('DELETE FROM escalation_deliveries');
    await db.run('DELETE FROM escalations');
}

// --- #2 ---

test('#2 clinicalAgent completes before dependents, which receive its assessment', async () => {
    const { processCompanionHandlers } = await import('../companions/handlers/index.js');
    callOrder.length = 0;

    const results = await processCompanionHandlers('p1', 'patient', 'I have chest pain, this is urgent', 'c1', { history: [] });

    const clinicalEnd = callOrder.indexOf('end:clinicalAgent');
    assert.ok(clinicalEnd >= 0, 'clinicalAgent should run');
    assert.ok(callOrder.indexOf('start:escalationManager') > clinicalEnd, 'escalation must start after clinical ends');

    assert.equal(seenContexts.escalationManager.clinicalAssessment?.criticality, 'HIGH');
    assert.equal(results.clinicalAgent.result.criticality, 'HIGH');

    // patientOptimizer is real: its prompt must carry the clinical result, not the defaults
    const optimizerPrompt = prompts.at(-1);
    assert.match(optimizerPrompt, /HIGH/);
    assert.match(optimizerPrompt, /Possible cardiac event/);
});

// --- #7 ---

test('#7 patient optimizer sees the newest five messages in chronological order', async () => {
    const { getRecentMessages } = await import('../db/index.js');
    const { processPatientOptimization } = await import('../companions/agents/patientOptimizer.js');

    const base = Date.now() - 100000;
    for (let i = 1; i <= 25; i++) {
        await db.run(
            'INSERT INTO messages (circle_id, user_id, role, message, privacy_level, criticality_level, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ['c1', 'p1', 'patient', `msg-${String(i).padStart(2, '0')}`, 'PRIVATE', 'NONE', base + i]
        );
    }

    // Mirrors aiAnalysisHandler: DB returns newest-first, reversed to chronological
    const history = (await getRecentMessages('c1', 20)).reverse();
    prompts.length = 0;
    await processPatientOptimization('p1', 'patient', 'hello', 'c1', { history });

    const prompt = prompts.at(-1);
    for (let i = 21; i <= 25; i++) assert.ok(prompt.includes(`msg-${i}`), `missing msg-${i}`);
    assert.ok(!prompt.includes('msg-06'), 'should not include old messages');
    assert.ok(prompt.indexOf('msg-21') < prompt.indexOf('msg-25'), 'history should be oldest-first');
});

// --- #4 ---

test('#4 doctor request routes on pipe-separated intents and ignores others', async () => {
    const { handleDoctorRequest } = await import('../handlers/message_logic/sharing/doctorRequests.js');
    await clearEscalations();

    assert.equal(await handleDoctorRequest('p1', 'c1', { intent: 'ASKING_QUESTION' }), false);
    assert.equal(await handleDoctorRequest('p1', 'c1', { intent: 'REPORTING_FACT' }), false);

    const result = await handleDoctorRequest('p1', 'c1', { intent: 'REPORTING_FACT| requesting_doctor' });
    assert.equal(result.action, 'ESCALATE');
    // c1 has no doctor: the request is recorded, and the result says so
    assert.equal(result.actions.noDoctorConnected, true);
    const rows = await db.all("SELECT type FROM escalations WHERE circle_id = 'c1'");
    assert.deepEqual(rows.map(r => r.type), ['DOCTOR_REQUEST']);
});

// --- #9a ---

test('#9a detectExecutedActions reports escalations and pending actions since turn start', async () => {
    const { detectExecutedActions } = await import('../training/simulation/ai_integration.js');
    await clearEscalations();
    await db.run('DELETE FROM pending_actions');

    const since = Date.now();
    assert.equal((await detectExecutedActions('c1', since)).type, 'NONE');

    await db.run('INSERT INTO pending_actions (action_id, circle_id, user_id, action_type, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['a1', 'c1', 'p1', 'escalation_permission', '{}', since + 1]);
    assert.equal((await detectExecutedActions('c1', since)).type, 'REQUEST_CONSENT');

    await db.run('INSERT INTO escalations (circle_id, type, details, timestamp) VALUES (?, ?, ?, ?)',
        ['c1', 'DOCTOR_REQUEST', 'x', since + 2]);
    const action = await detectExecutedActions('c1', since);
    assert.equal(action.type, 'ESCALATE');
    assert.deepEqual(action.escalations, ['DOCTOR_REQUEST']);

    // Older rows are ignored
    assert.equal((await detectExecutedActions('c1', since + 10)).type, 'NONE');
});

// --- Criticality scale (steps 1 + 3) ---

test('normalizeCriticality maps model output onto NONE/LOW/MEDIUM/HIGH', async () => {
    const { normalizeCriticality } = await import('../utils/criticality.js');

    assert.equal(normalizeCriticality('URGENT_INTERVENTION'), 'HIGH');
    assert.equal(normalizeCriticality('CRITICAL'), 'HIGH');
    assert.equal(normalizeCriticality('urgent intervention'), 'HIGH');
    assert.equal(normalizeCriticality(' medium '), 'MEDIUM');
    assert.equal(normalizeCriticality('moderate'), 'MEDIUM');
    assert.equal(normalizeCriticality('LOW'), 'LOW');
    assert.equal(normalizeCriticality('NONE'), 'NONE');

    // Template echoed back: take the most severe
    assert.equal(normalizeCriticality('NONE|LOW|HIGH'), 'HIGH');

    // Missing or unknown: fall back (default NONE), never pass the raw value through
    assert.equal(normalizeCriticality(undefined), 'NONE');
    assert.equal(normalizeCriticality('banana'), 'NONE');
    assert.equal(normalizeCriticality('banana', 'MEDIUM'), 'MEDIUM');
    assert.equal(normalizeCriticality(null, 'CRITICAL'), 'HIGH');
});

// --- False action claims: sharing handlers return what they did and do not message the user ---

async function collectBroadcasts(fn) {
    const { events } = await import('../orchestrator.js');
    const sent = [];
    const listener = (payload) => sent.push(payload);
    events.on('broadcast', listener);
    try {
        return { result: await fn(), sent };
    } finally {
        events.off('broadcast', listener);
    }
}

test('critical event at high confidence escalates and reports caregivers without messaging the patient', async () => {
    const { handleCriticalEvent } = await import('../handlers/message_logic/sharing/criticalEvents.js');
    const now = Date.now();
    await db.run('INSERT OR IGNORE INTO users (user_id, username, created_at) VALUES (?, ?, ?)', ['g1', 'gina', now]);
    await db.run('INSERT OR IGNORE INTO care_circle_members (circle_id, user_id, role) VALUES (?, ?, ?)', ['c1', 'g1', 'caregiver']);
    await clearEscalations();

    nextApiResult = { confidence: 0.95 };
    const { result, sent } = await collectBroadcasts(() =>
        handleCriticalEvent('p1', 'patient', 'crushing chest pain', 'c1', { criticality: 'HIGH' }));

    assert.equal(result.escalated, true);
    assert.deepEqual(result.actions.caregiversAlerted, ['gina']);
    assert.equal(result.actions.noDoctorConnected, true);
    assert.ok(sent.every(b => !b.targetUsers.includes('p1')), 'patient must not get a separate message');
    assert.ok(sent.some(b => b.targetUsers.includes('g1')), 'caregiver alert is kept');
    const rows = await db.all("SELECT type FROM escalations WHERE circle_id = 'c1'");
    assert.deepEqual(rows.map(r => r.type), ['CRITICAL']);

    await db.run("DELETE FROM care_circle_members WHERE user_id = 'g1'");
});

test('critical event below the threshold does not escalate or message the patient', async () => {
    const { handleCriticalEvent } = await import('../handlers/message_logic/sharing/criticalEvents.js');
    await clearEscalations();

    nextApiResult = { confidence: 0.5 };
    const { result, sent } = await collectBroadcasts(() =>
        handleCriticalEvent('p1', 'patient', 'my chest feels a bit tight', 'c1', { criticality: 'HIGH', reply: 'model reply' }));

    assert.equal(result.action, 'FOLLOW_UP');
    assert.equal(result.escalated, false);
    assert.deepEqual(result.actions, {});
    assert.equal(sent.length, 0);
    assert.equal((await db.all('SELECT * FROM escalations')).length, 0);
});

test('a HIGH turn sends the patient exactly one message, opening with the emergency sentence', async () => {
    const { handleMessage } = await import('../handlers/messageHandler.js');
    const { getEmergencySentence } = await import('../config/emergencyGuidance.js');
    await clearEscalations();
    // Isolate from follow-ups scheduled by earlier tests
    await db.run('DELETE FROM scheduled_messages');

    // The mocked clinical agent returns HIGH with no category; every LLM call returns "ok"
    const { result, sent } = await collectBroadcasts(() => handleMessage('p1', 'c1', 'I have crushing chest pain'));
    const toPatient = sent.filter(b => b.targetUsers.includes('p1'));

    assert.equal(result.criticality, 'HIGH');
    assert.equal(toPatient.length, 1, `expected one message, got: ${JSON.stringify(toPatient.map(b => b.reply || b.message))}`);
    assert.ok(toPatient[0].reply.startsWith(getEmergencySentence(null)), toPatient[0].reply);
    assert.equal(toPatient[0].reply, result.reply);

    // The patient's message is saved once, with the final criticality, and its ID is on the analysis
    const saved = await db.all("SELECT message_id, criticality_level FROM messages WHERE message = 'I have crushing chest pain'");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].criticality_level, 'HIGH');
    assert.equal(result.message_id, saved[0].message_id);
});

test('escalation tiers return what was done and do not message the patient', async () => {
    const { handleTier1Permission, handleTier3Anonymous, handleTier4Consultation } = await import('../handlers/message_logic/sharing/escalationTiers.js');
    const { buildActionStatus } = await import('../utils/actionClaimGuard.js');
    const analysis = { criticality: 'MEDIUM', sharingSuggestion: { content_to_share: 'dizzy spells' } };
    await clearEscalations();

    const tier3 = await collectBroadcasts(() => handleTier3Anonymous('p1', 'c1', analysis));
    assert.equal(tier3.result.actions.anonymousConsultation, true);
    assert.match(buildActionStatus(tier3.result.actions), /logged a request/);
    assert.ok(tier3.sent.every(b => !b.targetUsers.includes('p1')));

    // c1 has no doctor
    const tier4 = await collectBroadcasts(() => handleTier4Consultation('p1', 'c1', { ...analysis, message_id: 9001 }));
    assert.equal(tier4.result.actions.noDoctorConnected, true);
    assert.match(buildActionStatus(tier4.result.actions), /No doctor is connected/);
    assert.ok(tier4.sent.every(b => !b.targetUsers.includes('p1')));

    // Tier 1 asks the question through the reply and records the pending permission
    const tier1 = await collectBroadcasts(() => handleTier1Permission('p1', 'c1', analysis));
    assert.match(tier1.result.question, /Would you like me to consult with a doctor/);
    assert.equal(tier1.result.escalated, false);
    assert.equal(tier1.sent.length, 0);
    await db.run('DELETE FROM pending_actions');
});

test('a permission answer is matched on whole words, escalates once and clears the question', async () => {
    const { handleTier1Permission } = await import('../handlers/message_logic/sharing/escalationTiers.js');
    const { handlePendingActionResponse } = await import('../handlers/message_logic/actionResponseHandler.js');
    await clearEscalations();
    await db.run('DELETE FROM pending_actions');
    await handleTier1Permission('p1', 'c1', { criticality: 'MEDIUM', sharingSuggestion: { content_to_share: 'dizzy spells' } });

    // "took" contains "ok" but is not an answer
    assert.equal(await handlePendingActionResponse('p1', 'c1', 'I took my pills this morning'), null);

    const { result, sent } = await collectBroadcasts(() => handlePendingActionResponse('p1', 'c1', 'yes please'));
    // c1 has no caregiver, so tier 2 moves to tier 3
    assert.match(result.reply, /anonymous consultation/);
    assert.deepEqual(sent.filter(b => b.targetUsers.includes('p1')).map(b => b.reply), [result.reply]);
    assert.deepEqual((await db.all('SELECT type FROM escalations')).map(r => r.type), ['ANONYMOUS_CONSULTATION']);
    assert.equal((await db.all('SELECT * FROM pending_actions')).length, 0, 'answered question is removed');
});

test('a fact report escalated to the doctor returns its result instead of messaging the reporter', async () => {
    const { handleFactReporting } = await import('../handlers/message_logic/sharing/factReporting.js');
    const now = Date.now();
    await db.run('INSERT OR IGNORE INTO users (user_id, username, created_at) VALUES (?, ?, ?)', ['g3', 'gail', now]);
    await db.run('INSERT OR IGNORE INTO care_circle_members (circle_id, user_id, role) VALUES (?, ?, ?)', ['c1', 'g3', 'caregiver']);
    await clearEscalations();

    const analysis = {
        intent: 'REPORTING_FACT',
        criticality: 'MEDIUM',
        reply: 'Thanks for letting me know.',
        // A null fact used to crash the handler
        facts: { empty: null, fainted: { subject: 'pat', value: 'fainted twice today' } }
    };
    const { result, sent } = await collectBroadcasts(() => handleFactReporting('g3', 'c1', analysis));

    assert.equal(result.action, 'FACT_REPORT');
    assert.equal(result.actions.escalationCreated, true);
    assert.equal(result.actions.noDoctorConnected, true);
    assert.ok(sent.every(b => !b.targetUsers.includes('g3')), 'reporter gets no separate message');
    assert.deepEqual((await db.all('SELECT type FROM escalations')).map(r => r.type), ['FACT_REPORT']);
    await db.run("DELETE FROM care_circle_members WHERE user_id = 'g3'");
});

test('mediation returns the member messaged and skips the speaker as target', async () => {
    const { handleMediationRequest } = await import('../handlers/message_logic/sharing/mediation.js');
    const now = Date.now();
    await db.run('INSERT OR IGNORE INTO users (user_id, username, created_at) VALUES (?, ?, ?)', ['g2', 'gus', now]);
    await db.run('INSERT OR IGNORE INTO care_circle_members (circle_id, user_id, role) VALUES (?, ?, ?)', ['c1', 'g2', 'caregiver']);
    const analysis = (target) => ({ intent: 'REQUESTING_MEDIATION', sharingSuggestion: { target, content_to_share: 'please call me' } });

    const { result, sent } = await collectBroadcasts(() => handleMediationRequest('p1', 'c1', analysis('gus')));
    assert.deepEqual(result.actions.membersMessaged, ['gus']);
    assert.ok(sent.some(b => b.targetUsers.includes('g2')), 'target gets the mediated message');
    assert.ok(sent.every(b => !b.targetUsers.includes('p1')), 'speaker gets no separate confirmation');

    assert.equal(await handleMediationRequest('p1', 'c1', analysis('pat')), false);
    await db.run("DELETE FROM care_circle_members WHERE user_id = 'g2'");
});
