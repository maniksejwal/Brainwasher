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
// Set to answer each makeApiCall by prompt; return undefined to fall through to the default
let apiResponder = null;
// What the mocked clinical agent returns; it now runs on every patient turn
const HIGH_CLINICAL = { assessment: 'Possible cardiac event', criticality: 'HIGH' };
let clinicalResult = HIGH_CLINICAL;

function stubHandler(name, result) {
    return async (userId, role, message, circleId, context) => {
        callOrder.push(`start:${name}`);
        seenContexts[name] = context;
        await new Promise(r => setTimeout(r, name === 'clinicalAgent' ? 30 : 1));
        callOrder.push(`end:${name}`);
        return typeof result === 'function' ? result() : result;
    };
}

const handlerModules = {
    '../companions/handlers/inputUnderstanding.js': ['processInputUnderstanding', 'inputUnderstanding', { intent: 'REPORTING_FACT' }],
    '../companions/handlers/historyAnalyzer.js': ['processHistoryAnalysis', 'historyAnalyzer', {}],
    '../companions/handlers/empathyHandler.js': ['processEmpathyDecision', 'empathyHandler', { level: 'MEDIUM' }],
    '../companions/handlers/privacyGuard.js': ['processPrivacyDecision', 'privacyGuard', { level: 'PRIVATE' }],
    '../companions/handlers/stateTracker.js': ['processStateTracking', 'stateTracker', {}],
    '../companions/agents/clinicalAgent.js': ['processClinicalAnalysis', 'clinicalAgent', () => clinicalResult],
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
            const answered = apiResponder?.(prompt);
            if (answered !== undefined) return answered;
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

test('critical event at high confidence proposes the alert and sends nothing until the user accepts', async () => {
    const { handleCriticalEvent } = await import('../handlers/message_logic/sharing/criticalEvents.js');
    const { handlePendingActionResponse } = await import('../handlers/message_logic/actionResponseHandler.js');
    const now = Date.now();
    await db.run('INSERT OR IGNORE INTO users (user_id, username, created_at) VALUES (?, ?, ?)', ['g1', 'gina', now]);
    await db.run('INSERT OR IGNORE INTO care_circle_members (circle_id, user_id, role) VALUES (?, ?, ?)', ['c1', 'g1', 'caregiver']);
    await clearEscalations();
    await db.run('DELETE FROM pending_actions');
    try {
        nextApiResult = { confidence: 0.95 };
        const { result, sent } = await collectBroadcasts(() =>
            handleCriticalEvent('p1', 'patient', 'crushing chest pain', 'c1', { criticality: 'HIGH' }));

        assert.equal(result.action, 'PROPOSE_ESCALATION');
        assert.equal(result.escalated, false);
        assert.equal(result.question, 'Do you want me to alert gina now? Just reply yes.');
        assert.deepEqual(result.proposal.recipients.map(r => r.username), ['gina']);
        assert.equal(result.actions.noDoctorConnected, true);
        assert.equal(sent.length, 0, 'nothing is sent before the user accepts');
        assert.equal((await db.all('SELECT * FROM escalations')).length, 0);

        // "yes" sends it once, to the recipients that were shown
        const accepted = await collectBroadcasts(() => handlePendingActionResponse('p1', 'c1', 'yes please'));
        assert.equal(accepted.result.reply, "No doctor is connected to your care circle yet, so I couldn't send this to a doctor. I've sent an alert to gina in the app.");
        assert.ok(accepted.sent.some(b => b.targetUsers.includes('g1')), 'caregiver alert');
        assert.deepEqual((await db.all('SELECT type FROM escalations')).map(r => r.type), ['CRITICAL']);
        assert.equal((await db.all('SELECT * FROM pending_actions')).length, 0);
        assert.equal(await handlePendingActionResponse('p1', 'c1', 'yes'), null, 'a second yes sends nothing');
    } finally {
        await db.run("DELETE FROM care_circle_members WHERE user_id = 'g1'");
        await db.run('DELETE FROM pending_actions');
    }
});

test('a declined or expired alert proposal sends nothing', async () => {
    const { proposeEscalation, decideEscalationProposal } = await import('../services/escalationService.js');
    const { handlePendingActionResponse } = await import('../handlers/message_logic/actionResponseHandler.js');
    await db.run('INSERT OR IGNORE INTO users (user_id, username, created_at) VALUES (?, ?, ?)', ['g1', 'gina', Date.now()]);
    await db.run('INSERT OR IGNORE INTO care_circle_members (circle_id, user_id, role) VALUES (?, ?, ?)', ['c1', 'g1', 'caregiver']);
    await clearEscalations();
    await db.run('DELETE FROM pending_actions');
    const propose = (overrides = {}) => proposeEscalation({ circleId: 'c1', userId: 'p1', type: 'CRITICAL', details: 'chest pain', notifyCaregivers: true, caregiverMessage: 'Please check on pat.', ...overrides });
    try {
        await propose();
        const declined = await collectBroadcasts(() => handlePendingActionResponse('p1', 'c1', 'no, not now'));
        assert.match(declined.result.reply, /haven't sent it/);
        assert.ok(declined.sent.every(b => !b.targetUsers.includes('g1')));

        const { proposal } = await propose({ ttlMs: -1 });
        assert.equal((await decideEscalationProposal(proposal.actionId, 'p1', true)).status, 'expired');

        const { proposal: forPat } = await propose();
        assert.equal((await decideEscalationProposal(forPat.actionId, 'g1', true)).status, 'not_found', 'only the user it was proposed to can decide');
        // A newer proposal replaces the open one, so one "yes" cannot send two
        const { proposal: newer } = await propose();
        assert.equal((await decideEscalationProposal(forPat.actionId, 'p1', true)).status, 'not_found');
        assert.equal((await db.all('SELECT * FROM pending_actions')).length, 1);
        assert.equal((await decideEscalationProposal(newer.actionId, 'p1', false)).status, 'rejected');
        assert.equal((await db.all('SELECT * FROM escalations')).length, 0);
    } finally {
        await db.run("DELETE FROM care_circle_members WHERE user_id = 'g1'");
        await db.run('DELETE FROM pending_actions');
    }
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

// --- Phase 2: the reply is written after the actions run ---

const isReplyPrompt = (prompt) => prompt.includes('ACTIONS_TAKEN this turn');

test('a HIGH turn rewrites the reply with the real actions and sends one message', async () => {
    const { handleMessage } = await import('../handlers/messageHandler.js');
    const { getEmergencySentence } = await import('../config/emergencyGuidance.js');
    await clearEscalations();
    await db.run('DELETE FROM scheduled_messages');

    apiResponder = (prompt) => {
        if (prompt.includes('assessing the confidence level')) return { confidence: 0.95 };
        if (isReplyPrompt(prompt)) {
            // The draft (no actions yet) claims a doctor was told; the rewrite knows there is none
            return prompt.includes('NOT sent to any doctor')
                ? { reply: 'I am here with you while you wait.' }
                : { reply: "I've notified your doctor about this." };
        }
        return undefined;
    };
    try {
        const { result, sent } = await collectBroadcasts(() => handleMessage('p1', 'c1', 'crushing chest pain and my left arm is numb'));
        const toPatient = sent.filter(b => b.targetUsers.includes('p1'));

        assert.equal(toPatient.length, 1, JSON.stringify(toPatient.map(b => b.reply || b.message)));
        const reply = toPatient[0].reply;
        assert.ok(reply.startsWith(getEmergencySentence(null)), reply);
        assert.match(reply, /I am here with you while you wait\./);
        assert.match(reply, /No doctor is connected/);
        assert.doesNotMatch(reply, /notified your doctor/);
        assert.equal(reply, result.reply);

        // c1 has nobody to alert, so nothing is proposed or recorded
        assert.equal(result.proposal, null);
        assert.equal((await db.all('SELECT * FROM escalations')).length, 0);
    } finally {
        apiResponder = null;
    }
});

test('a reply that claims an action that did not happen is regenerated once', async () => {
    // Earlier tests leave HIGH messages, which would count as an active emergency
    await db.run('DELETE FROM messages');
    const { handleMessage } = await import('../handlers/messageHandler.js');
    await clearEscalations();
    await db.run('DELETE FROM scheduled_messages');

    apiResponder = (prompt) => {
        if (!isReplyPrompt(prompt)) return undefined;
        return prompt.includes('Your previous draft said')
            ? { reply: 'Tell me more about your day.' }
            : { reply: "I've let your doctor know." };
    };
    clinicalResult = { assessment: 'Small talk', criticality: 'NONE' };
    try {
        // A NONE turn: nothing is escalated
        const { result, sent } = await collectBroadcasts(() => handleMessage('p1', 'c1', 'hello there'));
        assert.equal(result.reply, 'Tell me more about your day.');
        assert.deepEqual(sent.filter(b => b.targetUsers.includes('p1')).map(b => b.reply), [result.reply]);
        assert.equal((await db.all('SELECT * FROM escalations')).length, 0);
    } finally {
        apiResponder = null;
        clinicalResult = HIGH_CLINICAL;
    }
});

test('a scheduled message due this turn is added to the one reply', async () => {
    // Earlier tests leave HIGH messages, which would count as an active emergency
    await db.run('DELETE FROM messages');
    const { handleMessage } = await import('../handlers/messageHandler.js');
    const { createScheduledMessage } = await import('../db/queries_future_plans.js');
    await clearEscalations();
    await db.run('DELETE FROM scheduled_messages');
    await createScheduledMessage('c1', 'p1', 'Is the tightness any better than earlier?', 1, 'p1', 'turn', null, {}, null);

    apiResponder = (prompt) => {
        if (!isReplyPrompt(prompt)) return undefined;
        return prompt.includes('The system ends your reply with this question')
            ? { reply: 'Good to hear from you again.' }
            : { reply: 'How are you doing today?' };
    };
    clinicalResult = { assessment: 'Greeting', criticality: 'NONE' };
    try {
        const { result, sent } = await collectBroadcasts(() => handleMessage('p1', 'c1', 'hi again'));
        const toPatient = sent.filter(b => b.targetUsers.includes('p1'));

        assert.equal(toPatient.length, 1, JSON.stringify(toPatient.map(b => b.reply || b.message)));
        assert.equal(result.reply, 'Good to hear from you again. Is the tightness any better than earlier?');
        const pending = await db.all("SELECT * FROM scheduled_messages WHERE status = 'pending'");
        assert.equal(pending.length, 0);
    } finally {
        apiResponder = null;
        clinicalResult = HIGH_CLINICAL;
    }
});

test('an answer to a delegated question is forwarded and still analyzed, checked and the alert proposed', async () => {
    const { handleMessage } = await import('../handlers/messageHandler.js');
    const now = Date.now();
    await db.run('INSERT OR IGNORE INTO users (user_id, username, created_at) VALUES (?, ?, ?)', ['g5', 'gwen', now]);
    await db.run('INSERT OR IGNORE INTO care_circle_members (circle_id, user_id, role) VALUES (?, ?, ?)', ['c1', 'g5', 'caregiver']);
    await clearEscalations();
    await db.run('DELETE FROM scheduled_messages');
    await db.run('DELETE FROM pending_actions');
    // gwen asked pat a question earlier; any reply from pat is taken as the answer
    await db.run('INSERT INTO pending_actions (action_id, circle_id, user_id, action_type, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['dp1', 'c1', 'p1', 'delegated_probe_response', JSON.stringify({ requested_by: 'g5', topic: 'how you are feeling' }), now]);

    apiResponder = (prompt) => {
        if (prompt.includes('assessing the confidence level')) return { confidence: 0.95 };
        if (isReplyPrompt(prompt)) return { reply: 'I am right here with you.' };
        return undefined;
    };
    try {
        const { result, sent } = await collectBroadcasts(() => handleMessage('p1', 'c1', 'bad chest pain and I cannot breathe'));
        const toPatient = sent.filter(b => b.targetUsers.includes('p1'));

        assert.equal(toPatient.length, 1, JSON.stringify(toPatient.map(b => b.reply || b.message)));
        assert.equal(result.criticality, 'HIGH');
        assert.match(result.reply, /^Please call 112|^If you are in danger/);
        assert.match(result.reply, /passed your message on to gwen in the app. Do you want me to alert gwen now?/);
        assert.deepEqual(result.proposal.recipients, [{ username: 'gwen', role: 'caregiver' }]);
        assert.ok(sent.some(b => b.targetUsers.includes('g5') && /Response from pat/.test(b.reply || '')), 'answer forwarded to gwen');
        assert.equal((await db.all('SELECT * FROM escalations')).length, 0, 'nothing is escalated until pat accepts');
        assert.deepEqual((await db.all('SELECT action_type FROM pending_actions')).map(r => r.action_type), ['escalation_proposal']);
    } finally {
        apiResponder = null;
        await db.run("DELETE FROM care_circle_members WHERE user_id = 'g5'");
        await db.run('DELETE FROM pending_actions');
    }
});

test('a doctor summary acknowledges only the escalations it showed to that doctor', async () => {
    const { generateAndSendSummary } = await import('../handlers/commands/commandHelpers.js');
    const { escalate } = await import('../services/escalationService.js');
    const { getUnreadEscalationsForUser } = await import('../db/index.js');
    const now = Date.now();
    for (const [id, name] of [['d7', 'dr_lee'], ['d8', 'dr_kim']]) {
        await db.run('INSERT OR IGNORE INTO users (user_id, username, created_at) VALUES (?, ?, ?)', [id, name, now]);
    }
    await clearEscalations();
    await db.run("INSERT INTO care_circle_members (circle_id, user_id, role) VALUES ('c1', 'd7', 'doctor')");
    try {
        // Sent to dr_lee only; dr_kim joins afterwards and was never sent it
        const shown = await escalate({ circleId: 'c1', userId: 'p1', type: 'CRITICAL', details: 'chest pain', messageId: null });
        const anonymous = await escalate({ circleId: 'c1', userId: 'p1', type: 'ANONYMOUS_CONSULTATION', details: 'a question', anonymous: true });
        await db.run("INSERT INTO care_circle_members (circle_id, user_id, role) VALUES ('c1', 'd8', 'doctor')");

        const { sent } = await collectBroadcasts(() => generateAndSendSummary('d8', 'c1', 'pat'));
        assert.ok(sent.some(b => b.targetUsers.includes('d8')));
        assert.equal((await db.get('SELECT status FROM escalations WHERE escalation_id = ?', [shown.escalationId])).status, 'OPEN',
            "another doctor's summary acknowledges nothing");

        const second = await collectBroadcasts(() => generateAndSendSummary('d7', 'c1', 'pat'));
        assert.ok(second.sent.some(b => b.targetUsers.includes('p1') && /dr_lee has seen the concern/.test(b.reply)), 'patient told who saw it');
        assert.deepEqual((await getUnreadEscalationsForUser('d7')).map(e => e.escalation_id), [anonymous.escalationId],
            'the anonymous request stays out of the named summary and stays unread');
    } finally {
        await db.run("DELETE FROM care_circle_members WHERE user_id IN ('d7', 'd8')");
        await clearEscalations();
    }
});

test('different descriptions, different people and empty values are not fact conflicts', async () => {
    const { isFactConflict, handleFactProcessing } = await import('../handlers/message_logic/conflictHandler.js');
    const current = (overrides) => ({ reported_by: 'p1', subject_id: 'p1', value: 'took morning dose', ...overrides });
    const reported = (overrides) => ({ key: 'medication_adherence', value: 'missed morning dose', reporterId: 'g1', subjectId: 'p1', subjectNamed: true, ...overrides });

    // From the Maverick run: the same speaker-relative key used by two people
    assert.equal(isFactConflict(current({ subject_id: 'p1', value: 'feeling frustrated' }), reported({ key: 'symptom_report', value: 'anxious', subjectId: 'g1', subjectNamed: false })), false);
    assert.equal(isFactConflict(current({ value: 'treatment plan' }), reported({ key: 'other_person_medication', value: 'null', subjectNamed: false })), false);
    assert.equal(isFactConflict(current({ value: 'worrying' }), reported({ key: 'other_person_symptom', value: 'withdrawn' })), false, 'descriptions can both be true');
    assert.equal(isFactConflict(current({ value: 'none' }), reported()), false, 'empty value');
    assert.equal(isFactConflict(current({ value: 'Missed morning dose.' }), reported()), false, 'same value, different punctuation');
    assert.equal(isFactConflict(current({ reported_by: 'g1' }), reported()), false, 'same reporter');
    assert.equal(isFactConflict(undefined, reported()), false);
    // A real contradiction about the same person
    assert.equal(isFactConflict(current(), reported()), true);

    await clearEscalations();
    await db.run("DELETE FROM facts_v2 WHERE circle_id = 'c1'");
    await handleFactProcessing('p1', 'c1', { facts: { symptom_report: 'feeling frustrated' } });
    await handleFactProcessing('g1', 'c1', { facts: { symptom_report: 'anxious', other_person_medication: 'null' } });
    assert.equal((await db.all("SELECT * FROM escalations WHERE type = 'CONFLICT'")).length, 0);

    await handleFactProcessing('p1', 'c1', { facts: { medication_adherence: { value: 'took morning dose', subject_id: 'p1' } } });
    await handleFactProcessing('g1', 'c1', { facts: { medication_adherence: { value: 'missed morning dose', subject_id: 'p1' } } });
    assert.equal((await db.all("SELECT * FROM escalations WHERE type = 'CONFLICT'")).length, 1);
    await clearEscalations();
});
