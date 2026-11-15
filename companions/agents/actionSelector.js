/**
 * @fileoverview companions/agents/actionSelector.js
 * Picks the planned action for a patient's turn before the reply is written. Advisory:
 * on any failure the reply is written without a plan.
 */
import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { PROMPT_ACTION_SELECTOR, ACTION_TO_FRAMES } from '../../prompts/action_selector.js';
import { buildKnownSection } from '../patientFacts.js';

const ALL_ACTIONS = [
    'open_question', 'empathic_reflection', 'affirmation', 'validate',
    'give_facts', 'give_options', 'summarise', 'psychoeducation',
    'challenger_insight', 'develop_discrepancy', 'loss_frame', 'socratic_probe',
    'socratic_reframe', 'change_topic', 'topic_from_stack'
];
// Not offered at medium stress, or ported without their prompt text
const NOT_PORTED = new Set(['challenger_insight', 'loss_frame']);
const FALLBACK = { selectedAction: 'validate', framesComponent: 'Responsibility' };

// Recent planned actions per circle and patient. In memory only: after a restart the
// selector starts with no history, which only loosens the variety rule for a turn or two.
const RECENT_LIMIT = 3;
const recentActions = new Map();
const recentKey = (circleId, userId) => `${circleId}:${userId}`;

export function getRecentActions(circleId, userId) {
    return recentActions.get(recentKey(circleId, userId)) || [];
}

function rememberAction(circleId, userId, action) {
    const key = recentKey(circleId, userId);
    recentActions.set(key, [...getRecentActions(circleId, userId), action].slice(-RECENT_LIMIT));
}

export function clearRecentActions() {
    recentActions.clear();
}

// Actions whose reply gives the patient an answer or a way forward
const ANSWERING_ACTIONS = new Set(['give_facts', 'give_options', 'psychoeducation']);
/**
 * Whether the plan leaves the patient's open questions or requests unanswered. The open
 * asks come from input understanding, which labels what the patient means; rhetorical
 * questions are never stored. This only triggers a second look by the model.
 * @param {object[]} openAsks - From updateOpenAsks
 * @param {string} action - Planned action
 * @param {string|null} secondaryAction - Planned secondary action
 * @returns {boolean}
 */
export function leavesAskUnanswered(openAsks, action, secondaryAction) {
    if (!openAsks?.length) return false;
    return !ANSWERING_ACTIONS.has(action) && !ANSWERING_ACTIONS.has(secondaryAction);
}

function recheckNote(action) {
    return `

**SECOND LOOK:** You chose "${action}", but the patient is still waiting for an answer (see "Still waiting for an answer"), and that action does not give one. Look again. If it should be answered now, choose an action that answers it (give_facts, give_options or psychoeducation), or keep "${action}" and set an answering secondary_action. An honest "I can't do that, but here is what you can do" counts as an answer. If "${action}" alone really is right (for example the patient needs support before anything else), keep it. Return the same JSON.`;
}

export function stressLevelFromIndex(index) {
    if (index === undefined || index === null) return 'medium';
    if (index >= 0.75) return 'critical';
    if (index >= 0.55) return 'high';
    if (index >= 0.35) return 'medium';
    return 'low';
}

/**
 * Actions allowed at a stress level. Only medium and low have prompt text here; high and
 * critical keep the source's short lists.
 */
export function availableActionsByStress(level) {
    if (level === 'critical') return ['validate', 'empathic_reflection'];
    if (level === 'high') return ['validate', 'empathic_reflection', 'give_facts', 'change_topic'];
    return ALL_ACTIONS.filter(a => !NOT_PORTED.has(a));
}

/**
 * The patient's messages and the companion's replies to them, oldest first. Messages from
 * other members are left out, so the plan cannot draw on them.
 * @param {object[]} history - Rows from messages, oldest first
 * @param {string} userId - The patient
 * @param {number} n - Lines to keep
 */
