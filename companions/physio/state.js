/**
 * @fileoverview Physiological State for the HTN framework — pure JavaScript port.
 *
 * This is the authoritative runtime implementation used by the JS application.
 * The Python version in tensornets/ is used only for the MPS tensor operations
 * (PyTorch-dependent). All physiological computation runs here in Node/browser.
 *
 * Signal inventory (8 dimensions → chi_physio >= 8 in the MPS):
 *   1. HRV (RMSSD)             — acute ANS arousal / stress
 *   2. Blood glucose            — cognitive energy availability
 *   3. EDA                      — sympathetic activation intensity
 *   4. Circadian phase          — diurnal cortisol (derived from time_of_day_h)
 *   5. Location stress index    — environmental prior
 *   6. Sleep pressure           — cumulative sleep debt × circadian disruption
 *   7. Circadian entrainment    — how well-aligned subject is to their rhythm
 *   8. Respiratory rate         — fast-acting autonomic indicator
 *
 * Measuring sleep deficit without hardware
 * -----------------------------------------
 * Option A — self-report at session start (30 seconds):
 *   "How many hours did you sleep last night? And the 2 nights before?"
 * Option B — wearable API (Garmin Connect, Fitbit, Oura, Apple Health): pull via OAuth
 * Option C — proxy: default to 7h / 1h deficit (mild modern baseline) when unavailable
 *
 * References
 * ----------
 * - Shaffer & Ginsberg (2017). HRV metrics. Front. Public Health 5:258.
 * - ADA (2024). Standards of Medical Care in Diabetes. Diabetes Care 47(Suppl 1).
 * - Lim & Dinges (2010). Sleep deprivation and vigilant attention. Ann. NY Acad. Sci.
 * - Cretikos et al. (2008). Respiratory rate: the neglected vital sign. MJA 188(11).
 * - Touitou et al. (2017). Disruption of adolescents' circadian clock. J. Physiol. Paris.
 */

// ── Reference ranges ──────────────────────────────────────────────────────────

export const HRV = {
    MIN_MS:      5.0,
    MAX_MS:      120.0,
    BASELINE_MS: 35.0,
};

export const GLUCOSE = {
    HYPO:         3.9,
    NORMAL_LOW:   4.0,
    NORMAL_HIGH:  7.8,
    HYPER:        10.0,
};

export const EDA = {
    MIN_US: 0.01,
    MAX_US: 20.0,
};

export const SLEEP = {
    TARGET_H:          8.0,   // NSF adult recommendation
    MIN_H:             3.0,   // below this → severe impairment floor
    MAX_DEFICIT_H:     5.0,   // cap for normalization (3h sleep = max deficit)
};

export const RESP = {
    MIN_BPM:          8.0,
    MAX_BPM:          30.0,
    NORMAL_LOW_BPM:   12.0,
    NORMAL_HIGH_BPM:  20.0,
};

const CIRCADIAN_PEAK_HOUR = 8.0;  // cortisol peaks ~08:00

// ── Gamma (decay constant) bounds ────────────────────────────────────────────

const GAMMA_MIN = 0.05;   // stressed: half-life ~14 turns
const GAMMA_MAX = 0.5;    // calm: half-life ~1.4 turns
const ALPHA     = 1.0;    // HRV→gamma sensitivity exponent


// ── PhysiologicalState ───────────────────────────────────────────────────────

/**
 * Create a PhysiologicalState object from raw signal values.
 *
 * All optional new signals default to typical resting values so existing
 * call sites that only provide the original 5 signals keep working.
 *
 * @param {object} params
 * @param {number}  params.hrv_rmssd_ms           — RMSSD in ms (5–120)
 * @param {number}  params.blood_glucose_mmol      — mmol/L (2.9–30)
 * @param {number}  params.eda_us                  — µS (0.01–20)
 * @param {number}  params.time_of_day_h           — 0–24h local clock
 * @param {number}  params.location_stress_index   — 0–1 environmental prior
 * @param {number}  [params.sleep_hours_last_night=7]
 * @param {number}  [params.sleep_deficit_hours=1]
 * @param {number}  [params.circadian_entrainment=0.7]
 * @param {number}  [params.respiratory_rate_bpm=15]
 * @param {boolean} [params.is_simulated=true]
 * @param {string}  [params.subject_id]
 * @returns {PhysiologicalState}
 */
