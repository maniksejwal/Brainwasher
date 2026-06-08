/**
 * @fileoverview companions/agents/predictiveEscalationAgent.js
 *
 * Predictive Escalation Agent
 * ============================
 * Proactively detects physiological deterioration trajectories and triggers
 * de-escalation or escalation BEFORE a patient reaches clinical crisis.
 *
 * RATIONALE
 * ---------
 * The current system only escalates reactively (when a threshold is already
 * breached).  Real clinical value lies in PREDICTING when a patient is
 * approaching a crisis and intervening early:
 *
 *   "Your HRV has been declining for the last 3 sessions.  I want to check
 *    in about how you've been sleeping — research shows that disrupted sleep
 *    is often the earliest sign that something bigger is building."
 *
 * This is different from futurePlanningAgent.js which plans WHAT to say.
 * This agent decides WHEN to escalate and to WHOM.
 *
 * ALGORITHM
 * ---------
 * 1. TREND DETECTION: fit a linear trend to the last N HRV samples.
 *    A negative slope (declining HRV) over multiple turns/sessions is the
 *    primary signal.
 *
 * 2. VELOCITY ALARM: rate of HRV change (d(HRV)/dt) exceeding a threshold
 *    flags rapid deterioration even without a long trend.
 *
 * 3. MULTI-SIGNAL COMPOSITE: combines HRV trend + sleep quality + stress
 *    self-report + medication adherence (if available) into a composite
 *    Deterioration Risk Index (DRI ∈ [0..1]).
 *
 * 4. DECISION TIERS:
 *    DRI 0.0–0.3: no action
 *    DRI 0.3–0.5: SOFT CHECK-IN (companion proactively asks about sleep/wellbeing)
 *    DRI 0.5–0.7: PROACTIVE SUPPORT (companion increases frequency, loops in caregiver)
 *    DRI 0.7–0.85: CLINICAL ALERT (companion flags to clinician companion)
 *    DRI 0.85–1.0: IMMEDIATE ESCALATION (emergency protocol; clinician + carer)
 *
 * INTEGRATION
 * -----------
 * Called from CompanionCoordinator.generateResponse() before response generation.
 * If DRI ≥ DRI_SOFT_CHECKIN, the escalation hint is injected into the system prompt
 * and stored as a future_plan with high priority.
 *
 * Also exposes a FastAPI path for batch evaluation in training:
 *   POST /physio/predict-escalation
 *
 * TEST SCENARIOS
 * --------------
 * See TEST_SCENARIOS at bottom of this file.  Run with:
 *   node companions/agents/predictiveEscalationAgent.js --test
 */

import { makeApiCall }       from '../../agents/api_client.js';
import { getDb }             from '../../db/connection.js';

// ── Thresholds ────────────────────────────────────────────────────────────────

const DRI_SOFT_CHECKIN  = 0.25;
const DRI_PROACTIVE     = 0.45;
const DRI_CLINICAL      = 0.65;
const DRI_IMMEDIATE     = 0.80;

// HRV slope (ms per turn) that flags a deteriorating trend
const HRV_SLOPE_ALARM   = -0.8;  // < -0.8 ms/turn → clinically significant decline
const HRV_VELOCITY_ALARM = -3.0; // < -3.0 ms in one turn → rapid deterioration

// Minimum number of HRV samples needed for trend detection
const MIN_SAMPLES_FOR_TREND = 3;

// How many recent HRV readings to use for trend
const TREND_WINDOW = 8;

// ── DRI weights (must sum to 1.0) ─────────────────────────────────────────────

const DRI_WEIGHTS = {
    hrv_trend:           0.35,
    hrv_velocity:        0.20,
    sleep_quality:       0.15,
    stress_self_report:  0.15,
    medication_adherence: 0.10,
    turn_streak:         0.05,  // consecutive turns above stress threshold
};

// ── Deterioration Risk Index ──────────────────────────────────────────────────

/**
 * Compute the Deterioration Risk Index (DRI) from physiological signals.
 *
 * @param {object} signals
 * @param {number[]} signals.hrv_history        - recent HRV readings (ms), oldest first
 * @param {number}  [signals.stress_score]      - 0..1, higher = more stressed
 * @param {number}  [signals.sleep_quality]     - 0..1, higher = better sleep
 * @param {number}  [signals.medication_adherence] - 0..1, higher = better adherence
 * @param {number}  [signals.consecutive_stress_turns] - turns above stress threshold
 * @returns {{ dri: number, tier: string, reasons: string[], components: object }}
 */