export function formatHistory(history, userId, n = 8) {
    const lines = (history || [])
        .filter(m => m.user_id === userId || m.role === 'patient_agent')
        .slice(-n)
        .map(m => `${m.user_id === userId ? 'Patient' : 'Companion'}: ${String(m.message ?? '').slice(0, 160)}`);
    return lines.join('\n') || '(no history)';
}

function lastCompanionWasQuestion(history) {
    const last = [...(history || [])].reverse().find(m => m.role === 'patient_agent');
    return Boolean(last && /\?\s*$/.test(String(last.message).trim()));
}

/**
 * @param {string} userId - The patient
 * @param {string} role - Speaker's role
 * @param {string} message - The patient's message
 * @param {object} context - Handler context, after clinical analysis
 * @returns {Promise<object|null>} Planned action fields, or null when not run or on failure
 */
export async function selectAction(userId, role, message, context = {}) {
    if (role !== 'patient') return null;
    if (context.clinicalAssessment?.criticality === 'HIGH') return null;

    const stressLevel = context.physioState ? stressLevelFromIndex(context.physioState.stress_index) : 'medium';
    const allowed = availableActionsByStress(stressLevel);
    const history = context.history || [];
    const turnsCompleted = history.filter(m => m.user_id === userId).length;

    const values = {
        STRESS_LEVEL: context.physioState ? stressLevel : 'medium (no physiological data)',
        AVAILABLE_ACTIONS: allowed.join(', '),
        TURNS_COMPLETED: String(turnsCompleted),
        REPETITION_DETECTED: String(Boolean(context.historyAnalyzer?.isRepetitive)),
        LAST_WAS_QUESTION: String(lastCompanionWasQuestion(history)),
        RECENT_ACTIONS: getRecentActions(context.circleId, userId).join(', ') || 'none',
        KNOWN_SECTION: buildKnownSection(context),
        MESSAGE: message,
        CONVERSATION_HISTORY: formatHistory(history, userId)
    };
    const prompt = PROMPT_ACTION_SELECTOR.replace(/\{\{(\w+)\}\}/g, (slot, name) => values[name] ?? '');

    try {
        let plan = await choose(prompt, allowed);
        if (!plan) return null;

        if (leavesAskUnanswered(context.openAsks, plan.selectedAction, plan.secondaryAction)) {
            // One second look; the model may keep its choice. A failed recheck keeps the first plan.
            const second = await choose(prompt + recheckNote(plan.selectedAction), allowed).catch(() => null);
            if (process.env.DEBUG_COMPANION) {
                console.log(`[ActionSelector] Rechecked ${plan.selectedAction}: now ${second?.selectedAction ?? 'unchanged (recheck failed)'}`);
            }
            if (second) plan = { ...second, rechecked: true };
        }

        rememberAction(context.circleId, userId, plan.selectedAction);
        if (process.env.DEBUG_COMPANION) {
            console.log(`[ActionSelector] Action selected: ${plan.selectedAction} [FRAMES: ${plan.framesComponent}]`);
        }
        return plan;
    } catch (error) {
        console.warn('[ActionSelector] Skipped:', error.message);
        return null;
    }
}

async function choose(prompt, allowed) {
    const parsed = parseCompanionResponse(await makeApiCall(prompt, [], true), 'ActionSelector');
    if (!parsed?.action) return null;

    const blocked = parsed.stress_gate_check === 'blocked' || !allowed.includes(parsed.action);
    const selectedAction = blocked ? FALLBACK.selectedAction : parsed.action;
    return {
        selectedAction,
        framesComponent: blocked
            ? FALLBACK.framesComponent
            : parsed.frames_component || ACTION_TO_FRAMES[selectedAction] || null,
        responseDepth: parsed.response_depth || null,
        secondaryAction: allowed.includes(parsed.secondary_action) ? parsed.secondary_action : null,
        strategyNote: !blocked && typeof parsed.strategy_note === 'string' ? parsed.strategy_note : null
    };
}
