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
