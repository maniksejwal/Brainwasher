/**
 * @fileoverview tensornets bridge — JS side
 *
 * Calls the Python tensornets FastAPI server (tensornets/server.py).
 * Falls back gracefully to the pure-JS physio module when the Python
 * server is not running (development without Python, or unit tests).
 *
 * Usage:
 *   import { getPhysioSummary, scoreCandidates } from '../physio/tensornetsBridge.js';
 *
 *   const summary = await getPhysioSummary(physioState);
 *   // → { stress_index, stress_label, prompt_hint, gamma, lambda1, half_life_turns, vector }
 *
 *   const scored = await scoreCandidates({ subject_id, physio_state, candidates });
 *   // → { candidates: [{rank, candidate_text, projected_stress, ...}], best }
 *
 * Start the Python server:
 *   cd tensornets && uvicorn server:app --port 8765 --reload
 */

import config from '../../config.js';
import {
    stress_index,
    stressLabel,
    gamma_from_state,
    gamma_to_lambda1,
    stress_half_life_turns,
    to_vector,
} from './state.js';

const BRIDGE_URL = process.env.TENSORNETS_URL || config.TENSORNETS_URL || 'http://localhost:8765';
const TIMEOUT_MS = 3000;  // fall back to JS if Python doesn't respond in 3s

let _pythonAvailable = null;  // null = untested, true/false = known
let _thresholds = null;       // cached from /physio/thresholds

/**
 * Load physiological thresholds from the Python server.
 * Falls back to the JS defaults in state.js if Python is unavailable.
 * Called once at startup; result cached for the process lifetime.
 * @returns {Promise<{stress_index: object, hrv_ms: object}|null>}
 */
export async function loadThresholds() {
    if (_thresholds) return _thresholds;
    if (await isPythonAvailable()) {
        const t = await _call('/physio/thresholds', null, 'GET').catch(() => null);
        if (t) {
            _thresholds = t;
            return t;
        }
    }
    // JS fallback: mirror of backend_base.py STRESS_THRESHOLDS / HRV_THRESHOLDS
    _thresholds = {
        stress_index: { critical: 0.75, high_stress: 0.55, moderate_stress: 0.35, low_stress: 0.0 },
        hrv_ms:       { critical: 15,   high_stress: 25,   moderate_stress: 40 },
    };
    return _thresholds;
}

/**
 * Check if the Python server is reachable. Cached for 60 seconds.
 */
let _lastCheck = 0;
async function isPythonAvailable() {
    const now = Date.now();
    if (_pythonAvailable !== null && now - _lastCheck < 60_000) return _pythonAvailable;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1500);
        const res = await fetch(`${BRIDGE_URL}/health`, { signal: ctrl.signal });
        clearTimeout(timer);
        _pythonAvailable = res.ok;
    } catch {
        _pythonAvailable = false;
    }
    _lastCheck = Date.now();
    if (!_pythonAvailable) {
        console.warn('[TensornetsBridge] Python server not reachable. Using pure-JS fallback.');
    }
    return _pythonAvailable;
}

/**
 * Call a Python endpoint with a JSON body and a timeout.
 * Returns null on failure (allows caller to fall back to JS).
 */
async function _call(endpoint, body, method = 'POST') {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
            signal:  ctrl.signal,
        };
        if (method !== 'GET' && body !== null) {
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(`${BRIDGE_URL}${endpoint}`, opts);
        clearTimeout(timer);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        clearTimeout(timer);
        return null;
    }
}

// ── JS-only fallback ──────────────────────────────────────────────────────────

