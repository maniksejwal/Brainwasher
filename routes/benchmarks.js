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
    getActionStats,
    getActionStatsSummary,
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
// Helper to serve timeline rows (slim or full) --------------------------------
async function _serveTimeline(req, res, slim) {
    try {
        const { arm, window } = req.query;
        const rows = await getMergedExperimentTimeline({
            arm:        arm || undefined,
            windowSize: parseInt(window) || 20,
            slim,
        });
        const armEpisodeCounts = rows._armEpisodeCounts || {};
        const cleanRows = Array.isArray(rows) ? rows : Array.from(rows);
        res.json({ rows: cleanRows, armEpisodeCounts });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}

// Slim timeline for line charts — WMA + run metadata only (~4× smaller payload)
router.get('/experiment-timeline', (req, res) => _serveTimeline(req, res, true));

// Full timeline for stats tables — includes tokens, scenario_id, latency, etc.
router.get('/experiment-timeline/full', (req, res) => _serveTimeline(req, res, false));

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

// ── Action usage statistics ───────────────────────────────────────────────────
router.get('/action-stats', async (req, res) => {
    try {
        const rows = await getActionStatsSummary();
        res.json({ rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/action-stats-by-scenario', async (req, res) => {
    try {
        const rows = await getActionStats();
        res.json({ rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Scenario goals (session goals + required elements from scenario definitions) ─
router.get('/scenario-goals', async (req, res) => {
    try {
        const { SCENARIOS } = await import('../training/simulation/scenarios/index.js');
        const scenarios = Object.entries(SCENARIOS).map(([id, s]) => ({
            id,
            session_goal:      s.session_goal       ?? null,
            required_elements: s.required_elements  ?? [],
            difficulty:        s.difficulty         ?? 'standard',
            therapeutic_mode:  s.therapeutic_mode   ?? null,
        }));
        res.json({ scenarios });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── RL Shadow-mode divergence log ────────────────────────────────────────────
//
// training/rl_shadow.js posts divergence records here after each shadow eval.
// The table tracks how differently the A3C policy responds vs rule-based logic.

async function _ensureShadowSchema() {
    const { getDb } = await import('../db/connection.js');
    const db = await getDb();
    await db.run(`
        CREATE TABLE IF NOT EXISTS shadow_divergence_log (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            ts                INTEGER NOT NULL,
            conversation_id   TEXT,
            episode_id        TEXT,
            arm               TEXT,
            turn_idx          INTEGER,
            prod_action       TEXT,
            a3c_action        TEXT,
            action_match      INTEGER,
            cosine_similarity REAL,
            high_divergence   INTEGER DEFAULT 0,
            value_estimate    REAL,
            a3c_latency_ms    INTEGER,
            a3c_error         TEXT
        )
    `);
    await db.run(`
        CREATE INDEX IF NOT EXISTS idx_shadow_ts ON shadow_divergence_log (ts)
    `);
    return db;
}

router.post('/shadow-log', async (req, res) => {
    try {
        const db = await _ensureShadowSchema();
        const r  = req.body;
        await db.run(
            `INSERT INTO shadow_divergence_log
             (ts, conversation_id, episode_id, arm, turn_idx, prod_action,
              a3c_action, action_match, cosine_similarity, high_divergence,
              value_estimate, a3c_latency_ms, a3c_error)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
                r.ts, r.conversation_id, r.episode_id, r.arm, r.turn_idx,
                r.prod_action, r.a3c_action, r.action_match ? 1 : 0,
                r.cosine_similarity, r.high_divergence ? 1 : 0,
                r.value_estimate, r.a3c_latency_ms, r.a3c_error || null,
            ],
        );
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/benchmarks/shadow-stats  — summary for the dashboard
router.get('/shadow-stats', async (req, res) => {
    try {
        const db   = await _ensureShadowSchema();
        const lim  = parseInt(req.query.last_n || '1000', 10);
        const rows = await db.all(`
            SELECT
                COUNT(*) total,
                SUM(high_divergence) high_div,
                ROUND(100.0 * SUM(high_divergence) / MAX(1, COUNT(*)), 1) high_div_pct,
                SUM(CASE WHEN action_match = 0 THEN 1 ELSE 0 END) action_mismatch,
                SUM(CASE WHEN a3c_error IS NOT NULL THEN 1 ELSE 0 END) error_count,
                ROUND(AVG(cosine_similarity), 4) avg_similarity,
                ROUND(AVG(a3c_latency_ms), 0) avg_latency_ms
            FROM (SELECT * FROM shadow_divergence_log ORDER BY ts DESC LIMIT ?)
        `, [lim]);
        const byArm = await db.all(`
            SELECT arm,
                   COUNT(*) total,
                   ROUND(AVG(cosine_similarity), 4) avg_sim,
                   SUM(high_divergence) high_div
            FROM (SELECT * FROM shadow_divergence_log ORDER BY ts DESC LIMIT ?)
            WHERE arm IS NOT NULL
            GROUP BY arm ORDER BY total DESC
        `, [lim]);
        res.json({ summary: rows[0] ?? {}, by_arm: byArm });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── HITL feedback endpoints ───────────────────────────────────────────────────
//
// These endpoints bridge the human annotation layer (training/feedback/annotator.js)
// to the Python A3C reward update loop.
//
// Flow:
//   1. Human annotator scores a conversation via annotator.js (CLI) or the GUI.
//      annotation is saved to feedback table: {conversation_id, score -1/0/+1, comment}
//   2. Python training loop polls GET /api/benchmarks/feedback/pending to
//      retrieve unapplied annotations (applied_to_a3c = 0).
//   3. Python applies the reward correction (HITL_WEIGHT * score) to the
//      episode's cumulative_reward in its in-memory gradient buffer.
//   4. Python calls POST /api/benchmarks/feedback/mark-applied with the ids.
//      This sets applied_to_a3c=1 so they are not replayed.
//
// The feedback table is in care_circle_dev.db (same DB as benchmarks).
// Schema is created here on first call (CREATE IF NOT EXISTS).

// Ensure HITL schema exists (idempotent)
async function _ensureHITLSchema() {
    const { getDb } = await import('../db/connection.js');
    const db = await getDb();
    await db.run(`
        CREATE TABLE IF NOT EXISTS feedback (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id    TEXT    NOT NULL,
            episode_id         TEXT,
            arm                TEXT,
            turn_idx           INTEGER,
            score              INTEGER NOT NULL,
            comment            TEXT    DEFAULT '',
            timestamp          INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
            annotator_id       TEXT    DEFAULT 'reviewer',
            applied_to_a3c     INTEGER NOT NULL DEFAULT 0,
            applied_at         INTEGER
        )
    `);
    await db.run(`
        CREATE INDEX IF NOT EXISTS idx_feedback_applied ON feedback (applied_to_a3c, timestamp)
    `);
    return db;
}

// POST /api/benchmarks/feedback  — submit one annotation (from GUI or annotator.js)
router.post('/feedback', async (req, res) => {
    try {
        const db = await _ensureHITLSchema();
        const { conversation_id, episode_id, arm, turn_idx, score, comment, annotator_id } = req.body;
        if (score === undefined || ![-1, 0, 1].includes(Number(score))) {
            return res.status(400).json({ error: 'score must be -1, 0, or +1' });
        }
        const r = await db.run(
            `INSERT INTO feedback (conversation_id, episode_id, arm, turn_idx, score, comment, annotator_id, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                conversation_id || null,
                episode_id      || null,
                arm             || null,
                turn_idx        != null ? Number(turn_idx) : null,
                Number(score),
                comment         || '',
                annotator_id    || 'reviewer',
                Date.now(),
            ]
        );
        res.json({ ok: true, id: r.lastID });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/benchmarks/feedback/pending?limit=200
// Returns unapplied annotations for Python to consume.
router.get('/feedback/pending', async (req, res) => {
    try {
        const db  = await _ensureHITLSchema();
        const lim = Math.min(parseInt(req.query.limit || '200', 10), 1000);
        const rows = await db.all(
            `SELECT id, conversation_id, episode_id, arm, turn_idx, score, comment, annotator_id, timestamp
             FROM feedback
             WHERE applied_to_a3c = 0
             ORDER BY timestamp ASC
             LIMIT ?`,
            [lim]
        );
        res.json({ pending: rows, count: rows.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/benchmarks/feedback/mark-applied  — body: { ids: [1, 2, 3] }
// Called by Python after applying HITL corrections to acknowledge them.
router.post('/feedback/mark-applied', async (req, res) => {
    try {
        const db  = await _ensureHITLSchema();
        const ids = req.body.ids;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids must be a non-empty array' });
        }
        const placeholders = ids.map(() => '?').join(',');
        await db.run(
            `UPDATE feedback SET applied_to_a3c = 1, applied_at = ? WHERE id IN (${placeholders})`,
            [Date.now(), ...ids]
        );
        res.json({ ok: true, updated: ids.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/benchmarks/feedback/stats — annotation statistics for the dashboard
router.get('/feedback/stats', async (req, res) => {
    try {
        const db = await _ensureHITLSchema();
        const rows = await db.all(`
            SELECT annotator_id,
                   COUNT(*) total,
                   SUM(CASE WHEN score =  1 THEN 1 ELSE 0 END) positive,
                   SUM(CASE WHEN score =  0 THEN 1 ELSE 0 END) neutral,
                   SUM(CASE WHEN score = -1 THEN 1 ELSE 0 END) negative,
                   ROUND(AVG(score), 3) avg_score,
                   SUM(applied_to_a3c) applied
            FROM feedback
            GROUP BY annotator_id
            ORDER BY total DESC
        `);
        const byArm = await db.all(`
            SELECT arm, COUNT(*) total, ROUND(AVG(score), 3) avg_score
            FROM feedback WHERE arm IS NOT NULL
            GROUP BY arm ORDER BY total DESC
        `);
        res.json({ by_annotator: rows, by_arm: byArm });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
