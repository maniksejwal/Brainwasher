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
            return { reply: 'ok' };
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
    await db.run('DELETE FROM escalations');

    assert.equal(await handleDoctorRequest('p1', 'c1', { intent: 'ASKING_QUESTION' }), false);
    assert.equal(await handleDoctorRequest('p1', 'c1', { intent: 'REPORTING_FACT' }), false);

    assert.equal(await handleDoctorRequest('p1', 'c1', { intent: 'REPORTING_FACT| requesting_doctor' }), true);
    const rows = await db.all("SELECT type FROM escalations WHERE circle_id = 'c1'");
    assert.deepEqual(rows.map(r => r.type), ['DOCTOR_REQUEST']);
});

// --- #9a ---

test('#9a detectExecutedActions reports escalations and pending actions since turn start', async () => {
    const { detectExecutedActions } = await import('../training/simulation/ai_integration.js');
    await db.run('DELETE FROM escalations');
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