function _jsFallbackSummary(physioState) {
    const idx     = stress_index(physioState);
    const gamma   = gamma_from_state(physioState);
    const lambda1 = gamma_to_lambda1(gamma);
    const half    = stress_half_life_turns(gamma);
    const label   = stressLabel(idx);
    return {
        stress_index:     +idx.toFixed(4),
        stress_label:     label.label,
        prompt_hint:      label.promptHint,
        gamma:            +gamma.toFixed(5),
        lambda1:          +lambda1.toFixed(5),
        half_life_turns:  isFinite(half) ? +half.toFixed(2) : null,
        vector:           to_vector(physioState).map(x => +x.toFixed(4)),
        source:           'js_fallback',
    };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get full physiological summary for a state object.
 * Tries Python server first; falls back to pure JS.
 *
 * @param {object} physioState  — PhysiologicalState created by createPhysiologicalState()
 * @returns {Promise<object>}   — { stress_index, stress_label, prompt_hint, gamma, ... }
 */
export async function getPhysioSummary(physioState) {
    if (await isPythonAvailable()) {
        const result = await _call('/physio/state', physioState);
        if (result) return { ...result, source: 'python' };
    }
    return _jsFallbackSummary(physioState);
}

/**
 * Append a physiological state to the subject's running history on the Python server.
 * Used to maintain trajectory data for HRV trend charts and baseline estimation.
 *
 * Falls back silently (history not stored) if Python is unavailable.
 *
 * @param {object} physioState
 * @returns {Promise<object|null>}  — trajectory data or null
 */
export async function appendPhysioHistory(physioState) {
    if (!(await isPythonAvailable())) return null;
    return _call('/physio/history/append', physioState);
}

/**
 * Score candidate response texts by projected physiological stress impact.
 * This is the practical MCTS approximation running today.
 *
 * @param {object} params
 * @param {string}   params.subject_id
 * @param {object}   params.physio_state   — raw PhysiologicalState fields
 * @param {string[]} params.candidates     — list of candidate response texts
 * @param {number}   [params.n_lookahead=3]
 * @returns {Promise<object>}  — { candidates: [{rank, projected_stress, ...}], best }
 */
export async function scoreCandidates({ subject_id, physio_state, candidates, n_lookahead = 3 }) {
    if (await isPythonAvailable()) {
        const result = await _call('/mcts/score-candidates', {
            subject_id, physio_state, candidates, n_lookahead,
        });
        if (result) return result;
    }

    // JS fallback: simple keyword scoring
    const HIGH_STRESS_KEYWORDS = new Set([
        'denied', 'reject', 'owe', 'cost', 'bill', 'payment', 'out-of-pocket',
        'deductible', 'copay', 'premium', 'liability', 'balance',
        'diagnosis', 'prognosis', 'terminal', 'chronic',
    ]);
    const DE_ESCALATION_KEYWORDS = new Set([
        'understand', 'together', 'support', 'help', 'advocate',
        'moment', 'listen', 'calm', 'safe',
    ]);

    const baseStress = stress_index(physio_state);
    const gamma      = gamma_from_state(physio_state);

    const scored = candidates.map((text, i) => {
        const words = new Set(text.toLowerCase().split(/\W+/));
        const stressW = [...words].filter(w => HIGH_STRESS_KEYWORDS.has(w)).length;
        const calmW   = [...words].filter(w => DE_ESCALATION_KEYWORDS.has(w)).length;
        const amp     = Math.max(0.5, Math.min(1 + 0.05 * stressW - 0.03 * calmW, 2.0));

        let cum = 0, cur = baseStress;
        for (let t = 1; t <= n_lookahead; t++) {
            cur = cur * (t === 1 ? amp : 1) * gamma_to_lambda1(gamma);
            cum += cur;
        }
        return {
            rank: null, candidate_index: i, candidate_text: text,
            projected_stress: +cum.toFixed(4),
            amplification: +amp.toFixed(3),
            stress_keywords: stressW, calm_keywords: calmW,
            source: 'js_fallback',
        };
    });

    scored.sort((a, b) => a.projected_stress - b.projected_stress);
    scored.forEach((s, i) => { s.rank = i + 1; });
    return { subject_id, current_stress: +baseStress.toFixed(4), candidates: scored, best: scored[0] };
}

/**
 * Run a synthetic HRV simulation via the Python server.
 * Used by the simulation dashboard to show stress trajectories.
 */
export async function runPhysioSimulation({ subject_id, n_turns = 20, hrv_baseline_ms = 35, stressors = [] }) {
    if (await isPythonAvailable()) {
        const result = await _call('/physio/simulate', { subject_id, n_turns, hrv_baseline_ms, stressors });
        if (result) return result;
    }
    return null;  // JS doesn't have the OU simulator; Python required
}

/**
 * Score candidate responses using a therapeutic-mode-aware MCTS cost function.
 * Delegates to /therapy/score-candidates on the Python server.
 *
 * @param {object} params
 * @param {string}   params.subject_id
 * @param {object}   params.physio_state
 * @param {string[]} params.candidates
 * @param {string}   [params.mode='standard']         — TherapeuticMode value
 * @param {string}   [params.deaddiction_phase='rapport']
 * @param {number}   [params.flooding_target=0.75]
 * @param {number}   [params.n_lookahead=3]
 * @returns {Promise<object|null>}  — { best, candidates, mode, phase, current_stress }
 */
export async function scoreCandidatesTherapy({
    subject_id,
    physio_state,
    candidates,
    mode = 'standard',
    deaddiction_phase = 'rapport',
    flooding_target = 0.75,
    n_lookahead = 3,
}) {
    if (await isPythonAvailable()) {
        const result = await _call('/therapy/score-candidates', {
            subject_id,
            physio_state,
            candidates,
            mode,
            deaddiction_phase,
            flooding_target,
            n_lookahead,
        });
        if (result) return result;
    }
    // Fallback: use the standard scoreCandidates
    return scoreCandidates({ subject_id, physio_state, candidates, n_lookahead });
}

/**
 * Record a completed therapeutic session and advance the deaddiction phase.
 * Returns { session_count, current_phase, next_phase, rapport_scores, secret_signals }.
 *
 * @param {object} sessionData — matches SessionRecordIn schema
 * @returns {Promise<object|null>}
 */
export async function recordTherapySession(sessionData) {
    if (await isPythonAvailable()) {
        return _call('/therapy/record-session', sessionData);
    }
    return null;
}

/**
 * Detect topics associated with consistent HRV suppression for a subject.
 * Returns an array of { topic, mean_hrv_ms, suppression_ratio, confidence }.
 *
 * @param {string} subject_id
 * @param {number} [sensitivity=0.75]
 */
export async function detectSecrets(subject_id, sensitivity = 0.75) {
    if (await isPythonAvailable()) {
        return _call(`/therapy/secrets/${subject_id}?sensitivity=${sensitivity}`, null, 'GET');
    }
    return null;
}

/**
 * Get a longitudinal prompt hint for injection into the LLM system prompt.
 * Summarises phase, rapport trend, and identified secret-bearing topics.
 *
 * @param {string} subject_id
 * @returns {Promise<{hint: string}|null>}
 */
export async function getLongitudinalPromptHint(subject_id) {
    if (await isPythonAvailable()) {
        return _call(`/therapy/prompt-hint/${subject_id}`, null, 'GET');
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inter-agent communication (Phase 4 — shared dialogue state)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a commitment made by an agent and propagate the physiological
 * prediction to all other agents via the social coupling matrix V_int.
 *
 * Call this after each agent response is finalised.
 *
 * @param {object} opts
 * @param {string} opts.session_id   - Conversation session ID
 * @param {string} opts.agent_id     - e.g. 'patient', 'clinician', 'caregiver'
 * @param {string} opts.statement    - The committed statement
 * @param {string} opts.topic        - Topic label (e.g. 'pre-procedure fasting')
 * @param {number} [opts.delta_hrv_ms=0] - Predicted Δ HRV from this statement
 * @param {boolean} [opts.is_clinical=false] - Higher consistency weight
 * @param {number} [opts.current_hrv=40]
 * @returns {Promise<{hrv_predictions: object}|null>}
 */
export async function agentCommit({
    session_id, agent_id, statement, topic,
    delta_hrv_ms = 0, is_clinical = false, current_hrv = 40,
}) {
    if (await isPythonAvailable()) {
        return _call('/agents/commit', {
            session_id, agent_id, statement, topic,
            delta_hrv_ms, is_clinical, current_hrv,
        });
    }
    return null;
}

/**
 * Retrieve the cross-agent consistency hint for injection into an agent's prompt.
 * Returns a string listing commitments from other agents and the predicted HRV.
 *
 * @param {string} session_id
 * @param {string} agent_id
 * @returns {Promise<{hint: string, predicted_hrv: number|null, escalation_requested: boolean}|null>}
 */
export async function getConsistencyHint(session_id, agent_id) {
    if (await isPythonAvailable()) {
        return _call(`/agents/consistency-hint/${session_id}/${agent_id}`, null, 'GET');
    }
    return null;
}

/**
 * Request escalation from one companion to another.
 * Called by MCTS when the cost function plateaus or a crisis is detected.
 *
 * @param {object} opts
 * @param {string} opts.session_id
 * @param {string} opts.from_agent
 * @param {string} opts.to_agent
 * @param {string} opts.reason
 * @returns {Promise<{escalation_target: string}|null>}
 */
export async function requestEscalation({ session_id, from_agent, to_agent, reason }) {
    if (await isPythonAvailable()) {
        return _call('/agents/escalate', { session_id, from_agent, to_agent, reason });
    }
    return null;
}

/**
 * Clear the shared dialogue state at end of session.
 * @param {string} session_id
 */
export async function clearAgentSession(session_id) {
    if (await isPythonAvailable()) {
        return _call(`/agents/session/${session_id}`, null, 'DELETE');
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: MCTS action selection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ask Python BaseMCTS/DialogMCTS to pick the best action from a candidate set.
 *
 * Call this AFTER action_selector.js has produced a shortlist of candidate actions,
 * and BEFORE the LLM generates the actual message text.
 *
 * @param {object} opts
 * @param {object}   opts.physio_state         - {hrv_ms, stress_index, ...}
 * @param {string[]} opts.candidate_actions    - From action_selector.js
 * @param {string}   [opts.mode='standard']
 * @param {number}   [opts.depth=4]
 * @param {number}   [opts.iterations=80]
 * @param {string}   [opts.context='']
 * @param {number}   [opts.flooding_target_stress=0.7]
 * @returns {Promise<{action: string, q_value: number, tree_stats: object}|null>}
 */
export async function getMCTSAction({
    physio_state,
    candidate_actions,
    mode = 'standard',
    depth = 4,
    iterations = 80,
    context = '',
    flooding_target_stress = 0.7,
}) {
    if (await isPythonAvailable()) {
        return _call('/mcts/best-action', {
            physio_state, candidate_actions, mode, depth, iterations,
            context, flooding_target_stress,
        });
    }
    // JS fallback: return first candidate with neutral score
    return { action: candidate_actions[0] ?? null, q_value: 0.5, tree_stats: {} };
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-session lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called when a user comes online. Returns longitudinal MCTS recommendation
 * for this session's therapeutic strategy.
 *
 * The JS companion should use recommended_phase and recommended_mode to
 * configure its prompt context for the session.
 *
 * @param {object} opts
 * @param {string}  opts.subject_id
 * @param {string}  [opts.therapeutic_mode='standard']
 * @param {string}  [opts.deaddiction_phase='rapport']
 * @param {string}  [opts.session_goal='']
 * @returns {Promise<{session_id, recommended_phase, recommended_mode,
 *                    longitudinal_rationale, readiness_score,
 *                    contact_permitted, sessions_until_flooding}|null>}
 */
/**
 * Open a tensornets session when a user comes online.
 *
 * This is called by CompanionCoordinator.openSession() alongside the existing
 * futurePlanningHandler.processPendingFutureItems() — both are needed:
 *   - The JS future_plans DB table owns TOPIC STACKING (weeks/months-long agendas,
 *     deferred topics, scheduled messages, trigger-based re-engagement).
 *     That system is authoritative and is NOT replaced here.
 *   - This function handles the TENSORNETS layer: physiological session state,
 *     longitudinal MCTS hints, and Phase 4 shared tensor buffer setup.
 *
 * TOPIC STACK NOTE
 * ----------------
 * A user may have multiple concurrent long-running topics:
 *   - 6-week CBT series (behaviour change, not just deaddiction)
 *   - 3-month medication adherence programme
 *   - Immediate job-stress conversation today
 * The topic being worked NOW is session_goal. The pending topics live in the
 * JS future_plans / scheduled_messages DB and are surfaced by
 * futurePlanningHandler.processPendingFutureItems().
 *
 * therapeutic_context replaces the narrow 'deaddiction_phase' concept.
 * It accepts any behaviour-change context label, not only deaddiction:
 *   'behaviour_change_rapport' | 'behaviour_change_ambivalence' |
 *   'behaviour_change_action' | 'behaviour_change_maintenance' |
 *   'flooding' | 'standard' | 'grief' | 'stress_acute' | ...
 *
 * @param {object} opts
 * @param {string}  opts.subject_id
 * @param {string}  [opts.therapeutic_mode='standard']
 * @param {string}  [opts.therapeutic_context='behaviour_change_rapport']
 *                  Replaces narrow 'deaddiction_phase' — any behaviour-change label.
 * @param {string}  [opts.session_goal='']        active topic this session
 * @param {string[]} [opts.stacked_topic_ids=[]]  IDs of pending JS future_plan tasks
 *                  (informational — Python uses these to prioritise MCTS weights)
 * @param {object[]} [opts.agents=[]]             Phase 4 SharedTensorBuffer agents
 * @returns {Promise<object|null>}
 */
export async function openSession({
    subject_id,
    therapeutic_mode = 'standard',
    therapeutic_context = 'behaviour_change_rapport',
    session_goal = '',
    stacked_topic_ids = [],
    agents = [],
}) {
    if (await isPythonAvailable()) {
        return _call('/session/open', {
            subject_id,
            therapeutic_mode,
            // server.py still receives deaddiction_phase for backward compat;
            // map therapeutic_context → deaddiction_phase until server.py is updated
            deaddiction_phase: therapeutic_context,
            session_goal,
            stacked_topic_ids,
            agents,
        });
    }
    return null;
}

/**
 * Phase 4 (G1/G3): Update one agent's HRV in the shared buffer and propagate V_int.
 * Call this after each conversational turn when new HRV data is available.
 *
 * @param {object} opts
 * @param {string}  opts.session_id
 * @param {string}  opts.agent_id
 * @param {number}  opts.hrv_ms
 * @param {boolean} [opts.apply_vint=true]
 * @returns {Promise<{hrv_delta, v_int_updates, hrv_summary, consistency_hint}|null>}
 */
export async function updateSharedTensorHRV({ session_id, agent_id, hrv_ms, apply_vint = true }) {
    if (await isPythonAvailable()) {
        return _call('/session/tensor/update', { session_id, agent_id, hrv_ms, apply_vint });
    }
    return null;
}

/**
 * Phase 4 (G2): Return the consistency hint and HRV summary for all agents.
 * Call this before generating a companion response to avoid contradictions.
 *
 * @param {object} opts
 * @param {string}  opts.session_id
 * @param {string}  [opts.requesting_agent_id='']
 * @returns {Promise<{hrv_summary, consistency_hint}|null>}
 */
export async function getSharedTensorSummary({ session_id, requesting_agent_id = '' }) {
    if (await isPythonAvailable()) {
        return _call('/session/tensor/summary', { session_id, requesting_agent_id });
    }
    return null;
}

/**
 * Called when a user goes offline. Persists session outcomes to longitudinal state.
 *
 * @param {object} opts
 * @param {string}  opts.subject_id
 * @param {number}  opts.final_stress
 * @param {number}  [opts.rapport_score=0]
 * @param {boolean} [opts.secret_detected=false]
 * @param {string}  [opts.secret_detail='']
 * @param {boolean} [opts.goal_achieved=false]
 */
export async function closeSession({
    subject_id, final_stress, rapport_score = 0,
    secret_detected = false, secret_detail = '', goal_achieved = false,
}) {
    if (await isPythonAvailable()) {
        return _call('/session/close', {
            subject_id, final_stress, rapport_score,
            secret_detected, secret_detail, goal_achieved,
        });
    }
    return null;
}

/**
 * Get longitudinal MCTS recommendation for a subject without opening a session.
 * Use for planning (e.g., deciding whether to proactively contact the user).
 *
 * @param {string} subject_id
 */
export async function getSessionHint(subject_id) {
    if (await isPythonAvailable()) {
        return _call(`/session/hint/${subject_id}`, null, 'GET');
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Python judge (Maverick via boto3)
//
// The JS simulation stack already has two scoring layers:
//   1. SimulationScorer (simulation_scorer.js) — urgency, denial, goal progress
//   2. ConversationQualityAssessor (llm_scorer.js) — empathy/solution balance,
//      conversation quality, probing questions  (uses makeApiCall → Scout in-process)
//
// These functions are NOT replacements for those — they call the PYTHON judge,
// which adds tensornets-specific dimensions that llm_scorer.js cannot compute:
//   - physio_alignment: was the response appropriate given HRV/stress?
//   - clinical_accuracy: factual correctness (needs a larger judge model)
//   - persona_consistency: is the response in-role?
//
// USE CASE:
//   JS scorer → runs every turn, fast, in-process (Scout quality)
//   Python judge → called by /mcts judge CLI command or batch experiments (Maverick/405B)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a single companion turn using the Python LLM-as-judge (Maverick).
 *
 * Adds tensornets-specific dimensions (physio_alignment, clinical_accuracy)
 * that the existing ConversationQualityAssessor (llm_scorer.js) does not cover.
 * For standard simulation scoring, use SimulationScorer directly.
 *
 * @param {object} opts
 * @param {string}  opts.patient_input
 * @param {string}  opts.companion_reply
 * @param {object}  [opts.physio_context={}]
 * @param {string}  [opts.mode='standard']
 * @param {string}  [opts.judge_model='maverick'] - 'maverick' | '405b' | 'scout'
 * @returns {Promise<{scores, overall, passed, reasoning}|null>}
 */
export async function judgeDialogueTurn({
    patient_input, companion_reply, physio_context = {},
    mode = 'standard', judge_model = 'maverick',
}) {
    if (await isPythonAvailable()) {
        return _call('/judge/turn', {
            patient_input, companion_reply, physio_context, mode, judge_model,
        });
    }
    return null;
}

/**
 * Batch-evaluate all turns of a session using the Python judge.
 *
 * @param {Array<{patient_input, companion_reply, physio_context}>} turns
 * @param {string} mode
 * @param {string} judge_model
 */
export async function judgeDialogueSession(turns, mode = 'standard', judge_model = 'maverick') {
    if (await isPythonAvailable()) {
        return _call('/judge/session', { turns, mode, judge_model });
    }
    return null;
}

/**
 * Cross-evaluator discrepancy audit.
 *
 * Accepts results from the JS simulation_scorer AND the Python judge and
 * returns a discrepancy report: turns where the evaluators disagree.
 *
 * Use this after a session ends (or during training) to surface the most
 * informative turns for manual review. Turns where all evaluators agree
 * are the highest-confidence training signals for ALS/A3C updates.
 *
 * @param {Array<{turn, score, raw}>}    jsScores      - from SimulationScorer
 * @param {Array<{turn, evaluator, judgment}>} pythonResults - from judgeDialogueTurn()
 * @param {string}  dimension        - scoring dimension to compare, e.g. 'overall'
 * @param {number}  spreadThreshold  - minimum spread to flag (0..1). Default 0.2.
 *
 * @returns {Promise<{discrepancies, weighted_scores, high_confidence_turns}|null>}
 */
export async function auditJudgeDiscrepancy({
    jsScores = [],
    pythonResults = [],
    dimension = 'overall',
    spreadThreshold = 0.2,
} = {}) {
    if (await isPythonAvailable()) {
        return _call('/judge/audit', {
            js_scores:        jsScores,
            python_results:   pythonResults,
            dimension,
            spread_threshold: spreadThreshold,
        });
    }
    return null;
}
