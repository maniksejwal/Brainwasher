/**
 * @fileoverview HTN benchmark REST routes
 * Receives benchmark run/episode/turn data from the Python tensornets server
 * and persists it to the shared SQLite DB.
 *
 * Also serves dashboard queries for the GUI benchmarks tab.
 *
 * Routes:
 *   POST /api/benchmarks/run              → createBenchmarkRun
 *   POST /api/benchmarks/run/finalise     → finaliseBenchmarkRun
 *   POST /api/benchmarks/episode          → createBenchmarkEpisode
 *   POST /api/benchmarks/episode/finalise → finaliseBenchmarkEpisode
 *   POST /api/benchmarks/turn             → recordBenchmarkTurn
 *   POST /api/benchmarks/compare          → compareBenchmarkArms
 *   GET  /api/benchmarks/runs             → listBenchmarkRuns
 *   GET  /api/benchmarks/runs/:run_id     → getBenchmarkRun
 *   GET  /api/benchmarks/scenario-breakdown/:run_id → getRunScenarioBreakdown
 */

import { Router } from 'express';
import {
    createBenchmarkRun,
    finaliseBenchmarkRun,
    createBenchmarkEpisode,
    finaliseBenchmarkEpisode,
    recordBenchmarkTurn,
    compareBenchmarkArms,
    listBenchmarkRuns,
    getBenchmarkRun,
    getRunScenarioBreakdown,
    getSmoothedLearningCurves,
    getMergedExperimentTimeline,
    getExperimentMetricSummary,
    getScenarioGoalRates,
    getPhysioRewardData,
    getCriticalFailureSummary,
    listEpisodesForViewer,
    getEpisodeConversation,
    getRewardComponentTimeline,
    insertCheckpointEvent,
    getCheckpointEvents,
} from '../db/queries_benchmarks.js';

const router = Router();

// ─── Write endpoints (called from Python via tensornets/server.py) ────────────

router.post('/run', async (req, res) => {
    try {
        const run_id = await createBenchmarkRun(req.body);
        res.json({ run_id, stored: true });
    } catch (e) {
        res.status(500).json({ error: e.message, stored: false });
    }
});