export function createPhysiologicalState({
    hrv_rmssd_ms,
    blood_glucose_mmol,
    eda_us,
    time_of_day_h,
    location_stress_index,
    sleep_hours_last_night  = 7.0,
    sleep_deficit_hours     = 1.0,
    circadian_entrainment   = 0.7,
    respiratory_rate_bpm    = 15.0,
    is_simulated            = true,
    subject_id              = null,
    timestamp               = Date.now(),
}) {
    // Validate
    if (hrv_rmssd_ms < HRV.MIN_MS || hrv_rmssd_ms > HRV.MAX_MS)
        throw new Error(`hrv_rmssd_ms=${hrv_rmssd_ms} outside [${HRV.MIN_MS}, ${HRV.MAX_MS}]`);
    if (blood_glucose_mmol < GLUCOSE.HYPO - 1 || blood_glucose_mmol > 30)
        throw new Error(`blood_glucose_mmol=${blood_glucose_mmol} outside plausible range`);
    if (eda_us < EDA.MIN_US || eda_us > EDA.MAX_US)
        throw new Error(`eda_us=${eda_us} outside [${EDA.MIN_US}, ${EDA.MAX_US}]`);
    if (time_of_day_h < 0 || time_of_day_h >= 24)
        throw new Error(`time_of_day_h=${time_of_day_h} must be in [0, 24)`);
    if (location_stress_index < 0 || location_stress_index > 1)
        throw new Error(`location_stress_index must be in [0, 1]`);
    if (sleep_hours_last_night < SLEEP.MIN_H || sleep_hours_last_night > 24)
        throw new Error(`sleep_hours_last_night=${sleep_hours_last_night} outside [${SLEEP.MIN_H}, 24]`);
    if (sleep_deficit_hours < 0 || sleep_deficit_hours > SLEEP.MAX_DEFICIT_H * 3)
        throw new Error(`sleep_deficit_hours must be in [0, ${SLEEP.MAX_DEFICIT_H * 3}]`);
    if (circadian_entrainment < 0 || circadian_entrainment > 1)
        throw new Error(`circadian_entrainment must be in [0, 1]`);
    if (respiratory_rate_bpm < RESP.MIN_BPM || respiratory_rate_bpm > RESP.MAX_BPM)
        throw new Error(`respiratory_rate_bpm=${respiratory_rate_bpm} outside [${RESP.MIN_BPM}, ${RESP.MAX_BPM}]`);

    const state = {
        hrv_rmssd_ms, blood_glucose_mmol, eda_us, time_of_day_h,
        location_stress_index, sleep_hours_last_night, sleep_deficit_hours,
        circadian_entrainment, respiratory_rate_bpm,
        is_simulated, subject_id, timestamp,
    };

    return state;
}

// ── Normalisation functions ───────────────────────────────────────────────────

/** HRV normalized to [0,1] where 1 = maximally calm (log-scale). */
export function hrv_normalized(state) {
    const logVal = Math.log(Math.max(state.hrv_rmssd_ms, HRV.MIN_MS));
    const logMin = Math.log(HRV.MIN_MS);
    const logMax = Math.log(HRV.MAX_MS);
    return (logVal - logMin) / (logMax - logMin);
}

/** Glucose normalized to [0,1] where 1 = optimal range (bell-shaped). */
export function glucose_normalized(state) {
    const mid   = (GLUCOSE.NORMAL_LOW + GLUCOSE.NORMAL_HIGH) / 2.0;
    const width = (GLUCOSE.NORMAL_HIGH - GLUCOSE.NORMAL_LOW) / 2.0;
    return Math.max(0.0, 1.0 - Math.abs(state.blood_glucose_mmol - mid) / (width * 2.0));
}

/** EDA normalized to [0,1] where 0 = calm, 1 = high sympathetic activation. */
export function eda_normalized(state) {
    return (state.eda_us - EDA.MIN_US) / (EDA.MAX_US - EDA.MIN_US);
}

/**
 * Circadian cortisol phase in [0,1] where 1 = cortisol peak (~08:00).
 * Models the diurnal curve as a cosine with 24h period.
 */
export function circadian_phase(state) {
    const phaseRad = 2 * Math.PI * (state.time_of_day_h - CIRCADIAN_PEAK_HOUR) / 24.0;
    return (1.0 + Math.cos(phaseRad)) / 2.0;
}

/**
 * Combined sleep-driven stress in [0,1].
 *
 * acute   = fraction of nightly target that was missed
 * chronic = fraction of 3-night deficit cap consumed
 * pressure = (0.6 × acute + 0.4 × chronic) × (2.0 − entrainment)
 *
 * The (2 − entrainment) multiplier: a shift worker with zero entrainment
 * has double the sleep pressure impact compared to a well-entrained person.
 */