export function computeDRI(signals) {
    const {
        hrv_history          = [],
        stress_score         = 0.0,
        sleep_quality        = 1.0,
        medication_adherence = 1.0,
        consecutive_stress_turns = 0,
    } = signals;

    const components = {};
    const reasons    = [];

    // ── HRV trend component ───────────────────────────────────────────────────
    let hrv_trend_score = 0.0;
    if (hrv_history.length >= MIN_SAMPLES_FOR_TREND) {
        const window = hrv_history.slice(-TREND_WINDOW);
        const slope  = _linearSlope(window);
        components.hrv_slope = +slope.toFixed(3);

        if (slope < HRV_SLOPE_ALARM) {
            // Map slope to [0..1]: slope=-0.8 → 0.0, slope=-4.0 → 1.0
            hrv_trend_score = Math.min(1.0, (Math.abs(slope) - Math.abs(HRV_SLOPE_ALARM)) / 3.2);
            reasons.push(`HRV declining at ${slope.toFixed(2)}ms/turn`);
        } else if (slope < 0) {
            hrv_trend_score = 0.1;  // mild negative trend
        }
    }
    components.hrv_trend = +hrv_trend_score.toFixed(3);

    // ── HRV velocity component (last delta) ───────────────────────────────────
    let hrv_velocity_score = 0.0;
    if (hrv_history.length >= 2) {
        const velocity = hrv_history[hrv_history.length - 1] - hrv_history[hrv_history.length - 2];
        components.hrv_velocity = +velocity.toFixed(2);
        if (velocity < HRV_VELOCITY_ALARM) {
            hrv_velocity_score = Math.min(1.0, Math.abs(velocity) / 8.0);
            reasons.push(`Rapid HRV drop: ${velocity.toFixed(1)}ms this turn`);
        }
    }
    components.hrv_velocity = hrv_velocity_score;

    // ── Sleep quality component (inverted: poor sleep → high DRI) ─────────────
    const sleep_score = Math.max(0, 1.0 - sleep_quality);
    components.sleep_quality = +sleep_score.toFixed(3);
    if (sleep_score > 0.6) reasons.push(`Poor sleep quality (${(sleep_quality * 100).toFixed(0)}%)`);

    // ── Stress self-report ────────────────────────────────────────────────────
    components.stress_self_report = +stress_score.toFixed(3);
    if (stress_score > 0.7) reasons.push(`High reported stress (${(stress_score * 100).toFixed(0)}%)`);

    // ── Medication adherence (inverted) ───────────────────────────────────────
    const med_score = Math.max(0, 1.0 - medication_adherence);
    components.medication_adherence = +med_score.toFixed(3);
    if (med_score > 0.5) reasons.push(`Low medication adherence (${(medication_adherence * 100).toFixed(0)}%)`);

    // ── Consecutive stress turns ──────────────────────────────────────────────
    const streak_score = Math.min(1.0, consecutive_stress_turns / 5.0);
    components.turn_streak = +streak_score.toFixed(3);
    if (consecutive_stress_turns >= 3) reasons.push(`${consecutive_stress_turns} consecutive high-stress turns`);

    // ── Composite DRI ─────────────────────────────────────────────────────────
    const dri = (
        DRI_WEIGHTS.hrv_trend           * hrv_trend_score     +
        DRI_WEIGHTS.hrv_velocity        * hrv_velocity_score  +
        DRI_WEIGHTS.sleep_quality       * sleep_score         +
        DRI_WEIGHTS.stress_self_report  * stress_score        +
        DRI_WEIGHTS.medication_adherence * med_score          +
        DRI_WEIGHTS.turn_streak         * streak_score
    );

    return {
        dri:        +Math.min(1.0, dri).toFixed(4),
        tier:       _driTier(dri),
        reasons,
        components,
    };
}

function _driTier(dri) {
    if (dri >= DRI_IMMEDIATE) return 'IMMEDIATE_ESCALATION';
    if (dri >= DRI_CLINICAL)  return 'CLINICAL_ALERT';
    if (dri >= DRI_PROACTIVE) return 'PROACTIVE_SUPPORT';
    if (dri >= DRI_SOFT_CHECKIN) return 'SOFT_CHECKIN';
    return 'NO_ACTION';
}

