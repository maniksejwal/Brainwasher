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
        const { episode_id, ...metrics } = req.body;
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

export default router;