export function sleep_pressure(state) {
    const acute   = Math.max(0, SLEEP.TARGET_H - state.sleep_hours_last_night) / SLEEP.TARGET_H;
    const chronic = Math.min(state.sleep_deficit_hours, SLEEP.MAX_DEFICIT_H) / SLEEP.MAX_DEFICIT_H;
    const raw     = 0.6 * acute + 0.4 * chronic;
    return Math.min(1.0, Math.max(0.0, raw * (2.0 - state.circadian_entrainment)));
}

/** Respiratory rate stress signal [0,1]: tachypnea = stressed, eupnea = 0. */
export function respiratory_normalized(state) {
    const rr = state.respiratory_rate_bpm;
    if (rr >= RESP.NORMAL_LOW_BPM && rr <= RESP.NORMAL_HIGH_BPM) return 0.0;
    if (rr > RESP.NORMAL_HIGH_BPM) {
        return Math.min(1.0, (rr - RESP.NORMAL_HIGH_BPM) / (RESP.MAX_BPM - RESP.NORMAL_HIGH_BPM));
    }
    return Math.max(0.0, 0.15 * (RESP.NORMAL_LOW_BPM - rr) / (RESP.NORMAL_LOW_BPM - RESP.MIN_BPM));
}

/**
 * Composite acute stress index in [0, 1].
 *
 * Weights (sum to 1.0):
 *   HRV (inv)      0.35  — primary ANS signal
 *   EDA            0.20  — sympathetic burst
 *   Sleep pressure 0.15  — fatigue + chronodisruption
 *   Glucose (inv)  0.12  — cognitive resource availability
 *   Circadian mod  0.08  — diurnal cortisol × entrainment
 *   Respiratory    0.05  — fast sympathetic readout
 *   Location       0.05  — environmental prior
 */
export function stress_index(state) {
    const circadianModulated = circadian_phase(state) * state.circadian_entrainment;
    return (
        0.35 * (1.0 - hrv_normalized(state))
      + 0.20 * eda_normalized(state)
      + 0.15 * sleep_pressure(state)
      + 0.12 * (1.0 - glucose_normalized(state))
      + 0.08 * circadianModulated
      + 0.05 * respiratory_normalized(state)
      + 0.05 * state.location_stress_index
    );
}

/**
 * 8-dimensional feature vector for encoding into the MPS physio subspace.
 * All values in [0, 1]. Order matches Python chi_physio index layout.
 *
 * [0] hrv_norm        [1] glucose_norm   [2] eda_norm
 * [3] circadian_phase [4] location       [5] sleep_pressure
 * [6] entrainment     [7] respiratory
 */
export function to_vector(state) {
    return [
        hrv_normalized(state),
        glucose_normalized(state),
        eda_normalized(state),
        circadian_phase(state),
        state.location_stress_index,
        sleep_pressure(state),
        state.circadian_entrainment,
        respiratory_normalized(state),
    ];
}

// ── Decay constant (gamma) ────────────────────────────────────────────────────

/**
 * Map RMSSD to autonomic decay constant γ (turns⁻¹).
 *
 * γ = γ_min + (γ_max − γ_min) × (RMSSD / baseline)^alpha
 *
 * Higher HRV (calm) → higher γ → faster stress recovery.
 * Lower HRV (stressed) → lower γ → stress persists for many turns.
 */
export function hrv_to_gamma(rmssd, baseline = HRV.BASELINE_MS, alpha = ALPHA) {
    const clamped = Math.max(HRV.MIN_MS, Math.min(rmssd, HRV.MAX_MS));
    const ratio   = Math.max(0, Math.min(clamped / Math.max(baseline, 1), 2.0));
    return GAMMA_MIN + (GAMMA_MAX - GAMMA_MIN) * Math.pow(ratio, alpha);
}

/**
 * Full gamma from state — incorporates EDA, sleep suppression, and location.
 *
 * Suppressors slow recovery:
 *   EDA:   up to 10% slower (sympathetic co-activation)
 *   Sleep: up to 20% slower (parasympathetic rebound impaired)
 *   Loc:   up to  5% slower (environmental stressor)
 */
export function gamma_from_state(state, baselineMs = null) {
    const baseline = baselineMs ?? HRV.BASELINE_MS;
    const gammaHrv = hrv_to_gamma(state.hrv_rmssd_ms, baseline);
    const edaSuppression   = 0.10 * eda_normalized(state);
    const sleepSuppression = 0.20 * sleep_pressure(state);
    const locSuppression   = 0.05 * state.location_stress_index;
    const adjusted = gammaHrv * (1.0 - edaSuppression - sleepSuppression - locSuppression);
    return Math.max(GAMMA_MIN, adjusted);
}