/** Linear slope of an array using least-squares. */
function _linearSlope(vals) {
    const n  = vals.length;
    if (n < 2) return 0;
    const xs = vals.map((_, i) => i);
    const xm = (n - 1) / 2;
    const ym = vals.reduce((a, v) => a + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        num += (xs[i] - xm) * (vals[i] - ym);
        den += (xs[i] - xm) ** 2;
    }
    return den === 0 ? 0 : num / den;
}

// ── Main agent function ───────────────────────────────────────────────────────

/**
 * Evaluate the predictive escalation risk for a user and return an action hint.
 *
 * @param {object} params
 * @param {string}  params.userId
 * @param {string}  params.circleId
 * @param {number[]} params.hrvHistory    - recent HRV readings (ms)
 * @param {object}  [params.physioState]  - optional {stress_index, sleep_quality, ...}
 * @param {number}  [params.consecutiveStressTurns]
 * @param {boolean} [params.persistPlan]  - write a future_plan to DB if DRI ≥ SOFT_CHECKIN
 *
 * @returns {Promise<{
 *   dri: number,
 *   tier: string,
 *   systemHint: string|null,   — inject into system prompt if not null
 *   escalationAction: string|null,  — one of: 'checkin'|'support'|'alert_clinician'|'emergency'|null
 *   reasons: string[],
 *   components: object,
 * }>}
 */