router.post('/run/finalise', async (req, res) => {
    try {
        const { run_id, ...metrics } = req.body;
        await finaliseBenchmarkRun(run_id, metrics);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/episode', async (req, res) => {
    try {
        const episode_id = await createBenchmarkEpisode(req.body);
        res.json({ episode_id, stored: true });
    } catch (e) {
        res.status(500).json({ error: e.message, stored: false });
    }
});

router.post('/episode/finalise', async (req, res) => {
    try {
        // Python sends { episode_id, metrics: { n_turns, cumulative_reward, ... } }
        // Flatten the nested metrics object so finaliseBenchmarkEpisode gets a flat dict.
        const { episode_id, metrics: nested, ...flat } = req.body;
        const metrics = nested ?? flat;   // support both { metrics: {...} } and flat body
        await finaliseBenchmarkEpisode(episode_id, metrics);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/turn', async (req, res) => {
    try {
        const { episode_id, run_id, arm, ...turn } = req.body;
        await recordBenchmarkTurn(episode_id, run_id, arm, turn);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── Read endpoints (called from GUI dashboard + CLI) ─────────────────────────

// Checkpoint events — write (from Python train.py) and read (from dashboard)
router.post('/checkpoint', async (req, res) => {
    try {
        await insertCheckpointEvent(req.body);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/checkpoints', async (req, res) => {
    try {
        const rows = await getCheckpointEvents();
        res.json({ rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/compare', async (req, res) => {
    try {
        const { scenario_set } = req.body;
        const rows = await compareBenchmarkArms(scenario_set || '');
        res.json({ rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/runs', async (req, res) => {
    try {
        const { arm, limit } = req.query;
        const runs = await listBenchmarkRuns({ arm, limit: parseInt(limit) || 50 });
        res.json({ runs });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/runs/:run_id', async (req, res) => {
    try {
        const run = await getBenchmarkRun(req.params.run_id);
        if (!run) return res.status(404).json({ error: 'Run not found' });
        res.json(run);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/scenario-breakdown/:run_id', async (req, res) => {
    try {
        const rows = await getRunScenarioBreakdown(req.params.run_id);
        res.json({ rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/learning-curves', async (req, res) => {
    try {
        const { run_id, limit, window } = req.query;
        const rows = await getSmoothedLearningCurves({
            run_id:  run_id  || undefined,
            limit:   parseInt(limit)  || 200,
            window:  parseInt(window) || 5,
        });
        res.json({ rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Merged experiment timeline (cross-run continuous sequence) ─────────────────
router.get('/experiment-timeline', async (req, res) => {
    try {
        const { arm, window } = req.query;
        const rows = await getMergedExperimentTimeline({
            arm:        arm || undefined,
            windowSize: parseInt(window) || 20,
        });
        const armEpisodeCounts = rows._armEpisodeCounts || {};
        // strip the non-array property before sending; use explicit field on object
        const cleanRows = Array.isArray(rows) ? rows : Array.from(rows);
        res.json({ rows: cleanRows, armEpisodeCounts });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Per-experiment metric aggregates (for bar charts) ─────────────────────────
router.get('/experiment-metrics', async (req, res) => {
    try {
        const rows = await getExperimentMetricSummary();
        res.json({ rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Per-reward-component timeline (for individual dimension line charts) ──────
router.get('/reward-components', async (req, res) => {
    try {
        const windowSize = parseInt(req.query.window) || 20;
        const rows = await getRewardComponentTimeline(windowSize);
        res.json({ rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Scenario goal rates (dynamic, all scenarios) ──────────────────────────────
router.get('/scenario-goal-rates', async (req, res) => {
    try {
        const rows = await getScenarioGoalRates();
        res.json({ rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Physio-reward correlation data ───────────────────────────────────────────
router.get('/physio-reward', async (req, res) => {
    try {
        const rows = await getPhysioRewardData();
        res.json({ rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Critical failure summary ──────────────────────────────────────────────────
router.get('/critical-failures', async (req, res) => {
    try {
        const rows = await getCriticalFailureSummary();
        res.json({ rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Episode conversation viewer ───────────────────────────────────────────────
router.get('/episodes', async (req, res) => {
    try {
        const { arm, scenario_id, run_id, limit } = req.query;
        const rows = await listEpisodesForViewer({
            arm:         arm || undefined,
            scenario_id: scenario_id || undefined,
            run_id:      run_id || undefined,
            limit:       parseInt(limit) || 100,
        });
        res.json({ episodes: rows, rows });  // support both keys for backwards compat
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete a ghost/dangling episode (no turns, no JSONL) — called by train.py cleanup
router.delete('/episode/:episode_id', async (req, res) => {
    try {
        const { episode_id } = req.params;
        const db = await import('../db/db.js').then(m => m.getDb());
        await db.run(
            `DELETE FROM htn_benchmark_episodes WHERE episode_id = ? AND turn_count = 0 AND stress_auc IS NULL`,
            [episode_id]
        );
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/episodes/:episode_id/conversation', async (req, res) => {
    try {
        const data = await getEpisodeConversation(req.params.episode_id);
        if (!data) return res.status(404).json({ error: 'Episode not found' });
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Prompt version log (for reference) ───────────────────────────────────────
router.get('/prompt-versions', async (req, res) => {
    try {
        const { getDb } = await import('../db/connection.js');
        const db = await getDb();
        const rows = await db.all(
            `SELECT version, name, deployed_at, created_at
             FROM prompt_versions
             ORDER BY created_at ASC`
        );
        res.json({ rows });
    } catch (e) {
        res.status(500).json({ error: e.message, rows: [] });
    }
});

export default router;
