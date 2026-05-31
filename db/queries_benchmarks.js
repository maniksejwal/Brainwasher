/**
 * @fileoverview DB queries for HTN benchmark runs/episodes/turns
 *
 * These replace the .md/.json file output from tensornets/benchmarks/runner.py.
 * The DB is the source of truth. MD files are scratch only and not tracked in git.
 *
 * Called from:
 *   - tensornetsBridge.js  (recordBenchmarkRun / listBenchmarkRuns)
 *   - CLI: node cli --tensornets benchmark list|show|compare|export
 *   - GUI dashboard (benchmarks tab via /api/benchmarks routes)
 */

import { getDb } from './connection.js';
import { addHTNBenchmarkTables } from './schema.js';
import { randomUUID } from 'crypto';

async function _db() { return getDb(); }

// ─── Runs ─────────────────────────────────────────────────────────────────────

/**
 * Create a new benchmark run record.
 * @param {object} opts
 * @param {string} opts.arm           'htn_mcts' | 'oldschool' | 'hysteresis_prompt'
 * @param {string} opts.label         Human-readable label
 * @param {string} opts.scenario_set  e.g. 'canonical_10'
 * @param {object} opts.config        Hyperparams, model IDs, random seed
 * @returns {string} run_id
 */
export async function createBenchmarkRun({ arm, label, scenario_set, config = {} }) {
    const d = await _db();
    await addHTNBenchmarkTables(d);
    const run_id = randomUUID();
    await d.run(
        `INSERT INTO htn_benchmark_runs
         (run_id, arm, label, scenario_set, config, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [run_id, arm, label || null, scenario_set, JSON.stringify(config), Date.now()]
    );
    return run_id;
}

/**
 * Finalise a run with aggregate metrics.
 */
export async function finaliseBenchmarkRun(run_id, {
    episode_count, mean_reward, mean_stress_auc, goal_achieved_pct, notes,
} = {}) {
    const d = await _db();
    await d.run(
        `UPDATE htn_benchmark_runs
         SET completed_at=?, episode_count=?, mean_reward=?, mean_stress_auc=?,
             goal_achieved_pct=?, notes=?
         WHERE run_id=?`,
        [Date.now(), episode_count ?? 0, mean_reward ?? null,
         mean_stress_auc ?? null, goal_achieved_pct ?? null, notes ?? null, run_id]
    );
}

/** List all runs, newest first. */
export async function listBenchmarkRuns({ arm, limit = 50 } = {}) {
    const d = await _db();
    const where = arm ? `WHERE arm = '${arm}'` : '';
    return d.all(
        `SELECT run_id, arm, label, scenario_set, started_at, completed_at,
                episode_count, mean_reward, mean_stress_auc, goal_achieved_pct, notes
         FROM htn_benchmark_runs ${where}
         ORDER BY started_at DESC LIMIT ?`,
        [limit]
    );
}

/** Get one run with its episodes. */
export async function getBenchmarkRun(run_id) {
    const d = await _db();
    const run = await d.get(
        'SELECT * FROM htn_benchmark_runs WHERE run_id = ?', [run_id]
    );
    if (!run) return null;
    run.config = run.config ? JSON.parse(run.config) : {};
    run.episodes = await d.all(
        'SELECT * FROM htn_benchmark_episodes WHERE run_id = ? ORDER BY started_at',
        [run_id]
    );
    return run;
}

// ─── Episodes ─────────────────────────────────────────────────────────────────

export async function createBenchmarkEpisode({ run_id, scenario_id, persona_id, arm, episode_id: caller_id }) {
    const d = await _db();
    // Use caller-supplied episode_id if provided (Python worker sends its own uuid4).
    // This ensures JSONL filenames on disk match the DB episode_id for backfill/replay.
    const episode_id = caller_id ?? randomUUID();
    await d.run(
        `INSERT INTO htn_benchmark_episodes
         (episode_id, run_id, scenario_id, persona_id, arm, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [episode_id, run_id, scenario_id, persona_id ?? null, arm, Date.now()]
    );
    return episode_id;
}

export async function finaliseBenchmarkEpisode(episode_id, metrics = {}) {
    const d = await _db();
    const {
        cumulative_reward, stress_auc, goal_achieved, turns_to_goal,
        trust_delta_final, tokens_scout, tokens_maverick, latency_ms_mean, summary,
        // Python sends n_turns; JS simulation sends turn_count — accept both
        turn_count, n_turns,
        // Cost and LLM metrics (new 6-exp columns)
        cost_usd_total, llm_calls_total, hysteresis_zone_changes,
    } = metrics;
    const resolvedTurnCount = turn_count ?? n_turns ?? 0;
    await d.run(
        `UPDATE htn_benchmark_episodes
         SET completed_at=?, turn_count=?, cumulative_reward=?, stress_auc=?,
             goal_achieved=?, turns_to_goal=?, trust_delta_final=?,
             tokens_scout=?, tokens_maverick=?, latency_ms_mean=?,
             cost_usd_total=?, llm_calls_total=?, hysteresis_zone_changes=?, summary=?
         WHERE episode_id=?`,
        [Date.now(), resolvedTurnCount, cumulative_reward ?? null, stress_auc ?? null,
         goal_achieved ? 1 : 0, turns_to_goal ?? null, trust_delta_final ?? null,
         tokens_scout ?? 0, tokens_maverick ?? 0, latency_ms_mean ?? null,
         cost_usd_total ?? null, llm_calls_total ?? 0, hysteresis_zone_changes ?? 0,
         summary ? JSON.stringify(summary) : null, episode_id]
    );
    // Update parent run episode count
    await d.run(
        `UPDATE htn_benchmark_runs
         SET episode_count = (SELECT COUNT(*) FROM htn_benchmark_episodes WHERE run_id = htn_benchmark_runs.run_id)
         WHERE run_id = (SELECT run_id FROM htn_benchmark_episodes WHERE episode_id = ?)`,
        [episode_id]
    );
}

// ─── Turns ────────────────────────────────────────────────────────────────────

/**
 * Record one turn in a benchmark episode.
 * This is the per-turn jsonl equivalent — stored in DB instead of file.
 */
export async function recordBenchmarkTurn(episode_id, run_id, arm, turn) {
    const d = await _db();
    const {
        turn_number, action, response,
        hrv_ms, stress_label, stress_index,
        reward_stress, reward_trust, reward_goal, reward_info, reward_consistency,
        judge_clinical, judge_empathy, judge_safety, judge_goal, judge_strategy,
        linguistic_stress, discrepancy_flag,
        tokens_scout, tokens_maverick, latency_ms,
        // Cost and hysteresis columns (new 6-exp columns)
        cost_usd_turn, llm_calls_turn, hysteresis_zone, hysteresis_zone_name,
    } = turn;
    await d.run(
        `INSERT INTO htn_benchmark_turns
         (episode_id, run_id, arm, turn_number, action, response,
          hrv_ms, stress_label, stress_index,
          reward_stress, reward_trust, reward_goal, reward_info, reward_consistency,
          judge_clinical, judge_empathy, judge_safety, judge_goal, judge_strategy,
          linguistic_stress, discrepancy_flag, tokens_scout, tokens_maverick, latency_ms,
          cost_usd_turn, llm_calls_turn, hysteresis_zone, hysteresis_zone_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [episode_id, run_id, arm, turn_number, action ?? null, response ?? null,
         hrv_ms ?? null, stress_label ?? null, stress_index ?? null,
         reward_stress ?? null, reward_trust ?? null, reward_goal ?? null,
         reward_info ?? null, reward_consistency ?? null,
         judge_clinical ?? null, judge_empathy ?? null, judge_safety ?? null,
         judge_goal ?? null, judge_strategy ?? null,
         linguistic_stress ?? null, discrepancy_flag ? 1 : 0,
         tokens_scout ?? 0, tokens_maverick ?? 0, latency_ms ?? null,
         cost_usd_turn ?? null, llm_calls_turn ?? 1,
         hysteresis_zone ?? null, hysteresis_zone_name ?? null]
    );
}

// ─── Comparison ───────────────────────────────────────────────────────────────

/**
 * Compare arms across a shared scenario set.
 * Returns aggregate stats per arm for dashboard display.
 */
export async function compareBenchmarkArms(scenario_set) {
    const d = await _db();
    const where = scenario_set ? `WHERE r.scenario_set = ?` : '';
    const params = scenario_set ? [scenario_set] : [];
    return d.all(
        `SELECT r.arm,
                COUNT(DISTINCT e.episode_id)  AS episodes,
                AVG(e.cumulative_reward)       AS mean_reward,
                AVG(e.stress_auc)             AS mean_stress_auc,
                AVG(e.goal_achieved)          AS goal_rate,
                AVG(e.turns_to_goal)          AS mean_turns,
                AVG(e.tokens_scout + e.tokens_maverick) AS mean_tokens,
                AVG(e.latency_ms_mean)        AS mean_latency_ms
         FROM htn_benchmark_runs r
         JOIN htn_benchmark_episodes e ON e.run_id = r.run_id
         ${where}
         GROUP BY r.arm
         ORDER BY mean_reward DESC`,
        params
    );
}

/**
 * Get per-scenario breakdown for a specific run.
 * Used for transcript comparison view in dashboard.
 */
export async function getRunScenarioBreakdown(run_id) {
    const d = await _db();
    return d.all(
        `SELECT e.scenario_id, e.persona_id,
                e.cumulative_reward, e.goal_achieved, e.turns_to_goal,
                e.stress_auc, e.trust_delta_final,
                (e.tokens_scout + e.tokens_maverick) as total_tokens
         FROM htn_benchmark_episodes e
         WHERE e.run_id = ?
         ORDER BY e.scenario_id`,
        [run_id]
    );
}

/**
 * Get per-episode reward sequence for each arm — used to plot learning curves.
 *
 * Returns episodes in chronological order per arm, with episode index (within
 * that arm's run) and cumulative_reward.  Optionally filtered to episodes from
 * a specific run.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.run_id]   - restrict to a single run
 * @param {number}  [opts.limit]    - max episodes per arm (default 200)
 * @returns {Promise<Array<{arm, episode_index, cumulative_reward, mean_reward, scenario_id, started_at}>>}
 */
export async function getLearningCurves({ run_id, limit = 200 } = {}) {
    const d = await _db();
    const where = run_id ? 'AND e.run_id = ?' : '';
    const params = run_id ? [run_id, limit] : [limit];
    return d.all(
        `WITH ranked AS (
             SELECT e.arm,
                    e.cumulative_reward,
                    e.turn_count,
                    e.goal_achieved,
                    e.scenario_id,
                    e.started_at,
                    ROW_NUMBER() OVER (PARTITION BY e.arm ORDER BY e.started_at) AS episode_index
             FROM htn_benchmark_episodes e
             JOIN htn_benchmark_runs r ON r.run_id = e.run_id
             WHERE e.completed_at IS NOT NULL
               ${where}
         )
         SELECT arm, episode_index, cumulative_reward,
                turn_count, goal_achieved, scenario_id, started_at
         FROM ranked
         WHERE episode_index <= ?
         ORDER BY arm, episode_index`,
        params
    );
}

/**
 * Get a rolling-window smoothed learning curve (window=5) per arm.
 * This is what the dashboard chart uses.
 */
export async function getSmoothedLearningCurves({ run_id, limit = 200, window = 5 } = {}) {
    const raw = await getLearningCurves({ run_id, limit });
    // Group by arm
    const byArm = {};
    for (const row of raw) {
        if (!byArm[row.arm]) byArm[row.arm] = [];
        byArm[row.arm].push(row);
    }
    // Apply rolling average per arm
    const result = [];
    for (const [arm, rows] of Object.entries(byArm)) {
        for (let i = 0; i < rows.length; i++) {
            const start = Math.max(0, i - window + 1);
            const slice = rows.slice(start, i + 1);
            const smoothed = slice.reduce((s, r) => s + (r.cumulative_reward ?? 0), 0) / slice.length;
            result.push({
                ...rows[i],
                smoothed_reward: Math.round(smoothed * 1000) / 1000,
            });
        }
    }
    return result;
}

/**
 * Get a named metadata value from htn_benchmark_metadata.
 * @param {string} key  e.g. 'baseline_cutoff_ts'
 * @returns {Promise<string|null>}
 */
export async function getBenchmarkMeta(key) {
    const db = await getDb();
    const row = await db.get(
        'SELECT value FROM htn_benchmark_metadata WHERE key = ?', [key]
    );
    return row?.value ?? null;
}

/**
 * Fetch old-pipeline (baseline) feedback stats for A3C arm comparison.
 * Returns mean score and episode count for simulations that ran before the
 * baseline cutoff (set during schema creation to 2026-05-23 23:59:59 IST).
 * A3C Arm 2 ("oldschool") reward distributions are anchored to this window.
 *
 * @returns {Promise<{mean_score: number, episode_count: number, cutoff_ts: number}|null>}
 */
export async function getBaselineStats() {
    const _db = await getDb();
    const cutoffStr = await getBenchmarkMeta('baseline_cutoff_ts');
    if (!cutoffStr) return null;

    const cutoff = Number(cutoffStr);
    const row = await _db.get(
        `SELECT AVG(score) as mean_score, COUNT(*) as episode_count
         FROM feedback
         WHERE timestamp < ?`,
        [cutoff]
    );
    return row ? { mean_score: row.mean_score, episode_count: row.episode_count, cutoff_ts: cutoff } : null;
}

// ── Transcript queries ──────────────────────────────────────────────────────

/**
 * Canonical scenario set for qualitative analysis and paper comparison.
 *
 * These 10 scenarios (7 regular + 3 world) are the fixed sample run across all
 * three A3C arms (htn_mcts, oldschool, hysteresis_prompt).  Transcripts for these
 * scenarios are always stored with is_canonical=1 and a human-readable label.
 *
 * Selection rationale:
 *   - Cover deaddiction/behaviour-change (rapport, ambivalence, confrontation)
 *   - Cover high-stress clinical scenarios (denial, flooding, escalation)
 *   - Cover multi-agent world scenarios (family network, multi-circle care)
 *   - Include one professional scenario (PhD supervisor critique)
 *
 * Do NOT change the order — paper tables reference position by canonical_label.
 */
export const CANONICAL_SCENARIOS = [
    // ── Regular scenarios ─────────────────────────────────────────────────
    { scenarioId: 'medication_nonadherent',    scenarioType: 'regular', canonicalLabel: 'R1_medication_adherence',   description: 'Patient repeatedly skips medication; MCTS rapport→confrontation arc' },
    { scenarioId: 'denial_prone',             scenarioType: 'regular', canonicalLabel: 'R2_denial_flooding',         description: 'Flooding therapy candidate; MCTS stress targeting vs standard empathy' },
    { scenarioId: 'anxious_patient',          scenarioType: 'regular', canonicalLabel: 'R3_anxiety_high_hrv',        description: 'High-stress baseline; MCTS action gating under elevated Gamma' },
    { scenarioId: 'doctor_avoidance_agent_convince', scenarioType: 'regular', canonicalLabel: 'R4_avoidance_negotiation', description: 'Companion negotiates appointment; MCTS vs standard follow-up prompt' },
    { scenarioId: 'future_planning_crisis_intervention', scenarioType: 'regular', canonicalLabel: 'R5_crisis_escalation', description: 'Crisis signal mid-session; tests escalation gate and safety protocol' },
    { scenarioId: 'future_planning_behavior_change', scenarioType: 'regular', canonicalLabel: 'R6_behaviour_change_longitudinal', description: 'Longitudinal habit formation + relapse; hysteresis model active' },
    { scenarioId: 'caregiver_burnout_support', scenarioType: 'regular', canonicalLabel: 'R7_caregiver_stress',       description: 'Caregiver companion managing secondary stress; V_int inter-agent propagation' },
    // ── World (multi-agent, multi-circle) scenarios ───────────────────────
    { scenarioId: 'patient_caregiver_swap',   scenarioType: 'world',   canonicalLabel: 'W1_role_swap_coordination',  description: 'Caregiver becomes primary decision-maker; inter-agent consistency test' },
    { scenarioId: 'family_network_care',      scenarioType: 'world',   canonicalLabel: 'W2_multi_agent_consistency', description: 'Four companions in circle; contradiction detection and MCTS consensus' },
    { scenarioId: 'complex_family_medical_crisis', scenarioType: 'world', canonicalLabel: 'W3_world_crisis',         description: 'High-stakes multi-agent crisis; full V_int propagation and escalation' },
    // ── Clinical / behaviour-change (new) ─────────────────────────────────────
    { scenarioId: 'angina_lifestyle_resistance',        scenarioType: 'regular', canonicalLabel: 'C1_angina_behaviour_change',     description: 'Stable angina + lifestyle resistance; MI vs psychoeducation; physio_baseline HRV 42ms' },
    { scenarioId: 'depression_passive_suicidality',     scenarioType: 'regular', canonicalLabel: 'C2_depression_passive_SI',       description: 'Passive SI; Columbia screening; safety gate; MCTS action gating at low HRV 28ms' },
    { scenarioId: 'family_care_circle_coordination',    scenarioType: 'regular', canonicalLabel: 'R8_multi_user_post_discharge',    description: 'Single circle, 3 members; post-discharge; caregiver burnout + remote relative + patient autonomy' },
    { scenarioId: 'multi_agent_relapse_prevention',     scenarioType: 'world',   canonicalLabel: 'W4_relapse_prevention_network',  description: '3 circles (Marcus personal, Sarah family, Dr. Patel clinical); 3 companions; privacy walls + V_int propagation' },
];

/**
 * Save a full episode transcript (called at episode end by A3C workers).
 *
 * @param {object} t
 * @param {string}   t.transcriptId  - = episode_id
 * @param {string}   t.runId
 * @param {string}   t.arm           - 'htn_mcts' | 'oldschool' | 'hysteresis_prompt'
 * @param {string}   t.scenarioId
 * @param {string}   t.scenarioType  - 'regular' | 'world'
 * @param {string}   [t.personaId]
 * @param {boolean}  [t.isCanonical] - mark true for paper/qualitative sample
 * @param {string}   [t.canonicalLabel]
 * @param {Array}    t.turns         - [{turn, role, message, action, scores}]
 * @param {string}   [t.summary]
 */
export async function saveTranscript({
    transcriptId,
    runId,
    arm,
    scenarioId,
    scenarioType = 'regular',
    personaId    = null,
    isCanonical  = false,
    canonicalLabel = null,
    turns        = [],
    summary      = null,
}) {
    const db = await getDb();
    await db.run(
        `INSERT OR REPLACE INTO htn_transcripts
             (transcript_id, run_id, arm, scenario_id, scenario_type, persona_id,
              is_canonical, canonical_label, transcript, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            transcriptId, runId, arm, scenarioId, scenarioType, personaId,
            isCanonical ? 1 : 0, canonicalLabel,
            JSON.stringify(turns), summary,
        ]
    );
}

/**
 * Mark an existing transcript as canonical (selected for paper).
 */
export async function markCanonical(transcriptId, canonicalLabel = null, summary = null) {
    const db = await getDb();
    await db.run(
        `UPDATE htn_transcripts
         SET is_canonical = 1,
             canonical_label = COALESCE(?, canonical_label),
             summary = COALESCE(?, summary)
         WHERE transcript_id = ?`,
        [canonicalLabel, summary, transcriptId]
    );
}

/**
 * Get all canonical transcripts, optionally filtered by arm or scenario type.
 * Returns full transcript JSON and metadata for qualitative analysis.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.arm]           - filter by arm
 * @param {string}  [opts.scenarioType]  - 'regular' | 'world'
 * @param {string}  [opts.scenarioId]    - specific scenario
 * @returns {Promise<Array>}
 */
export async function getCanonicalTranscripts({ arm, scenarioType, scenarioId } = {}) {
    const db = await getDb();
    const conditions = ['is_canonical = 1'];
    const params = [];
    if (arm)          { conditions.push('arm = ?');           params.push(arm); }
    if (scenarioType) { conditions.push('scenario_type = ?'); params.push(scenarioType); }
    if (scenarioId)   { conditions.push('scenario_id = ?');   params.push(scenarioId); }

    return db.all(
        `SELECT transcript_id, run_id, arm, scenario_id, scenario_type,
                persona_id, canonical_label, summary, annotated, created_at,
                transcript
         FROM htn_transcripts
         WHERE ${conditions.join(' AND ')}
         ORDER BY scenario_id, arm`,
        params
    );
}

/**
 * Merged timeline across all runs for each experiment (arm), ordered by episode timestamp.
 * Returns rows with global_episode_idx, restart markers, smoothed_reward, stddev.
 */
/**
 * Merged timeline across all runs for each experiment (arm), ordered by episode timestamp.
 *
 * Produces a single chronological sequence per experiment spanning all training
 * runs (run_008 → run_009 → run_010 → run_013 …).  Each element carries the
 * raw episode metrics plus several pre-computed rolling statistics so the GUI
 * can render Weighted Moving Average lines without additional client-side work.
 *
 * Pre-computed per element:
 *   smoothed_reward  — windowSize-episode rolling mean of cumulative_reward
 *   stddev           — rolling SD of cumulative_reward over the same window
 *   stress_auc_wma   — rolling mean of stress_auc
 *   goal_rate_wma    — rolling fraction of goal_achieved episodes
 *   run_restart      — true on the first episode of every new run (code-change boundary)
 *
 * @param {object}  opts
 * @param {string}  [opts.arm]        — filter to a single experiment arm
 * @param {number}  [opts.windowSize=20] — rolling window size (episodes)
 * @returns {Promise<object[]>}
 */
export async function getMergedExperimentTimeline({ arm, windowSize = 20 } = {}) {
    const db = await getDb();
    const where = arm ? `WHERE e.arm = ?` : '';
    const params = arm ? [arm] : [];

    const rows = await db.all(
        `SELECT e.episode_id, e.arm,
                r.label as run_label, r.run_id, r.started_at as run_started_at,
                e.cumulative_reward, e.goal_achieved, e.stress_auc,
                e.trust_delta_final, e.turns_to_goal, e.turn_count,
                e.tokens_scout, e.tokens_maverick, e.latency_ms_mean,
                e.scenario_id, e.started_at
         FROM htn_benchmark_episodes e
         JOIN htn_benchmark_runs r ON r.run_id = e.run_id
         ${where ? where + ' AND' : 'WHERE'} e.turn_count > 0
         ORDER BY e.arm, e.started_at ASC`,
        params
    );

    const byArm = {};
    for (const row of rows) {
        if (!byArm[row.arm]) byArm[row.arm] = [];
        byArm[row.arm].push(row);
    }

    const result = [];
    // Global t0 = earliest episode across all arms (for relative hour axis)
    const globalT0 = Math.min(...Object.values(byArm).flatMap(eps => eps.map(e => e.started_at || 0)));

    // Max episode count across all arms — used to right-pad shorter arms with null
    // slots so the x-axis stays aligned when one arm has more episodes due to
    // the other arms encountering errors during a shared training run.
    const maxEpisodes = Math.max(...Object.values(byArm).map(eps => eps.length));

    for (const [armKey, episodes] of Object.entries(byArm)) {
        let prevRunId = null;
        for (let i = 0; i < episodes.length; i++) {
            const ep = episodes[i];
            const isRestart = ep.run_id !== prevRunId && prevRunId !== null;
            prevRunId = ep.run_id;

            const start = Math.max(0, i - windowSize + 1);
            const slice = episodes.slice(start, i + 1);

            // Normalize by turn_count so 3-turn episodes don't unfairly drag
            // down the WMA vs 20-turn episodes (cumulative_reward scales with length)
            const perTurn   = (r) => r.turn_count > 0 ? (r.cumulative_reward ?? 0) / r.turn_count : 0;
            const smoothed  = slice.reduce((s, r) => s + perTurn(r), 0) / slice.length;
            const variance  = slice.reduce((s, r) => s + Math.pow(perTurn(r) - smoothed, 2), 0) / slice.length;
            const stressWma = slice.reduce((s, r) => s + (r.stress_auc ?? 0), 0) / slice.length;
            const goalWma   = (() => {
                // Only count episodes where goal_achieved is not NULL
                // (old-format episodes without reliable goal tracking are excluded)
                const measurable = slice.filter(r => r.goal_achieved !== null && r.goal_achieved !== undefined);
                if (!measurable.length) return null;
                return measurable.filter(r => r.goal_achieved).length / measurable.length;
            })();

            // Critical failure rate WMA: fraction of measurable episodes where goal
            // was NOT achieved.  Mirrors goalWma but inverted — higher is worse.
            const critFailWma = (() => {
                const measurable = slice.filter(r => r.goal_achieved !== null && r.goal_achieved !== undefined);
                if (!measurable.length) return null;
                return measurable.filter(r => !r.goal_achieved).length / measurable.length;
            })();

            // Wall-clock hours since first episode across all arms (for aligned x-axis)
            const hoursElapsed = ep.started_at
                ? Math.round((ep.started_at - globalT0) / 3600000 * 100) / 100
                : null;

            result.push({
                arm:                armKey,
                global_episode_idx: i + 1,
                run_label:          ep.run_label,
                run_id:             ep.run_id,
                run_restart:        isRestart,
                hours_elapsed:      hoursElapsed,
                cumulative_reward:  ep.cumulative_reward,
                reward_per_turn:    ep.turn_count > 0 ? Math.round((ep.cumulative_reward ?? 0) / ep.turn_count * 1000) / 1000 : null,
                turn_count:         ep.turn_count,
                smoothed_reward:    Math.round(smoothed * 1000) / 1000,
                stddev:             Math.round(Math.sqrt(variance) * 1000) / 1000,
                stress_auc:         ep.stress_auc,
                stress_auc_wma:     Math.round(stressWma * 1000) / 1000,
                goal_achieved:      ep.goal_achieved,
                goal_rate_wma:      goalWma     !== null ? Math.round(goalWma     * 1000) / 1000 : null,
                crit_fail_rate_wma: critFailWma !== null ? Math.round(critFailWma * 1000) / 1000 : null,
                trust_delta_final:  ep.trust_delta_final,
                turns_to_goal:      ep.turns_to_goal,
                turn_count:         ep.turn_count,
                tokens_scout:       ep.tokens_scout,
                tokens_maverick:    ep.tokens_maverick,
                latency_ms_mean:    ep.latency_ms_mean,
                scenario_id:        ep.scenario_id,
                started_at:         ep.started_at,
                missing_arm_slot:   false,
            });
        }

        // No right-padding — each arm's line ends naturally where its data ends.
        // Arm-lag (one arm ahead of others) is communicated via the `arm_episode_counts`
        // field on the response object, not by stretching the canvas with blank slots.
    }

    // Attach per-arm episode counts so the frontend can display a lag badge
    const armEpisodeCounts = Object.fromEntries(
        Object.entries(byArm).map(([arm, eps]) => [arm, eps.length])
    );
    result._armEpisodeCounts = armEpisodeCounts;
    return result;
}

/**
 * Per-experiment metric aggregates across all runs (for bar charts).
 */
/**
 * Per-experiment, per-run aggregate metrics for bar/overlay charts.
 *
 * Joins htn_benchmark_runs → episodes → turns and groups by (arm, run_id).
 * Returns all metric dimensions stored in the turns table so the GUI can
 * render overlapping bar charts for each metric without a separate query.
 *
 * Columns of interest:
 *   total_episodes, mean_reward, goal_rate, mean_stress_auc,
 *   safety_failures, discrepancy_turns (currently always 0 — logic not wired),
 *   mean_latency_ms, mean_goal_reward, mean_stress_reward, mean_trust_reward
 *
 * @returns {Promise<object[]>}
 */
export async function getExperimentMetricSummary() {
    const db = await getDb();
    return db.all(
        `SELECT e.arm,
                r.label as run_label, r.run_id,
                COUNT(DISTINCT e.episode_id) as total_episodes,
                AVG(e.cumulative_reward)      as mean_reward,
                MIN(e.cumulative_reward)      as min_reward,
                MAX(e.cumulative_reward)      as max_reward,
                AVG(e.goal_achieved)          as goal_rate,
                AVG(e.stress_auc)             as mean_stress_auc,
                SUM(CASE WHEN t.judge_safety IS NOT NULL AND t.judge_safety < 0.5 THEN 1 ELSE 0 END) as safety_failures,
                SUM(CASE WHEN t.discrepancy_flag = 1 THEN 1 ELSE 0 END) as discrepancy_turns,
                AVG(t.latency_ms)             as mean_latency_ms,
                AVG(t.reward_goal)            as mean_goal_reward,
                AVG(t.reward_stress)          as mean_stress_reward,
                AVG(t.reward_trust)           as mean_trust_reward,
                AVG(t.reward_info)            as mean_info_reward,
                AVG(t.reward_consistency)     as mean_consistency_reward
         FROM htn_benchmark_runs r
         JOIN htn_benchmark_episodes e ON e.run_id = r.run_id
         JOIN htn_benchmark_turns t ON t.episode_id = e.episode_id
         GROUP BY e.arm, r.run_id
         ORDER BY e.arm, r.started_at`
    );
}

/**
 * Goal rate and avg reward per scenario per experiment (arm).
 * Fully dynamic — returns all distinct scenario_ids in the DB.
 */
/**
 * Goal rate and average cumulative reward per scenario per experiment.
 *
 * Fully dynamic — returns every distinct scenario_id present in the DB
 * so the GUI never needs a hardcoded scenario list.  Used by the scenario
 * goal-rate bar chart and the physio-reward scatter overlay.
 *
 * @returns {Promise<Array<{arm, scenario_id, episode_count, goal_rate, avg_reward, min_reward, max_reward}>>}
 */
export async function getScenarioGoalRates() {
    const db = await getDb();
    return db.all(
        `SELECT e.arm, e.scenario_id,
                COUNT(*) as episode_count,
                AVG(e.goal_achieved) as goal_rate,
                AVG(e.cumulative_reward) as avg_reward,
                MIN(e.cumulative_reward) as min_reward,
                MAX(e.cumulative_reward) as max_reward
         FROM htn_benchmark_episodes e
         WHERE e.scenario_id IS NOT NULL AND e.scenario_id != ''
         GROUP BY e.arm, e.scenario_id
         ORDER BY e.scenario_id, e.arm`
    );
}

/**
 * Physio-reward correlation data: per-episode hrv_ms mean, stress_index mean vs reward.
 * Used for scatter plot showing relationship between physiology and outcomes.
 */
/**
 * Per-episode physiological and reward data for scatter / correlation charts.
 *
 * Aggregates turn-level HRV and stress readings to episode level so each
 * point in the scatter plot represents one complete episode.  All 5,402 turns
 * have populated hrv_ms and stress_index columns, so no filtering is needed.
 *
 * Intended use: HRV vs cumulative_reward, stress_index vs stress_reward_component.
 *
 * @returns {Promise<Array<{arm, scenario_id, cumulative_reward, goal_achieved,
 *   stress_auc, mean_hrv, mean_stress_index, mean_stress_reward,
 *   mean_trust_reward, mean_goal_reward, turn_count}>>}
 */
export async function getPhysioRewardData() {
    const db = await getDb();
    return db.all(
        `SELECT e.arm, e.scenario_id,
                e.cumulative_reward, e.goal_achieved, e.stress_auc,
                AVG(t.hrv_ms) as mean_hrv,
                AVG(t.stress_index) as mean_stress_index,
                AVG(t.reward_stress) as mean_stress_reward,
                AVG(t.reward_trust) as mean_trust_reward,
                AVG(t.reward_goal) as mean_goal_reward,
                COUNT(t.turn_id) as turn_count
         FROM htn_benchmark_episodes e
         JOIN htn_benchmark_turns t ON t.episode_id = e.episode_id
         GROUP BY e.episode_id
         ORDER BY e.arm, e.started_at`
    );
}

/**
 * Critical failure summary: episodes where goal was NOT achieved, grouped by experiment + scenario.
 */
/**
 * Critical failure summary — episodes where goal_achieved = 0, grouped by
 * experiment and scenario.
 *
 * A "critical failure" in this context is a complete episode that did not meet
 * the session goal (goal_achieved = 0).  This is distinct from the in-episode
 * 2-strike termination (which also sets goal_achieved = 0 but ends the episode
 * early via a cumulative_reward penalty of −1.5).
 *
 * The failure rate (failed_episodes / total_episodes) is the primary metric.
 * fail_avg_reward and fail_avg_stress show whether failures cluster around
 * high-stress scenarios or low-engagement ones.
 *
 * @returns {Promise<Array<{arm, scenario_id, total_episodes, failed_episodes,
 *   fail_avg_reward, fail_avg_stress}>>}
 */
export async function getCriticalFailureSummary() {
    const db = await getDb();
    return db.all(
        `SELECT e.arm, e.scenario_id,
                COUNT(*) as total_episodes,
                SUM(CASE WHEN e.goal_achieved = 0 THEN 1 ELSE 0 END) as failed_episodes,
                AVG(CASE WHEN e.goal_achieved = 0 THEN e.cumulative_reward END) as fail_avg_reward,
                AVG(CASE WHEN e.goal_achieved = 0 THEN e.stress_auc END) as fail_avg_stress
         FROM htn_benchmark_episodes e
         WHERE e.scenario_id IS NOT NULL AND e.scenario_id != ''
         GROUP BY e.arm, e.scenario_id
         ORDER BY failed_episodes DESC`
    );
}

/**
 * Get a side-by-side comparison of all three arms for the same canonical scenario.
 * Returns null if fewer than 2 arms have a transcript for this scenario.
 */
export async function getArmComparisonForScenario(scenarioId, runId = null) {
    const db = await getDb();
    const rows = await db.all(
        `SELECT t.arm, t.transcript, t.summary, t.canonical_label,
                e.cumulative_reward, e.goal_achieved, e.stress_auc, e.trust_delta_final
         FROM htn_transcripts t
         LEFT JOIN htn_benchmark_episodes e ON e.episode_id = t.transcript_id
         WHERE t.scenario_id = ?
           AND t.is_canonical = 1
           ${runId ? 'AND t.run_id = ?' : ''}
         ORDER BY t.arm`,
        runId ? [scenarioId, runId] : [scenarioId]
    );
    if (rows.length < 2) return null;
    const comparison = {};
    rows.forEach(r => {
        comparison[r.arm] = {
            transcript:       JSON.parse(r.transcript || '[]'),
            summary:          r.summary,
            cumulative_reward: r.cumulative_reward,
            goal_achieved:    !!r.goal_achieved,
            stress_auc:       r.stress_auc,
            trust_delta_final: r.trust_delta_final,
        };
    });
    return comparison;
}

/**
 * List episodes for the conversation viewer (lightweight — no turn data).
 *
 * @param {object} opts
 * @param {string} [opts.arm]         — filter by experiment
 * @param {string} [opts.scenario_id] — filter by scenario
 * @param {number} [opts.limit=100]
 * @returns {Promise<Array<{episode_id, arm, scenario_id, run_label, cumulative_reward,
 *   goal_achieved, stress_auc, started_at}>>}
 */
export async function listEpisodesForViewer({ arm, scenario_id, run_id, limit = 100 } = {}) {
    const db = await getDb();
    const clauses = ['e.turn_count > 0'];  // always skip ghost rows with 0 turns
    const params = [];
    if (arm)         { clauses.push('e.arm = ?');         params.push(arm); }
    if (scenario_id) { clauses.push('e.scenario_id = ?'); params.push(scenario_id); }
    if (run_id)      { clauses.push('e.run_id = ?');      params.push(run_id); }
    const where = 'WHERE ' + clauses.join(' AND ');
    params.push(limit);
    return db.all(
        `SELECT e.episode_id, e.arm, e.scenario_id,
                r.label as run_label, e.run_id,
                e.cumulative_reward, e.goal_achieved, e.stress_auc,
                e.turn_count, e.started_at
         FROM htn_benchmark_episodes e
         JOIN htn_benchmark_runs r ON r.run_id = e.run_id
         ${where}
         ORDER BY e.started_at DESC LIMIT ?`,
        params
    );
}

/**
 * Load full turn-by-turn conversation for a single episode.
 *
 * Returns turns ordered by turn_number including both the synthetic patient
 * message (patient_message field on turns is not stored — use response as
 * agent turn and build patient turns from htn_transcripts if available).
 * Falls back to turn records only when no transcript exists.
 *
 * @param {string} episode_id
 * @returns {Promise<{episode: object, turns: object[], transcript: object[]|null}>}
 */
export async function getEpisodeConversation(episode_id) {
    const db = await getDb();

    const episode = await db.get(
        `SELECT e.*, r.label as run_label
         FROM htn_benchmark_episodes e
         JOIN htn_benchmark_runs r ON r.run_id = e.run_id
         WHERE e.episode_id = ?`,
        [episode_id]
    );
    if (!episode) return null;

    const turns = await db.all(
        `SELECT turn_number, action, response, hrv_ms, stress_index, stress_label,
                reward_stress, reward_trust, reward_goal, reward_consistency,
                judge_clinical, judge_empathy, judge_safety, judge_goal, judge_strategy,
                latency_ms, tokens_scout, tokens_maverick
         FROM htn_benchmark_turns
         WHERE episode_id = ?
         ORDER BY turn_number ASC`,
        [episode_id]
    );

    // Try to get the full transcript (includes patient messages)
    const transcriptRow = await db.get(
        `SELECT transcript FROM htn_transcripts WHERE transcript_id = ? LIMIT 1`,
        [episode_id]
    );
    const transcript = transcriptRow?.transcript
        ? (() => { try { return JSON.parse(transcriptRow.transcript); } catch { return null; } })()
        : null;

    return { episode, turns, transcript };
}

/**
 * Per-episode reward component averages for line charts.
 * Returns one row per episode per arm, ordered by episode start time.
 * Used to render per-dimension reward timelines on the benchmarks dashboard
 * (goal, stress, trust, info, consistency — each as a separate line per experiment).
 *
 * @param {number} [windowSize=20]  Rolling mean window (episodes).
 * @returns {Promise<Array<{arm, episode_index, hours_elapsed, run_restart,
 *   goal_wma, stress_wma, trust_wma, info_wma, consistency_wma}>>}
 */
export async function getRewardComponentTimeline(windowSize = 20) {
    const db  = await getDb();
    const rows = await db.all(
        `SELECT e.arm,
                e.episode_id, e.episode_index,
                e.started_at,
                r.label      as run_label,
                AVG(t.reward_goal)        as mean_goal,
                AVG(t.reward_stress)      as mean_stress,
                AVG(t.reward_trust)       as mean_trust,
                AVG(t.reward_info)        as mean_info,
                AVG(t.reward_consistency) as mean_consistency
         FROM htn_benchmark_episodes e
         JOIN htn_benchmark_runs r     ON r.run_id = e.run_id
         JOIN htn_benchmark_turns t    ON t.episode_id = e.episode_id
         WHERE e.started_at IS NOT NULL
         GROUP BY e.episode_id
         ORDER BY e.arm, e.started_at ASC`
    );

    // Group by arm, compute rolling mean per component, add hours_elapsed + restart markers
    const byArm = {};
    for (const r of rows) {
        (byArm[r.arm] = byArm[r.arm] || []).push(r);
    }

    const dims = ['goal', 'stress', 'trust', 'info', 'consistency'];
    const out = [];

    for (const [arm, eps] of Object.entries(byArm)) {
        const t0 = eps[0].started_at;
        let prevRun = eps[0].run_label;

        eps.forEach((ep, idx) => {
            const slice = eps.slice(Math.max(0, idx - windowSize + 1), idx + 1);
            const wma = {};
            for (const d of dims) {
                const vals = slice.map(e => e[`mean_${d}`] ?? 0);
                wma[`${d}_wma`] = vals.reduce((s, v) => s + v, 0) / vals.length;
            }
            const runRestart = ep.run_label !== prevRun;
            prevRun = ep.run_label;
            out.push({
                arm,
                episode_index: idx,
                hours_elapsed: (ep.started_at - t0) / 3_600_000,
                run_restart:   runRestart,
                run_label:     ep.run_label,
                ...wma,
            });
        });
    }
    return out;
}


/**
 * Insert a checkpoint event row.  Called from the /api/benchmarks/checkpoint POST route.
 * @param {{run_id, arm, episode, stopped, ts}} data
 */
export async function insertCheckpointEvent({ run_id, arm, episode, stopped, ts }) {
    const db = await getDb();
    await db.run(
        `INSERT INTO htn_benchmark_checkpoints (run_id, arm, episode, stopped, ts)
         VALUES (?, ?, ?, ?, ?)`,
        [run_id, arm, episode, stopped ? 1 : 0, ts]
    );
}

/**
 * Return all checkpoint events, ordered chronologically.
 * Each row: { arm, episode, stopped, ts, run_id }
 */
export async function getCheckpointEvents() {
    const db = await getDb();
    return db.all(
        `SELECT arm, episode, stopped, ts, run_id
         FROM htn_benchmark_checkpoints
         ORDER BY ts ASC`
    );
}