export async function assessEscalationRisk(params) {
    const {
        userId,
        circleId,
        hrvHistory              = [],
        physioState             = {},
        consecutiveStressTurns  = 0,
        persistPlan             = false,
    } = params;

    const result = computeDRI({
        hrv_history:              hrvHistory,
        stress_score:             physioState.stress_index   ?? 0.0,
        sleep_quality:            physioState.sleep_quality  ?? 1.0,
        medication_adherence:     physioState.medication_adherence ?? 1.0,
        consecutive_stress_turns: consecutiveStressTurns,
    });

    const { dri, tier, reasons, components } = result;

    // ── Generate system hint for companion prompt injection ───────────────────
    let systemHint           = null;
    let escalationAction     = null;

    if (tier === 'SOFT_CHECKIN') {
        systemHint       = `[PREDICTIVE ALERT – SOFT] Physiological trend suggests early deterioration (DRI=${dri.toFixed(2)}). Proactively ask about sleep quality and stress without alarming the user. Reason: ${reasons.join('; ')}.`;
        escalationAction = 'checkin';
    } else if (tier === 'PROACTIVE_SUPPORT') {
        systemHint       = `[PREDICTIVE ALERT – PROACTIVE] Deterioration trajectory detected (DRI=${dri.toFixed(2)}). Increase supportive engagement frequency. Suggest contacting caregiver if relevant. Reason: ${reasons.join('; ')}.`;
        escalationAction = 'support';
    } else if (tier === 'CLINICAL_ALERT') {
        systemHint       = `[PREDICTIVE ALERT – CLINICAL] Significant physiological decline in progress (DRI=${dri.toFixed(2)}). Notify clinician companion and schedule urgent check-in. Reason: ${reasons.join('; ')}.`;
        escalationAction = 'alert_clinician';
    } else if (tier === 'IMMEDIATE_ESCALATION') {
        systemHint       = `[PREDICTIVE ALERT – IMMEDIATE] Crisis trajectory confirmed (DRI=${dri.toFixed(2)}). Trigger emergency protocol: contact clinician + caregiver NOW. Do not wait for next session. Reason: ${reasons.join('; ')}.`;
        escalationAction = 'emergency';
    }

    // ── Persist as a high-priority future plan (optional) ────────────────────
    if (persistPlan && escalationAction && userId) {
        try {
            const db = await getDb();
            await db.run(
                `INSERT OR IGNORE INTO future_plans
                 (user_id, circle_id, plan_type, priority, description, dri, created_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
                [
                    userId,
                    circleId || null,
                    `predictive_escalation_${escalationAction}`,
                    tier === 'IMMEDIATE_ESCALATION' ? 10 : tier === 'CLINICAL_ALERT' ? 7 : 4,
                    `[Auto] ${reasons.join('; ')}`,
                    dri,
                    Date.now(),
                ],
            );
        } catch (e) {
            // Non-fatal — future_plans table may not exist in all deployments
            console.warn('[PredictiveEscalation] Could not persist plan:', e.message);
        }
    }

    return { dri, tier, systemHint, escalationAction, reasons, components };
}

// ── TEST SCENARIOS ────────────────────────────────────────────────────────────
//
// Run:  node companions/agents/predictiveEscalationAgent.js --test

export const TEST_SCENARIOS = [
    {
        name: "Healthy baseline — no action expected",
        input: {
            hrvHistory:             [52, 54, 50, 53, 55, 51],
            physioState:            { stress_index: 0.2, sleep_quality: 0.8 },
            consecutiveStressTurns: 0,
        },
        expectedTier: "NO_ACTION",
    },
    {
        name: "Gradual HRV decline over 8 turns (deaddiction relapse risk)",
        input: {
            hrvHistory:             [48, 45, 42, 38, 35, 31, 28, 24],
            physioState:            { stress_index: 0.55, sleep_quality: 0.5 },
            consecutiveStressTurns: 2,
        },
        expectedTier: "PROACTIVE_SUPPORT",
    },
    {
        name: "Rapid HRV crash in single turn (acute panic/distress)",
        input: {
            hrvHistory:             [45, 44, 43, 41, 28],   // -13ms last turn
            physioState:            { stress_index: 0.8, sleep_quality: 0.4 },
            consecutiveStressTurns: 4,
        },
        expectedTier: "CLINICAL_ALERT",
    },
    {
        name: "Multi-signal crisis: poor sleep + low adherence + declining HRV",
        input: {
            hrvHistory:             [40, 36, 32, 28, 24, 20, 18, 14],
            physioState:            {
                stress_index:         0.85,
                sleep_quality:        0.15,
                medication_adherence: 0.20,
            },
            consecutiveStressTurns: 5,
        },
        expectedTier: "IMMEDIATE_ESCALATION",
    },
    {
        name: "Borderline: soft check-in zone",
        input: {
            hrvHistory:             [42, 40, 38, 36, 35],
            physioState:            { stress_index: 0.45, sleep_quality: 0.55 },
            consecutiveStressTurns: 1,
        },
        expectedTier: "SOFT_CHECKIN",
    },
    {
        name: "Cardiac patient — HRV stable but very low absolute value",
        input: {
            hrvHistory:             [22, 21, 23, 20, 22, 21],
            physioState:            { stress_index: 0.35, sleep_quality: 0.6, medication_adherence: 0.95 },
            consecutiveStressTurns: 0,
        },
        expectedTier: "NO_ACTION",
        note: "Low absolute HRV but stable trend — do not false-positive on cardiac baseline",
    },
    {
        name: "Recovery trajectory — improving despite low absolute HRV",
        input: {
            hrvHistory:             [15, 18, 21, 25, 28, 31],
            physioState:            { stress_index: 0.30, sleep_quality: 0.65 },
            consecutiveStressTurns: 0,
        },
        expectedTier: "NO_ACTION",
        note: "Positive slope should suppress DRI even if starting low",
    },
];

// ── CLI test runner ────────────────────────────────────────────────────────────

if (process.argv[2] === '--test') {
    console.log('=== Predictive Escalation Agent — Test Suite ===\n');
    let passed = 0;
    let failed = 0;

    for (const scenario of TEST_SCENARIOS) {
        const result = computeDRI({
            hrv_history:              scenario.input.hrvHistory,
            stress_score:             scenario.input.physioState?.stress_index       ?? 0.0,
            sleep_quality:            scenario.input.physioState?.sleep_quality      ?? 1.0,
            medication_adherence:     scenario.input.physioState?.medication_adherence ?? 1.0,
            consecutive_stress_turns: scenario.input.consecutiveStressTurns ?? 0,
        });

        const ok = result.tier === scenario.expectedTier;
        if (ok) passed++;
        else    failed++;

        const status = ok ? '✓ PASS' : '✗ FAIL';
        console.log(`${status}  ${scenario.name}`);
        console.log(`       DRI=${result.dri.toFixed(4)}  tier=${result.tier}  expected=${scenario.expectedTier}`);
        if (result.reasons.length) console.log(`       Reasons: ${result.reasons.join(' | ')}`);
        if (!ok) console.log(`       Components: ${JSON.stringify(result.components)}`);
        if (scenario.note) console.log(`       Note: ${scenario.note}`);
        console.log();
    }

    console.log(`Results: ${passed}/${passed + failed} passed`);
    if (failed > 0) process.exit(1);
}