/** |λ₁| = e^{-γΔt}  — eigenvalue of physiological transfer matrix. */
export function gamma_to_lambda1(gamma, deltaT = 1.0) {
    return Math.exp(-gamma * deltaT);
}

/** Number of turns for stress amplitude to halve at this gamma. */
export function stress_half_life_turns(gamma, deltaT = 1.0) {
    const lambda1 = gamma_to_lambda1(gamma, deltaT);
    if (lambda1 >= 1.0 - 1e-9) return Infinity;
    return Math.log(2) / (-Math.log(lambda1));
}

/** Remaining stress amplitude after n turns: A(n) = A₀ × |λ₁|^n */
export function decay_amplitude(initial, gamma, nTurns, deltaT = 1.0) {
    return initial * Math.exp(-gamma * deltaT * nTurns);
}

// ── PhysiologicalHistory ──────────────────────────────────────────────────────

export class PhysiologicalHistory {
    constructor(subjectId) {
        this.subjectId = subjectId;
        this.states    = [];
    }

    append(state) {
        if (this.states.length && state.timestamp <= this.states.at(-1).timestamp) {
            throw new Error('States must be appended in chronological order.');
        }
        this.states.push(state);
    }

    stressTrajectory()       { return this.states.map(s => stress_index(s)); }
    hrvTrajectory()          { return this.states.map(s => s.hrv_rmssd_ms); }
    sleepPressureTrajectory(){ return this.states.map(s => sleep_pressure(s)); }
    gammaTrajectory()        { return this.states.map(s => gamma_from_state(s)); }
    vectorTrajectory()       { return this.states.map(s => to_vector(s)); }

    durationSeconds() {
        if (this.states.length < 2) return 0;
        return (this.states.at(-1).timestamp - this.states[0].timestamp) / 1000;
    }

    /** Estimate subject's resting HRV baseline (calm-quarter median). */
    estimateBaseline() {
        if (this.states.length < 4) return HRV.BASELINE_MS;
        const sorted = [...this.states.map(s => s.hrv_rmssd_ms)].sort((a, b) => a - b);
        const calmStart = Math.floor(sorted.length * 3 / 4);
        const calm = sorted.slice(calmStart);
        return calm[Math.floor(calm.length / 2)];
    }

    get length() { return this.states.length; }

    /**
     * Compute rolling 3-night sleep deficit from an array of nightly hours.
     * @param {number[]} nights  — e.g. [6.0, 5.5, 7.0]
     * @param {number}   target  — default 8h
     */
    static computeSleepDeficit(nights, target = SLEEP.TARGET_H) {
        const recent = nights.slice(-3);
        const deficit = recent.reduce((sum, h) => sum + Math.max(0, target - h), 0);
        return Math.min(deficit, SLEEP.MAX_DEFICIT_H * 3);
    }
}

// ── Stress level labels (for UI and LLM prompts) ─────────────────────────────

/**
 * Convert a numeric stress_index to a human-readable label.
 * Used to inject physio context into companion prompts without
 * exposing raw numbers.
 *
 * @param {number} idx  — stress_index() result in [0, 1]
 * @returns {{ label: string, emoji: string, promptHint: string }}
 */
export function stressLabel(idx) {
    if (idx < 0.25) return {
        label: 'calm',
        emoji: '[calm]',
        promptHint: 'The patient appears calm and receptive. Standard conversational tone is appropriate.',
    };
    if (idx < 0.45) return {
        label: 'mild_stress',
        emoji: '[mild stress]',
        promptHint: 'Mild stress detected. Use empathetic phrasing; avoid delivering multiple pieces of information at once.',
    };
    if (idx < 0.65) return {
        label: 'moderate_stress',
        emoji: '[moderate stress]',
        promptHint: 'Moderate stress. Prioritise emotional acknowledgement before any clinical or financial information. Keep sentences short.',
    };
    if (idx < 0.80) return {
        label: 'high_stress',
        emoji: '[HIGH STRESS]',
        promptHint: 'High physiological stress. Do NOT introduce new clinical decisions, billing disputes, or out-of-pocket costs. Focus on stabilisation.',
    };
    return {
        label: 'critical_stress',
        emoji: '[CRITICAL]',
        promptHint: 'Critical stress level. Immediate de-escalation required. Consider escalation to a human clinician. No new information.',
    };
}
