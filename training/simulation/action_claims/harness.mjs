/**
 * @fileoverview training/simulation/action_claims/harness.mjs
 * Runs simulation scenarios and records, per turn, everything that left the system:
 * every message sent to the speaker (not just the reply), alerts and messages sent to
 * other members, escalations written, escalate events and their recipients, the
 * per-turn action claim check, and alert proposals and what happened to them.
 *
 * Usage:
 *   node training/simulation/action_claims/harness.mjs [options] <label> <turns> <runs> <scenario...>
 *
 * Options:
 *   --root <dir>        Code to run (default: this repository). Point it at a checkout of
 *                       another commit to compare versions.
 *   --out <dir>         Where results and databases go (default: ./output next to this file)
 *   --proposals <mode>  What happens to an alert proposal ("Do you want me to alert ...?"):
 *                         natural - the simulated user answers it, or not, in their next message (default)
 *                         accept  - accepted from the card right after the turn, as if tapped
 *                         reject  - rejected from the card right after the turn
 *   --no-repeat-score   Skip the repeated question check (see repeat_scorer.mjs)
 *
 * Each scenario run uses a fresh database. Results are written to
 * <out>/results_<label>.json after every run; compare runs with summarize.mjs.
 */
import path from 'path';
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import { scoreRun } from './repeat_scorer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
    const i = args.indexOf(name);
    if (i === -1) return fallback;
    const [, value] = args.splice(i, 2);
    return value;
};
const root = path.resolve(option('--root', path.join(here, '..', '..', '..')));
const outDir = path.resolve(option('--out', path.join(here, 'output')));
const proposalMode = option('--proposals', 'natural');
const noRepeatIndex = args.indexOf('--no-repeat-score');
const scoreRepeats = noRepeatIndex === -1;
if (!scoreRepeats) args.splice(noRepeatIndex, 1);
const [label, turnsArg, runsArg, ...scenarios] = args;
if (!label || !turnsArg || !runsArg || scenarios.length === 0 || !['natural', 'accept', 'reject'].includes(proposalMode)) {
    console.error('Usage: node harness.mjs [--root <dir>] [--out <dir>] [--proposals natural|accept|reject] <label> <turns> <runs> <scenario...>');
    process.exit(1);
}

process.chdir(root);
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { SimulationDriver } = await imp('training/simulation/simulator.js');
const { getScenarios } = await imp('training/simulation/scenarios.js');
const { SimulationAI } = await imp('training/simulation/ai_integration.js');
const { events } = await imp('orchestrator.js');
const { getDb } = await imp('db/index.js');
// Older code has no proposals; the harness then records none
const responseHandler = await imp('handlers/message_logic/actionResponseHandler.js');
const handleProposalDecision = responseHandler.handleProposalDecision ?? null;
if (proposalMode !== 'natural' && !handleProposalDecision) {
    console.warn(`[harness] This code has no alert proposals; --proposals ${proposalMode} has no effect`);
}

// Count replies the claim check replaced or regenerated, from the message handler's warnings
let guardReplacements = 0;
let guardRegenerations = 0;
const origWarn = console.warn;
console.warn = (...warnArgs) => {
    if (String(warnArgs[0]).includes('Replaced reply containing unsupported action claims')) guardReplacements++;
    if (String(warnArgs[0]).includes('Regenerated reply containing unsupported action claims')) guardRegenerations++;
    return origWarn(...warnArgs);
};

/**
 * Record broadcasts and escalate events while `fn` runs, letting fire-and-forget
 * broadcasts from the same step land before stopping.
 */
async function capture(fn) {
    const broadcasts = [];
    const escalateEvents = [];
    const onBroadcast = (p) => broadcasts.push(p);
    const onEscalate = (p) => escalateEvents.push(p);
    events.on('broadcast', onBroadcast);
    events.on('escalate', onEscalate);
    let result;
    let error = null;
    try {
        result = await fn();
    } catch (e) {
        error = e.message;
    } finally {
        await new Promise(res => setTimeout(res, 300));
        events.off('broadcast', onBroadcast);
        events.off('escalate', onEscalate);
    }
    return { result, error, broadcasts, escalateEvents };
}

async function openProposalIds(db, userId) {
    const rows = await db.all("SELECT action_id FROM pending_actions WHERE user_id = ? AND action_type = 'escalation_proposal'", [userId]);
    return rows.map(r => r.action_id);
}

