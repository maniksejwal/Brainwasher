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

async function db() { return getDb(); }

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
    const d = await db();
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
    const d = await db();
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
    const d = await db();
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
    const d = await db();
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

export async function createBenchmarkEpisode({ run_id, scenario_id, persona_id, arm }) {
    const d = await db();
    const episode_id = randomUUID();
    await d.run(
        `INSERT INTO htn_benchmark_episodes
         (episode_id, run_id, scenario_id, persona_id, arm, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [episode_id, run_id, scenario_id, persona_id ?? null, arm, Date.now()]
    );
    return episode_id;
}

export async function finaliseBenchmarkEpisode(episode_id, metrics = {}) {
    const d = await db();
    const {
        cumulative_reward, stress_auc, goal_achieved, turns_to_goal,
        trust_delta_final, tokens_scout, tokens_maverick, latency_ms_mean, summary,
        turn_count,
    } = metrics;
    await d.run(
        `UPDATE htn_benchmark_episodes
         SET completed_at=?, turn_count=?, cumulative_reward=?, stress_auc=?,
             goal_achieved=?, turns_to_goal=?, trust_delta_final=?,
             tokens_scout=?, tokens_maverick=?, latency_ms_mean=?, summary=?
         WHERE episode_id=?`,
        [Date.now(), turn_count ?? 0, cumulative_reward ?? null, stress_auc ?? null,
         goal_achieved ? 1 : 0, turns_to_goal ?? null, trust_delta_final ?? null,
         tokens_scout ?? 0, tokens_maverick ?? 0, latency_ms_mean ?? null,
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
    const d = await db();
    const {
        turn_number, action, response,
        hrv_ms, stress_label, stress_index,
        reward_stress, reward_trust, reward_goal, reward_info, reward_consistency,
        judge_clinical, judge_empathy, judge_safety, judge_goal, judge_strategy,
        linguistic_stress, discrepancy_flag,
        tokens_scout, tokens_maverick, latency_ms,
    } = turn;
    await d.run(
        `INSERT INTO htn_benchmark_turns
         (episode_id, run_id, arm, turn_number, action, response,
          hrv_ms, stress_label, stress_index,
          reward_stress, reward_trust, reward_goal, reward_info, reward_consistency,
          judge_clinical, judge_empathy, judge_safety, judge_goal, judge_strategy,
          linguistic_stress, discrepancy_flag, tokens_scout, tokens_maverick, latency_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [episode_id, run_id, arm, turn_number, action ?? null, response ?? null,
         hrv_ms ?? null, stress_label ?? null, stress_index ?? null,
         reward_stress ?? null, reward_trust ?? null, reward_goal ?? null,
         reward_info ?? null, reward_consistency ?? null,
         judge_clinical ?? null, judge_empathy ?? null, judge_safety ?? null,
         judge_goal ?? null, judge_strategy ?? null,
         linguistic_stress ?? null, discrepancy_flag ? 1 : 0,
         tokens_scout ?? 0, tokens_maverick ?? 0, latency_ms ?? null]
    );
}

// ─── Comparison ───────────────────────────────────────────────────────────────

/**
 * Compare arms across a shared scenario set.
 * Returns aggregate stats per arm for dashboard display.
 */
export async function compareBenchmarkArms(scenario_set) {
    const d = await db();
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
         WHERE r.scenario_set = ?
         GROUP BY r.arm
         ORDER BY mean_reward DESC`,
        [scenario_set]
    );
}

/**
 * Get per-scenario breakdown for a specific run.
 * Used for transcript comparison view in dashboard.
 */
export async function getRunScenarioBreakdown(run_id) {
    const d = await db();
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
    const db = await getDb();
    const cutoffStr = await getBenchmarkMeta('baseline_cutoff_ts');
    if (!cutoffStr) return null;

    const cutoff = Number(cutoffStr);
    const row = await db.get(
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