let turnLog = [];
const orig = SimulationAI.prototype.getAgentResponse;
SimulationAI.prototype.getAgentResponse = async function (userId, message, ctx) {
    const db = await getDb();
    const started = Date.now();
    const replacedBefore = guardReplacements;
    const regeneratedBefore = guardRegenerations;
    const proposalsBefore = await openProposalIds(db, userId);

    const turn = await capture(() => orig.call(this, userId, message, ctx));
    const r = turn.result;

    const members = await db.all(`
        SELECT DISTINCT u.user_id, u.username, m.role FROM care_circle_members m JOIN users u ON u.user_id = m.user_id
        WHERE m.circle_id IN (SELECT circle_id FROM care_circle_members WHERE user_id = ?)`, [userId]);
    const nameOf = (id) => members.find(m => m.user_id === id)?.username || id;
    const roleOf = (id) => members.find(m => m.user_id === id)?.role;
    const escalationsSince = async (since) => (await db.all('SELECT type FROM escalations WHERE timestamp >= ?', [since])).map(e => e.type);
    const summarizeEvents = (list) => list.map(e => ({ type: e.type, recipients: (e.recipients || []).map(nameOf), hasRecipients: Array.isArray(e.recipients) }));
    const toOthers = (list) => list.filter(b => !b.targetUsers?.includes(userId)).map(b => ({
        to: (b.targetUsers || []).map(nameOf),
        roles: (b.targetUsers || []).map(roleOf),
        text: String(b.reply || b.message || '').slice(0, 200)
    }));

    const escalations = await escalationsSince(started);
    const proposalsAfter = await openProposalIds(db, userId);
    const proposal = turn.broadcasts.find(b => b.targetUsers?.includes(userId) && b.proposal)?.proposal ?? null;

    // An open proposal that this turn closed without making a new one was answered in chat
    let answeredInChat = null;
    const closed = proposalsBefore.filter(id => !proposalsAfter.includes(id));
    if (closed.length > 0 && !proposal) {
        answeredInChat = escalations.includes('CRITICAL') ? 'accepted' : 'declined_or_expired';
    }

    // Accept or reject from the card, as a separate step after the turn
    let proposalDecision = null;
    if (proposal && handleProposalDecision && proposalMode !== 'natural') {
        const decidedAt = Date.now();
        const decision = await capture(() => handleProposalDecision(userId, proposal.actionId, proposalMode === 'accept'));
        proposalDecision = {
            mode: proposalMode,
            status: decision.result?.status ?? 'error',
            error: decision.error,
            reply: decision.result?.reply ?? null,
            escalations: await escalationsSince(decidedAt),
            toOthers: toOthers(decision.broadcasts),
            escalateEvents: summarizeEvents(decision.escalateEvents)
        };
    }

    turnLog.push({
        userId,
        speakerRole: roleOf(userId),
        message: String(message).slice(0, 300),
        agent_response: r?.agent_response || null,
        toSpeaker: turn.broadcasts.filter(b => b.targetUsers?.includes(userId)).map(b => ({ text: b.reply || b.message || '', source: b.source || b.from })),
        toOthers: toOthers(turn.broadcasts),
        escalations,
        doctors: members.filter(m => m.role === 'doctor').map(m => m.username),
        intent: r?.state_vector?.intent,
        criticality: r?.state_vector?.criticality,
        guardReplaced: guardReplacements - replacedBefore,
        guardRegenerated: guardRegenerations - regeneratedBefore,
        actionClaims: r?.action_claims ?? null,
        escalateEvents: summarizeEvents(turn.escalateEvents),
        proposal: proposal ? { actionId: proposal.actionId, recipients: proposal.recipients.map(x => x.username) } : null,
        answeredInChat,
        proposalDecision,
        error: turn.error
    });
    if (turn.error) throw new Error(turn.error);
    return r;
};

const all = getScenarios({ includeGenerated: true });
const out = [];
fs.mkdirSync(path.join(outDir, 'dbs'), { recursive: true });
for (const key of scenarios) {
    if (!all[key]) { out.push({ scenario: key, error: 'not found' }); continue; }
    for (let run = 1; run <= Number(runsArg); run++) {
        const cfg = { ...all[key], turns: Number(turnsArg), sessions: undefined };
        const dbPath = path.join(outDir, 'dbs', `db_${label}_${key}_${run}.db`);
        for (const s of ['', '-wal', '-shm']) fs.rmSync(dbPath + s, { force: true });
        turnLog = [];
        const started = Date.now();
        let error = null;
        const driver = new SimulationDriver({ dbPath, autoFeedback: false, logResults: false });
        try { await driver.runScenario(cfg, key); } catch (e) { error = e.message; }
        const seconds = Math.round((Date.now() - started) / 1000);
        const result = { scenario: key, run, error, seconds, proposalMode, turns: turnLog };
        if (scoreRepeats) await scoreRun(result);
        out.push(result);
        fs.writeFileSync(path.join(outDir, `results_${label}.json`), JSON.stringify(out, null, 2));
        console.log(`[harness] ${label} ${key} run ${run}: ${turnLog.length} turns, ${seconds}s${error ? ' ERROR ' + error : ''}`);
    }
}
console.log(`DONE ${label}`);
process.exit(0);
