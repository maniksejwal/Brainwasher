/**
 * @fileoverview gui/ui/benchmarksDashboard.js — A3C Benchmarks Dashboard (v4)
 *
 * ## What it is
 * The single-page dashboard that visualises all A3C training data stored in
 * `htn_benchmark_*` tables.  It is imported by `gui/ui/navigationHandlers.js`
 * and mounted when the user navigates to the "Benchmarks" tab.
 *
 * ## Why it exists
 * Training runs are long (hours–days) and produce hundreds of episodes per arm.
 * Raw SQLite rows are not human-readable.  This module turns those rows into
 * interactive Chart.js charts and summary tables so the team can evaluate:
 *   - Which experiment arms are learning faster (learning curves)
 *   - Which scenarios are hardest (scenario goal-rate heatmap + rank table)
 *   - Whether physio-sensor data actually helps (sensor vs. no-sensor split)
 *   - Cost/latency trade-offs between LLM-heavy (CoT-MCTS) and MPS arms
 *   - Critical failure rates per scenario
 *
 * ## Logic and data flow (with citations)
 *
 * ### Experiment naming
 * Historical runs used legacy arm names (`htn_mcts`, `hysteresis_prompt`).
 * These are mapped to canonical names at **fetch time** via `LEGACY_ALIAS`
 * so that old + new training data plot as one continuous line with a grey
 * partition marker.  The rename happened at run_015 (2026-05-31).
 * See: [A3C Redesign chat](bd00417c-24b7-4ba3-8825-da1f77089b74)
 *
 * ### Fetch → canonicalize → render pipeline
 *   1. `_refresh()` fires all fetchers in parallel via `Promise.all`.
 *   2. Each fetcher (e.g. `_fetchTimeline`) calls `_canonicalizeArm(r)` on
 *      every row before storing into `_state`.  Rows with legacy arm names
 *      are remapped; rows with duplicate arm+scenario keys are merged
 *      (weighted-average for rates, sum for counts).
 *   3. `_renderAll()` calls every render function with data from `_state`
 *      that is guaranteed to contain only canonical arm names (`EXP_KEYS`).
 *
 * ### Experiment order and colour palette
 * Defined in `EXP_META` (top of file).  Each entry has `label`, `shortLabel`,
 * `color` (hex), and `bg` (rgba for fill bands).  The order matches the
 * `--arms` CLI index in `tensornets/a3c/train.py` (1=Exp0 … 8=Exp7).
 * Exp 0 = Oldschool (no physio) — true baseline placed first.
 *
 * ### Chart types
 *   - **Learning curves** (`_buildLineDatasets`): per-arm WMA of cumulative
 *     reward, goal rate, stress AUC.  Episode index on x-axis; run-restart
 *     gaps injected as `null` points (Chart.js `spanGaps:false`).
 *   - **Scenario goal-rate bar chart** (`_renderScenarioGoalRates`): overlapping
 *     bars sorted worst-first (tallest bar behind, shortest in front) so all
 *     arms are visible without stacking.  `barPercentage:1, categoryPercentage:0.85`.
 *   - **Scenario rank table** (`_renderScenarioRankTable`): heat-coloured cells,
 *     sortable by arm or mean.  Sticky episode-count row shows total episodes
 *     including legacy data.
 *   - **Sensor vs. no-sensor** (`_renderSensorComparison`): classifies rows by
 *     `scenario_id.endsWith('_no_sensor')` OR `arm==='oldschool'`.  Produces
 *     stat cards + grouped bar chart.
 *   - **Cost / latency charts** (`_renderCostCharts`): per-arm box plots of
 *     latency_ms and estimated USD cost tracked by `CostTracker` in Python.
 *   - **Metric bars** (`_renderMetricBars`): overlapping bars for goal rate,
 *     mean reward, stress AUC per run (not per episode), coloured by arm.
 *
 * ### Zoom / pan
 * All line charts share `_ZOOM_PLUGIN` (chartjs-plugin-zoom + hammerjs) for
 * Ctrl+mouse-wheel zoom and drag-pan on the x-axis (pinch zoom on touch).
 * Normal scroll is never intercepted — only Ctrl+wheel triggers zoom.
 *
 * ## Module structure
 *   Constants  : EXP_META, EXP_KEYS, LEGACY_ALIAS, _ZOOM_PLUGIN
 *   State      : _state (single mutable object, never exported)
 *   Public API : initBenchmarksDashboard(), refreshBenchmarksDashboard()
 *   Fetchers   : _fetchTimeline, _fetchMetrics, _fetchScenarioGoals,
 *                _fetchPhysio, _fetchCritFail, _fetchRewardComponents,
 *                _fetchCheckpoints, _fetchSimStats
 *   Helpers    : _canonicalizeArm, _mergeRows, _buildLineDatasets,
 *                _buildRestartAnnotations, _filterByDuration,
 *                _destroyChart, _showSpinner, _attachToolbar
 *   Renderers  : _renderAll → calls every _render* function in order
 */

import config from '../config.js';

const EXP_META = {
    // ── Base experiments (Exp 0–7) ──────────────────────────────────────────
    oldschool:                                    { label: 'Exp 0 \u2014 Oldschool (no physio)',          shortLabel: 'Exp 0',  color: '#34A853', bg: 'rgba(52,168,83,0.18)',    group: 'base'      },
    physio_llm:                                   { label: 'Exp 1 \u2014 PhysioLLM',                      shortLabel: 'Exp 1',  color: '#EA4335', bg: 'rgba(234,67,53,0.18)',    group: 'base'      },
    physio_llm_cot_mcts:                          { label: 'Exp 2 \u2014 PhysioLLM CoT-MCTS',             shortLabel: 'Exp 2',  color: '#FF6D00', bg: 'rgba(255,109,0,0.18)',    group: 'base'      },
    physio_mps_mcts:                              { label: 'Exp 3 \u2014 PhysioMPS-MCTS',                 shortLabel: 'Exp 3',  color: '#4285F4', bg: 'rgba(66,133,244,0.18)',   group: 'base'      },
    inertial_physio_mps_mcts:                     { label: 'Exp 4 \u2014 Inertial PhysioMPS-MCTS',        shortLabel: 'Exp 4',  color: '#9C27B0', bg: 'rgba(156,39,176,0.18)',   group: 'base'      },
    inertial_physio_llm_cot_mcts:                 { label: 'Exp 5 \u2014 Inertial PhysioLLM CoT',         shortLabel: 'Exp 5',  color: '#00897B', bg: 'rgba(0,137,123,0.18)',    group: 'base'      },
    inertial_hpvoot_physio_mps_mcts:              { label: 'Exp 6 \u2014 Inertial HPVOOT MPS',            shortLabel: 'Exp 6',  color: '#E91E8C', bg: 'rgba(233,30,140,0.18)',   group: 'base'      },
    inertial_hpvoot_physio_llm_cot_mcts:          { label: 'Exp 7 \u2014 Inertial HPVOOT CoT',            shortLabel: 'Exp 7',  color: '#FF9800', bg: 'rgba(255,152,0,0.18)',    group: 'base'      },
    // ── Safety ablations (Exp 0a–7a) ────────────────────────────────────────
    // Dashed / muted tones: same hue family as parent, lighter saturation
    oldschool_no_privacy:                         { label: 'Exp 0a \u2014 Oldschool (no privacy)',         shortLabel: 'Exp 0a', color: '#81C784', bg: 'rgba(129,199,132,0.14)', group: 'ablation'  },
    physio_llm_no_gate:                           { label: 'Exp 1a \u2014 PhysioLLM (no gate)',            shortLabel: 'Exp 1a', color: '#EF9A9A', bg: 'rgba(239,154,154,0.14)', group: 'ablation'  },
    physio_llm_cot_mcts_no_gate:                  { label: 'Exp 2a \u2014 PhysioLLM CoT-MCTS (no gate)',  shortLabel: 'Exp 2a', color: '#FFAB91', bg: 'rgba(255,171,145,0.14)', group: 'ablation'  },
    physio_mps_mcts_no_gate:                      { label: 'Exp 3a \u2014 PhysioMPS-MCTS (no gate)',      shortLabel: 'Exp 3a', color: '#90CAF9', bg: 'rgba(144,202,249,0.14)', group: 'ablation'  },
    inertial_physio_mps_mcts_no_gate:             { label: 'Exp 4a \u2014 Inertial MPS-MCTS (no gate)',   shortLabel: 'Exp 4a', color: '#CE93D8', bg: 'rgba(206,147,216,0.14)', group: 'ablation'  },
    inertial_physio_llm_cot_mcts_no_gate:         { label: 'Exp 5a \u2014 Inertial CoT (no gate)',        shortLabel: 'Exp 5a', color: '#80CBC4', bg: 'rgba(128,203,196,0.14)', group: 'ablation'  },
    inertial_hpvoot_physio_mps_mcts_no_gate:      { label: 'Exp 6a \u2014 HPVOOT MPS (no gate)',         shortLabel: 'Exp 6a', color: '#F48FB1', bg: 'rgba(244,143,177,0.14)', group: 'ablation'  },
    inertial_hpvoot_physio_llm_cot_mcts_no_gate:  { label: 'Exp 7a \u2014 HPVOOT CoT (no gate)',         shortLabel: 'Exp 7a', color: '#FFCC80', bg: 'rgba(255,204,128,0.14)', group: 'ablation'  },
    // ── DPO/RLAIF variants (Exp 0p–7p) ─────────────────────────────────────
    // Dotted / bold tones: same hue family as parent, deeper/darker
    oldschool_dpo:                                { label: 'Exp 0p \u2014 Oldschool + DPO',               shortLabel: 'Exp 0p', color: '#1B5E20', bg: 'rgba(27,94,32,0.18)',    group: 'dpo'       },
    physio_llm_dpo:                               { label: 'Exp 1p \u2014 PhysioLLM DPO',                 shortLabel: 'Exp 1p', color: '#B71C1C', bg: 'rgba(183,28,28,0.18)',   group: 'dpo'       },
    physio_llm_cot_mcts_dpo:                      { label: 'Exp 2p \u2014 PhysioLLM CoT-MCTS DPO',        shortLabel: 'Exp 2p', color: '#BF360C', bg: 'rgba(191,54,12,0.18)',   group: 'dpo'       },
    physio_mps_mcts_dpo:                          { label: 'Exp 3p \u2014 PhysioMPS-MCTS DPO',            shortLabel: 'Exp 3p', color: '#0D47A1', bg: 'rgba(13,71,161,0.18)',   group: 'dpo'       },
    inertial_physio_mps_mcts_dpo:                 { label: 'Exp 4p \u2014 Inertial MPS-MCTS DPO',         shortLabel: 'Exp 4p', color: '#4A148C', bg: 'rgba(74,20,140,0.18)',   group: 'dpo'       },
    inertial_physio_llm_cot_mcts_dpo:             { label: 'Exp 5p \u2014 Inertial PhysioLLM CoT DPO',    shortLabel: 'Exp 5p', color: '#004D40', bg: 'rgba(0,77,64,0.18)',     group: 'dpo'       },
    inertial_hpvoot_physio_mps_mcts_dpo:          { label: 'Exp 6p \u2014 HPVOOT MPS DPO',               shortLabel: 'Exp 6p', color: '#880E4F', bg: 'rgba(136,14,79,0.18)',   group: 'dpo'       },
    inertial_hpvoot_physio_llm_cot_mcts_dpo:      { label: 'Exp 7p \u2014 HPVOOT CoT DPO',               shortLabel: 'Exp 7p', color: '#E65100', bg: 'rgba(230,81,0,0.18)',    group: 'dpo'       },
};
const EXP_KEYS = Object.keys(EXP_META);

// Legacy arm-name aliases: rows with these arm values are folded into the
// canonical arm for display so that old + new training data plots as one
// continuous line (with a gray partition mark where the rename happened).
const LEGACY_ALIAS = {
    htn_mcts:          'physio_mps_mcts',
    hysteresis_prompt: 'physio_llm',
};

let _state = {
    activeExperiments: new Set(EXP_KEYS),
    showRawTraces:  false,
    showSD:         false,
    showCritFail:   false,
    durationDays:   0,
    wmaWindow:      20,
    scenarioFilter: 'all',   // 'all' | 'composite' | 'escalation'
    timelineData:   null,
    armEpisodeCounts: {},
    metricsData:    null,
    simStats:       null,
    scenarioGoalData: null,
    physioData:     null,
    critFailData:   null,
    rewardComponentData: null,
    actionStatsData: null,     // arm-level action usage summary
    actionStatsByScenario: null, // per-scenario action usage
    actionStatsView: 'exp',    // 'exp' | 'scenario'
    actionStatsScenario: null, // selected scenario for per-scenario view
};

export async function initBenchmarksDashboard() {
    _attachToolbar();
    await _refresh();
}
export async function refreshBenchmarksDashboard() { await _refresh(); }
export function renderRecentStatsTable() { _renderRecentStatsTable(); }

async function _refresh() {
    _showSpinner(true);
    _resetLazy();
    _state.statsTimelineData = null;   // reset so stats tables re-fetch on next scroll
    try {
        await Promise.all([
            _fetchTimeline(),
            _fetchMetrics(),
            _fetchSimStats(),
            _fetchScenarioGoals(),
            _fetchPhysio(),
            _fetchCritFail(),
            _fetchStratifiedGoalRates(),
            _fetchRewardComponents(),
            _fetchCheckpoints(),
            _fetchActionStats(),
        ]);
        _renderAll();
    } catch (e) { console.error('[benchmarks] refresh error', e); }
    finally { _showSpinner(false); }
}

// -- Fetchers -----------------------------------------------------------------
// All fetchers canonicalize legacy arm names (LEGACY_ALIAS) at the point of
// storage so every render function can assume only canonical EXP_KEYS names.
function _canonicalizeArm(r) {
    const arm = LEGACY_ALIAS[r.arm] ?? r.arm;
    return arm === r.arm ? r : { ...r, arm };
}

async function _fetchTimeline() {
    // Slim fetch: WMA + run metadata only — used by all line charts.
    // Heavy stats fields (tokens, scenario_id, latency, etc.) are fetched
    // separately via _fetchTimelineForStats(), triggered lazily when the
    // stats table sections scroll into view.
    const data = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/experiment-timeline?window=${_state.wmaWindow}`).then(r=>r.json());
    _state.timelineData = (data.rows || []).map(_canonicalizeArm);
    // Also canonicalize the armEpisodeCounts keys
    const raw = data.armEpisodeCounts || {};
    const merged = {};
    for (const [arm, n] of Object.entries(raw)) {
        const canon = LEGACY_ALIAS[arm] ?? arm;
        merged[canon] = (merged[canon] || 0) + n;
    }
    _state.armEpisodeCounts = merged;
}

async function _fetchTimelineForStats() {
    // Full fetch: includes tokens, scenario_id, latency, trust_delta, etc.
    // Only called when a stats table section scrolls into view.
    const data = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/experiment-timeline/full?window=${_state.wmaWindow}`).then(r=>r.json());
    _state.statsTimelineData = (data.rows || []).map(_canonicalizeArm);
}
async function _fetchMetrics() {
    const { rows } = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/experiment-metrics`).then(r=>r.json());
    // Merge duplicate arm rows (e.g. htn_mcts + physio_mps_mcts → physio_mps_mcts)
    const merged = {};
    for (const r of (rows || []).map(_canonicalizeArm)) {
        const key = `${r.arm}|${r.run_id}`;
        if (!merged[key]) { merged[key] = { ...r }; }
        else {
            // Sum episode counts, weighted-average rates
            const a = merged[key], b = r;
            const totalN = (a.total_episodes || 0) + (b.total_episodes || 0);
            if (totalN > 0) {
                a.mean_reward    = ((a.mean_reward    || 0) * (a.total_episodes || 0) + (b.mean_reward    || 0) * (b.total_episodes || 0)) / totalN;
                a.goal_rate      = ((a.goal_rate      || 0) * (a.total_episodes || 0) + (b.goal_rate      || 0) * (b.total_episodes || 0)) / totalN;
                a.mean_stress_auc= ((a.mean_stress_auc|| 0) * (a.total_episodes || 0) + (b.mean_stress_auc|| 0) * (b.total_episodes || 0)) / totalN;
            }
            a.total_episodes = totalN;
        }
    }
    _state.metricsData = Object.values(merged);
}
async function _fetchSimStats() {
    try { const r = await fetch(`${config.ORCHESTRATOR_URL}/api/analysis/stats`); if (r.ok) _state.simStats = await r.json(); } catch { _state.simStats = null; }
}
async function _fetchScenarioGoals() {
    try {
        const { rows } = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/scenario-goal-rates`).then(r=>r.json());
        // Merge legacy arm rows into canonical arms — preserve all numeric fields
        const merged = {};
        for (const r of (rows || []).map(_canonicalizeArm)) {
            const key = `${r.arm}|${r.scenario_id}`;
            if (!merged[key]) { merged[key] = { ...r }; }
            else {
                const a = merged[key], b = r;
                const totalN = (a.episode_count || 0) + (b.episode_count || 0);
                const wA = (a.episode_count || 0) / Math.max(1, totalN);
                const wB = (b.episode_count || 0) / Math.max(1, totalN);
                a.goal_rate  = wA * (a.goal_rate  || 0) + wB * (b.goal_rate  || 0);
                a.avg_reward = wA * (a.avg_reward  ?? 0) + wB * (b.avg_reward  ?? 0);
                if (a.min_reward != null || b.min_reward != null)
                    a.min_reward = Math.min(a.min_reward ?? Infinity, b.min_reward ?? Infinity);
                if (a.max_reward != null || b.max_reward != null)
                    a.max_reward = Math.max(a.max_reward ?? -Infinity, b.max_reward ?? -Infinity);
                a.episode_count = totalN;
            }
        }
        _state.scenarioGoalData = Object.values(merged);
    } catch { _state.scenarioGoalData = null; }
}
async function _fetchPhysio() {
    try { const { rows } = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/physio-reward`).then(r=>r.json()); _state.physioData = (rows || []).map(_canonicalizeArm); } catch { _state.physioData = null; }
}
async function _fetchCritFail() {
    try {
        const { rows } = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/critical-failures`).then(r=>r.json());
        const merged = {};
        for (const r of (rows || []).map(_canonicalizeArm)) {
            const key = `${r.arm}|${r.scenario_id}`;
            if (!merged[key]) { merged[key] = { ...r }; }
            else {
                merged[key].total_episodes  = (merged[key].total_episodes  || 0) + (r.total_episodes  || 0);
                merged[key].failed_episodes = (merged[key].failed_episodes || 0) + (r.failed_episodes || 0);
            }
        }
        _state.critFailData = Object.values(merged);
    } catch { _state.critFailData = null; }
}
async function _fetchStratifiedGoalRates() {
    try {
        const { rows } = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/stratified-goal-rates`).then(r=>r.json());
        _state.stratifiedGoalRates = (rows || []).map(_canonicalizeArm);
    } catch { _state.stratifiedGoalRates = null; }
}
async function _fetchRewardComponents() {
    try {
        const { rows } = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/reward-components?window=${_state.wmaWindow}`).then(r => r.json());
        _state.rewardComponentData = rows;
    } catch { _state.rewardComponentData = null; }
}
async function _fetchCheckpoints() {
    try {
        const { rows } = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/checkpoints`).then(r => r.json());
        _state.checkpointEvents = rows;   // [{arm, episode, stopped, ts}]
    } catch { _state.checkpointEvents = null; }
}
async function _fetchActionStats() {
    try {
        const [sumResp, scResp] = await Promise.all([
            fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/action-stats`).then(r => r.json()),
            fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/action-stats-by-scenario`).then(r => r.json()),
        ]);
        _state.actionStatsData        = (sumResp.rows  || []).map(_canonicalizeArm);
        _state.actionStatsByScenario  = (scResp.rows   || []).map(_canonicalizeArm);
    } catch { _state.actionStatsData = null; _state.actionStatsByScenario = null; }
}

// -- Toolbar -----------------------------------------------------------------
function _attachToolbar() {
    const rawCb = document.getElementById('show-raw-traces');
    if (rawCb) {
        rawCb.title = 'Show individual episode reward dots behind the Weighted Moving Average line.';
        rawCb.addEventListener('change', () => { _state.showRawTraces = rawCb.checked; _renderLearningCurves(); _renderGoalRateChart(); _renderCritFailRateChart(); _renderStressAucChart(); });
        const lbl = rawCb.closest('label') || rawCb.parentElement;
        if (lbl && !lbl.querySelector('.trace-tooltip-hint')) {
            const hint = document.createElement('span');
            hint.className = 'trace-tooltip-hint'; hint.title = rawCb.title; hint.textContent = ' ?';
            hint.style.cssText = 'cursor:help;color:var(--gray-500);font-size:12px;';
            lbl.appendChild(hint);
        }
    }
    const sdCb = document.getElementById('show-sd-band');
    if (sdCb) sdCb.addEventListener('change', () => { _state.showSD = sdCb.checked; _renderLearningCurves(); _renderGoalRateChart(); _renderCritFailRateChart(); _renderStressAucChart(); });
    const critCb = document.getElementById('show-crit-fail');
    if (critCb) critCb.addEventListener('change', () => { _state.showCritFail = critCb.checked; _renderLearningCurves(); });
    const durSel = document.getElementById('duration-filter');
    if (durSel) durSel.addEventListener('change', () => { _state.durationDays = parseInt(durSel.value) || 0; _renderAll(); });

    const wmaSlider = document.getElementById('wma-window');
    const wmaVal = document.getElementById('wma-window-val');
    if (wmaSlider) {
        wmaSlider.value = _state.wmaWindow;
        wmaSlider.addEventListener('input', () => {
            _state.wmaWindow = parseInt(wmaSlider.value);
            if (wmaVal) wmaVal.textContent = _state.wmaWindow;
        });
        wmaSlider.addEventListener('change', async () => {
            await _fetchTimeline();
            _renderLearningCurves(); _renderGoalRateChart(); _renderCritFailRateChart(); _renderStressAucChart(); _renderRewardStatsTable();
        });
    }

    document.querySelectorAll('[data-exp-toggle]').forEach(btn => {
        btn.addEventListener('click', () => {
            const exp = btn.dataset.expToggle;
            if (_state.activeExperiments.has(exp)) _state.activeExperiments.delete(exp);
            else _state.activeExperiments.add(exp);
            btn.classList.toggle('inactive', !_state.activeExperiments.has(exp));
            _renderLearningCurves(); _renderGoalRateChart(); _renderCritFailRateChart(); _renderStressAucChart();
            _renderMetricBars(); _renderCritFailTable(); _renderPhysioScatter();
        });
    });

    // ── Group show/hide buttons: toggle the row of per-arm toggle buttons ────
    ['base', 'ablation', 'dpo'].forEach(group => {
        const btn = document.getElementById(`group-toggle-${group}`);
        const row = document.querySelector(`[data-exp-group="${group}"]`);
        if (!btn || !row) return;
        btn.addEventListener('click', () => {
            const nowVisible = row.style.display !== 'none' && row.style.display !== '';
            row.style.display = nowVisible ? 'none' : 'flex';
            btn.classList.toggle('inactive', nowVisible);
        });
    });
}

function _renderAll() {
    // ── Always-visible (above the fold) — render immediately ──────────────────
    _renderSimOverview();
    _renderRewardStatsTable();
    _renderRecentStatsTable();
    _renderLearningCurves();
    _renderGoalRateChart();
    _renderCritFailRateChart();
    _renderStressAucChart();

    // ── Below the fold — defer until scrolled into view ────────────────────────
    _lazyRender('reward-stats-section',       _renderCumulativeRewardDist);
    _lazyRender('reward-component-charts-section', _renderRewardComponentCharts);
    _lazyRender('metric-bars-section',        _renderMetricBars);
    _lazyRender('cost-charts-section',        _renderCostCharts);
    _lazyRender('scenario-heatmap-section', _renderScenarioHeatmap);
    _lazyRender('scenario-goal-section',      _renderScenarioGoalRates);
    _lazyRender('scenario-reward-section',    _renderScenarioRewardStats);
    _lazyRender('sensor-comparison-section',  _renderSensorComparison);
    _lazyRender('crit-fail-section',          () => { _renderCritFailStats(); _renderCritFailTable(); });
    _lazyRender('stratified-goal-section',    _renderStratifiedGoalRates);
    _lazyRender('physio-section',             _renderPhysioScatter);
    _lazyRender('action-stats-section',       _renderActionStatsTable);
}

// -- Helpers ------------------------------------------------------------------
function _filterByDuration(rows) {
    if (!_state.durationDays || !rows?.length) return rows;
    const cutoff = Date.now() - _state.durationDays * 86400000;
    return rows.filter(r => r.started_at >= cutoff);
}
function _showSpinner(on) { const s = document.getElementById('bench-refresh-spinner'); if (s) s.style.display = on ? 'inline' : 'none'; }
function _destroyChart(id) {
    const cv = document.getElementById(id);
    if (cv) { const c = Chart.getChart(cv); if (c) c.destroy(); }
    return cv;
}

// ── Lazy chart rendering via IntersectionObserver ─────────────────────────────
// Charts that are not in the initial viewport (reward components, scenario
// heatmap, cost charts, etc.) are deferred until they scroll into view.
// This is the single biggest render-time win: Chart.js initialisation for
// off-screen canvases is skipped entirely on load.
//
// Usage: _lazyRender(canvasId, renderFn)
//   - canvasId   : the canvas or its wrapper element id
//   - renderFn   : zero-arg function that creates the chart
//
// If IntersectionObserver is unavailable (e.g. Node test env) the fn is called
// immediately as a fallback.
const _lazyObserved = new Map();   // id → { fn, rendered }
const _lazyObserver = (typeof IntersectionObserver !== 'undefined')
    ? new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const rec = _lazyObserved.get(entry.target.id);
            if (rec && !rec.rendered) {
                rec.rendered = true;
                rec.fn();
            }
            _lazyObserver.unobserve(entry.target);
        }
    }, { rootMargin: '200px' })   // start rendering 200px before entering viewport
    : null;

function _lazyRender(wrapperId, renderFn) {
    const el = document.getElementById(wrapperId);
    if (!el || !_lazyObserver) { renderFn(); return; }
    _lazyObserved.set(wrapperId, { fn: renderFn, rendered: false });
    _lazyObserver.observe(el);
}

// Reset all lazy records (called at the start of each _refresh so charts
// re-render with fresh data when the user clicks ↻ Refresh).
function _resetLazy() {
    for (const [id] of _lazyObserved) {
        const el = document.getElementById(id);
        if (el) _lazyObserver?.unobserve(el);
    }
    _lazyObserved.clear();
}

// Build line datasets using episode index as x-axis (per arm).
// At each run_restart boundary, a single null point is inserted for a visual
// break ? indicating a code change / restart, NOT idle time.
// No whitespace is introduced for idle periods between runs.
// missing_arm_slot=true rows are shown as tiny error markers (red ?) to
// distinguish "arm fell behind because of errors" from "arm simply hasn't run yet".
//
// Legacy arms (htn_mcts, hysteresis_prompt) are merged into their canonical
// counterparts before building datasets so the full historical data is visible.

// Shared zoom/pan config applied to every line chart.
// Wheel zoom requires Ctrl/Cmd held (standard UX: scroll = page, Ctrl+scroll = zoom)
// so normal page scrolling is never blocked.
// Pinch (touch) zoom is always enabled without modifier.
const _ZOOM_PLUGIN = {
    zoom: {
        wheel:  { enabled: true, modifierKey: 'ctrl', speed: 0.1 },
        pinch:  { enabled: true },
        mode:   'x',
    },
    pan: {
        enabled: true,
        mode:    'x',
        // Only pan when the user holds the mouse button; free scroll otherwise.
        modifierKey: null,
    },
    limits: { x: { min: 'original', max: 'original' } },
};

// Shared options block for every line chart in the dashboard.
// animation:false + tension:0 are the two biggest render-time wins for
// large episode datasets (1k+ points per arm × 8 arms = 8k+ points).
// Straight-line segments (tension=0) avoid per-frame bezier recalculation;
// animation:false skips the 60fps draw loop entirely on first paint.
const _LINE_CHART_OPTIONS = {
    responsive: true, maintainAspectRatio: false,
    animation: false,
    elements: { line: { tension: 0.3 } },
    interaction: { mode: 'index', intersect: false },
};

function _mergeRows(rows) {
    if (!rows?.length) return rows;
    return rows.map(r => {
        const canonical = LEGACY_ALIAS[r.arm];
        if (!canonical) return r;
        return { ...r, arm: canonical, _legacy: true };
    });
}

/**
 * Build per-arm line datasets.  Each arm's x-axis is its own episode index
 * starting at 1 — no cross-arm alignment or run offsets.  The tooltip looks up
 * per-episode metadata (scenario, run, goal, reward) directly from the row array
 * stored on the dataset as `_rows`.
 */
function _buildLineDatasets(rows, yKey, wmaKey) {
    const datasets = [];
    _state._lineOffsets = {};   // kept for tooltip compat — always 0 now

    for (const [arm, meta] of Object.entries(EXP_META)) {
        if (!_state.activeExperiments.has(arm)) continue;
        const ep = rows.filter(r => r.arm === arm);
        if (!ep.length) continue;

        _state._lineOffsets[arm] = 0;

        const data = ep.map((r, i) => {
            const yVal = r[wmaKey ?? yKey];
            return { x: i + 1, y: (yVal != null) ? yVal : null };
        });

        datasets.push({
            label: meta.label,
            data,
            borderColor: meta.color, backgroundColor: 'transparent',
            borderWidth: 2.5, pointRadius: 0, tension: 0.3,
            spanGaps: true,
            order: 1,
            _arm: arm,
            _rows: ep,   // per-episode metadata for tooltip
        });

        if (_state.showSD && wmaKey === 'smoothed_reward') {
            const sdData    = ep.map((r, i) => ({ x: i + 1, y: r.smoothed_reward + r.stddev }));
            const sdDataLow = ep.map((r, i) => ({ x: i + 1, y: Math.max(0, r.smoothed_reward - r.stddev) }));
            datasets.push({ label: '_+sd', data: sdData,    borderColor: 'transparent', backgroundColor: meta.bg, fill: '+1', pointRadius: 0, tension: 0.3, spanGaps: true, order: 3 });
            datasets.push({ label: '_-sd', data: sdDataLow, borderColor: 'transparent', backgroundColor: meta.bg, fill: false, pointRadius: 0, tension: 0.3, spanGaps: true, order: 3 });
        }

        if (_state.showRawTraces && yKey) {
            datasets.push({ label: '_raw', data: ep.map((r, i) => ({ x: i + 1, y: r[yKey] })), borderColor: meta.color, backgroundColor: meta.color + '44', borderWidth: 0, pointRadius: 2.5, showLine: false, order: 2, _arm: arm, _rows: ep });
        }
    }
    return datasets;
}

/**
 * Shared tooltip callbacks for all line charts.
 *
 * `label` — shows "Exp N: <value>  (ep <actualEpisode>)" for every active arm,
 *            including arms that have no point at the hovered x (shown as "—")
 *            so the user always sees all 8 experiments in one tooltip.
 *
 * `footer` — for the learning-curve chart, shows per-episode metadata
 *            (scenario, run, turns, reward) for the arm whose label the user
 *            is closest to.  Only the learning-curve chart passes `withFooter`.
 *
 * @param {string} [valueFormat='decimal'] - 'decimal' or 'percent'
 * @param {boolean} [withFooter=false]     - include the metadata footer row
 */
function _lineTooltipCallbacks(valueFormat = 'decimal', withFooter = false) {
    return {
        // Replace the default per-dataset label with episode-number-aware text.
        label(item) {
            if (item.dataset.label?.startsWith('_')) return null;
            const arm = item.dataset._arm;
            if (!arm) return item.dataset.label;
            const displayX = item.parsed.x;
            const offset   = _state._lineOffsets?.[arm] ?? 0;
            const epNum    = Math.round(displayX - offset);
            const yVal     = item.parsed.y;
            const valStr   = (yVal == null) ? '—'
                : valueFormat === 'percent' ? (yVal * 100).toFixed(1) + '%'
                : yVal.toFixed(3);
            return `${item.dataset.label}: ${valStr}  (ep ${epNum > 0 ? epNum : '—'})`;
        },

        labelColor(item) {
            const arm = item.dataset._arm;
            if (!arm || item.dataset.label?.startsWith('_')) return undefined;
            const meta = EXP_META[arm];
            if (!meta) return undefined;
            return { borderColor: meta.color, backgroundColor: meta.color };
        },

        footer: withFooter ? function(items) {
            const item = items.find(i => !i.dataset.label?.startsWith('_'));
            if (!item) return [];
            const arm      = item.dataset._arm;
            const displayX = item.parsed.x;
            const offset   = _state._lineOffsets?.[arm] ?? 0;
            const epNum    = Math.round(displayX - offset);
            const allRows  = _state.timelineData?.episodes || _state.timelineData || [];
            const armRows  = allRows.filter(r => r.arm === arm);
            const d        = armRows[epNum - 1];
            if (!d) return [];
            return [
                `─── ${EXP_META[arm]?.label ?? arm} ───`,
                `Run: ${d.run_label ?? '?'}`,
                `Scenario: ${d.scenario_id ?? '?'}`,
                `Turns: ${d.turn_count ?? '?'}  |  R/turn: ${d.reward_per_turn?.toFixed(3) ?? '?'}`,
                `Cumul. reward: ${d.cumulative_reward?.toFixed(3) ?? '?'}`,
                `Stress AUC: ${d.stress_auc?.toFixed(3) ?? '?'}`,
            ];
        } : undefined,
    };
}

/**
 * Build a Chart.js `external` tooltip renderer that produces a fully styled
 * HTML tooltip showing ALL active experiments — including those with no data
 * at the hovered x — with correct color swatches for every row.
 *
 * Drop-in replacement for the `tooltip.callbacks` approach.  To use, pass
 *   tooltip: { mode: 'index', intersect: false, external: _buildExternalTooltip(valueFormat) }
 * in the chart options (omit `callbacks` entirely).
 *
 * @param {string} [valueFormat='decimal'] - 'decimal' or 'percent'
 * @param {boolean} [withFooter=false]     - append per-episode metadata block
 */
/**
 * Build a styled external tooltip for bar charts (categorical x-axis).
 * Shows arm name, value, and optional n-count with color swatch.
 */
function _buildBarExternalTooltip(valueFormat = 'decimal') {
    return function barTooltip({ chart, tooltip }) {
        let el = chart.canvas.parentNode.querySelector('.cj-ext-tooltip');
        if (!el) {
            el = document.createElement('div');
            el.className = 'cj-ext-tooltip';
            el.style.cssText = [
                'position:absolute', 'pointer-events:none', 'z-index:999',
                'background:rgba(20,20,30,0.92)', 'border:1px solid rgba(255,255,255,0.15)',
                'border-radius:6px', 'padding:8px 12px', 'font-size:11px',
                'color:#e8e8e8', 'line-height:1.7', 'min-width:200px',
                'max-width:320px', 'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
                'white-space:nowrap',
            ].join(';');
            chart.canvas.parentNode.style.position = 'relative';
            chart.canvas.parentNode.appendChild(el);
        }
        if (tooltip.opacity === 0) { el.style.opacity = '0'; return; }

        const title = tooltip.dataPoints?.[0]?.label ?? '';
        let html = `<div style="font-weight:700;margin-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.2);padding-bottom:4px">${title}</div>`;

        for (const item of (tooltip.dataPoints || [])) {
            const arm   = item.dataset._arm;
            const meta  = arm ? EXP_META[arm] : null;
            const color = item.dataset.borderColor
                ?? (Array.isArray(item.dataset.backgroundColor)
                    ? item.dataset.backgroundColor[item.dataIndex]
                    : item.dataset.backgroundColor)
                ?? '#888';
            const label = meta?.label ?? item.dataset.label ?? '';
            const n     = item.dataset._epCounts?.[item.dataIndex];
            const val   = item.parsed.y;
            const valStr = val == null ? '—'
                : valueFormat === 'percent' ? `<b>${(val * 100).toFixed(1)}%</b>`
                : `<b>${val.toFixed(3)}</b>`;
            const nStr  = n != null ? `<span style="opacity:0.6;font-size:10px;margin-left:6px">n=${n}</span>` : '';
            html += `<div style="display:flex;align-items:center;gap:6px">
                <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></span>
                <span>${label}:&nbsp;${valStr}${nStr}</span></div>`;
        }

        el.innerHTML = html;
        el.style.opacity = '1';
        const pos = chart.canvas.getBoundingClientRect();
        const cx  = tooltip.caretX;
        const cy  = tooltip.caretY;
        el.style.left = (cx + 14) + 'px';
        el.style.top  = Math.max(0, cy - 20) + 'px';
    };
}


function _buildExternalTooltip(valueFormat = 'decimal', withFooter = false) {
    return function externalTooltip({ chart, tooltip }) {
        // Get or create the HTML tooltip element
        let el = chart.canvas.parentNode.querySelector('.cj-ext-tooltip');
        if (!el) {
            el = document.createElement('div');
            el.className = 'cj-ext-tooltip';
            el.style.cssText = [
                'position:absolute', 'pointer-events:none', 'z-index:999',
                'background:rgba(20,20,30,0.92)', 'border:1px solid rgba(255,255,255,0.15)',
                'border-radius:6px', 'padding:8px 12px', 'font-size:11px',
                'color:#e8e8e8', 'line-height:1.6', 'min-width:220px',
                'max-width:340px', 'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
                'white-space:nowrap',
            ].join(';');
            chart.canvas.parentNode.style.position = 'relative';
            chart.canvas.parentNode.appendChild(el);
        }

        if (tooltip.opacity === 0) { el.style.opacity = '0'; return; }

        // Build dataset lookup keyed by arm: value + row reference
        const armInfo = {};
        for (const item of (tooltip.dataPoints || [])) {
            if (item.dataset.label?.startsWith('_')) continue;
            const arm = item.dataset._arm;
            if (!arm) continue;
            const epNum = Math.round(item.parsed.x);
            const row   = item.dataset._rows?.[epNum - 1] ?? null;
            armInfo[arm] = { y: item.parsed.y, epNum, row };
        }

        // Title: episode index (same per-arm meaning now, no offsets)
        const titleX = tooltip.dataPoints?.find(p => !p.dataset.label?.startsWith('_'))?.parsed?.x ?? '';

        let html = `<div style="font-weight:700;margin-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.2);padding-bottom:4px">
            Episode ${Math.round(titleX)}</div>`;

        // One row per active experiment — in EXP_META order
        for (const [arm, meta] of Object.entries(EXP_META)) {
            if (!_state.activeExperiments.has(arm)) continue;
            const info   = armInfo[arm];
            const yVal   = info?.y;
            const epNum  = info?.epNum;
            const row    = info?.row;
            const epStr  = epNum > 0 ? `ep ${epNum}` : '—';
            const valStr = (yVal == null)
                ? '<span style="opacity:0.45">—</span>'
                : valueFormat === 'percent'
                    ? `<b>${(yVal * 100).toFixed(1)}%</b>`
                    : `<b>${yVal.toFixed(3)}</b>`;
            const dimmed = (yVal == null) ? 'opacity:0.55;' : '';
            html += `<div style="display:flex;align-items:center;gap:6px;${dimmed}">
                <span style="display:inline-block;width:10px;height:10px;border-radius:2px;
                    background:${meta.color};flex-shrink:0"></span>
                <span style="flex:1">${meta.shortLabel}</span>
                <span style="color:${meta.color};font-family:monospace">${valStr}</span>
                <span style="opacity:0.55;font-size:10px">(${epStr})</span>
            </div>`;
        }

        // Footer: per-episode metadata for the hovered arm (learning curves / any chart with _rows)
        if (withFooter) {
            const item = tooltip.dataPoints?.find(p => !p.dataset.label?.startsWith('_') && p.dataset._rows);
            if (item) {
                const epNum = Math.round(item.parsed.x);
                const d     = item.dataset._rows?.[epNum - 1];
                const arm   = item.dataset._arm;
                if (d) {
                    const runTag  = d.run_label?.replace(/^run_0*/, 'R') ?? '?';
                        const goalTag = d.goal_achieved ? '✓ GOAL' : (d.goal_achieved === 0 ? '✗ miss' : '—');
                    html += `<div style="margin-top:6px;padding-top:4px;
                        border-top:1px solid rgba(255,255,255,0.15);font-size:10px;opacity:0.8">
                        <div><b>${EXP_META[arm]?.label ?? arm}</b></div>
                        <div>Run: ${runTag} | Ep: ${epNum}</div>
                        <div>Scenario: ${d.scenario_id?.replace(/^js_/, '') ?? '?'}</div>
                        <div>Turns: ${d.turn_count ?? '?'} | R/turn: ${d.reward_per_turn?.toFixed(3) ?? '?'}</div>
                        <div>Cumul R: ${d.cumulative_reward?.toFixed(2) ?? '?'} | Stress AUC: ${d.stress_auc?.toFixed(3) ?? '?'}</div>
                        <div>${goalTag}</div>
                    </div>`;
                }
            }
        }

        el.innerHTML = html;
        el.style.opacity = '1';

        // Position: follow cursor, avoid overflow
        const canvasRect = chart.canvas.getBoundingClientRect();
        const parentRect = chart.canvas.parentNode.getBoundingClientRect();
        const cx = tooltip.caretX;
        const cy = tooltip.caretY;
        const elW = el.offsetWidth || 260;
        const elH = el.offsetHeight || 160;
        let left = cx + 12;
        let top  = cy - elH / 2;
        if (left + elW > canvasRect.width) left = cx - elW - 12;
        if (top < 0) top = 4;
        if (top + elH > canvasRect.height) top = canvasRect.height - elH - 4;
        el.style.left = left + 'px';
        el.style.top  = top  + 'px';
    };
}

// Restart annotations — episode-index axis
// Only two kinds of markers are shown:
//   1. Grey dashed vertical line at each run_restart boundary (code change / restart)
//   2. Amber vertical line labelled "STOP" where STOP_AT_CHECKPOINT was honoured
// Periodic checkpoint bars (every N episodes) were removed — they provided no
// analytical signal and cluttered the chart at high episode counts.
//
// Additionally, a bold purple "NEW EXPERIMENTS" line is drawn at the episode
// boundary where the 6-experiment redesign begins (first episode with a new ARM string).
// This makes the train-then-continue boundary visually unambiguous.
function _buildRestartAnnotations() {
    const annotations = {};

    const allRows = _state.timelineData?.episodes || _state.timelineData || [];

    // Compute right-align offsets matching _buildLineDatasets
    const armEpCounts = {};
    for (const [arm] of Object.entries(EXP_META)) {
        if (!_state.activeExperiments.has(arm)) continue;
        const n = allRows.filter(r => r.arm === arm).length;
        if (n) armEpCounts[arm] = n;
    }
    const globalMax = Math.max(1, ...Object.values(armEpCounts));

    // ── Run-restart lines (grey dashed) ──────────────────────────────────────
    // Draws a dashed line only at *true* training-session boundaries — i.e. when
    // the agent was stopped and then restarted at a different time.
    //
    // The problem with a simple episode-count threshold:
    //   Within one session, two workers share the same arm and interleave their
    //   episodes in time order.  Each worker has its own run_id, so consecutive
    //   rows alternate between two run_ids hundreds of times.  Even a high
    //   episode-count threshold doesn't help because each worker can accumulate
    //   100+ episodes of its own.
    //
    // Correct heuristic — detect interleaved (concurrent) run pairs:
    //   If run_id A and run_id B alternate back and forth ≥ 3 times, they are
    //   concurrent workers in the same session.  Mark that pair as "concurrent"
    //   and suppress all restart lines between them.
    //   A true restart only ever transitions once: all of run A, then all of run B.
    for (const [arm] of Object.entries(EXP_META)) {
        if (!_state.activeExperiments.has(arm)) continue;
        const ep = allRows.filter(r => r.arm === arm);
        const offset = globalMax - ep.length;

        // Count back-and-forth transitions between every pair of run_ids
        const pairTransitions = {};   // "idA|idB" (sorted) → count
        for (let i = 1; i < ep.length; i++) {
            if (ep[i].run_id !== ep[i - 1].run_id) {
                const pair = [ep[i - 1].run_id, ep[i].run_id].sort().join('|');
                pairTransitions[pair] = (pairTransitions[pair] || 0) + 1;
            }
        }
        // Pairs that alternate ≥ 3 times are concurrent workers — not restarts
        const concurrentPairs = new Set(
            Object.entries(pairTransitions)
                .filter(([, n]) => n >= 3)
                .map(([pair]) => pair),
        );

        // Only count episodes per run_id for large-run sanity check (≥ 30 eps)
        const runCounts = {};
        for (const r of ep) runCounts[r.run_id] = (runCounts[r.run_id] || 0) + 1;

        let prevRunId = null;
        ep.forEach((r, i) => {
            if (r.run_restart && i > 0 && prevRunId) {
                const pair = [prevRunId, r.run_id].sort().join('|');
                const isConcurrent = concurrentPairs.has(pair);
                const prevCount    = runCounts[prevRunId] || 0;
                const thisCount    = runCounts[r.run_id]  || 0;
                // Draw only if not a concurrent pair AND both runs are substantial
                if (!isConcurrent && prevCount >= 30 && thisCount >= 30) {
                    annotations[`restart_${arm}_${i}`] = {
                        type: 'line', scaleID: 'x', value: offset + i + 1,
                        borderColor: '#bbb', borderWidth: 1, borderDash: [4, 4],
                        label: { display: false },
                    };
                }
            }
            prevRunId = r.run_id;
        });
    }

    // Stop-at-checkpoint lines were removed per user request.
    // The checkpoint events are still stored in the DB but not rendered
    // as visual interruptions in the line charts (they added visual noise
    // without conveying actionable information in the current workflow).

    // ── Legacy → new experiment rename boundary (gray solid line) ────────────
    // Drawn at the right-aligned x position where legacy data ends.
    for (const [legacyArm, canonArm] of Object.entries(LEGACY_ALIAS)) {
        if (!_state.activeExperiments.has(canonArm)) continue;
        const legacyCount = allRows.filter(r => r.arm === legacyArm).length;
        const canonCount  = allRows.filter(r => r.arm === canonArm).length;
        if (legacyCount > 0 && canonCount > 0) {
            const totalForArm = legacyCount + canonCount;
            const offset      = globalMax - totalForArm;
            annotations[`legacy_boundary_${canonArm}`] = {
                type: 'line', scaleID: 'x', value: offset + legacyCount,
                borderColor: '#9ca3af', borderWidth: 1.5, borderDash: [0, 0],
                label: { display: false },
            };
        }
    }

    return annotations;
}
function _renderLagBadges(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const counts = _state.armEpisodeCounts || {};
    if (!Object.keys(counts).length) return;
    const maxEps = Math.max(...Object.values(counts));
    const parts = EXP_KEYS
        .filter(arm => _state.activeExperiments.has(arm) && counts[arm])
        .map(arm => {
            const n   = counts[arm];
            const lag = maxEps - n;
            const meta = EXP_META[arm];
            const badge = lag > 0
                ? `<span style="background:${meta.color}22;border:1px solid ${meta.color};color:${meta.color};padding:1px 7px;border-radius:10px;font-size:11px;margin-right:4px;">${meta.shortLabel}: ${n} eps (-${lag})</span>`
                : `<span style="background:${meta.color}22;border:1px solid ${meta.color};color:${meta.color};padding:1px 7px;border-radius:10px;font-size:11px;margin-right:4px;font-weight:600;">${meta.shortLabel}: ${n} eps ?</span>`;
            return badge;
        });
    el.innerHTML = `<div style="margin-top:4px;padding:4px 0;">${parts.join('')}</div>`;
}

// -- Sim Overview -------------------------------------------------------------
function _renderSimOverview() {
    const el = document.getElementById('simulation-overview-stats');
    if (!el) return;
    // metricsData is already canonical (merged in _fetchMetrics)
    const dbRows = _state.metricsData || [];
    const total = dbRows.reduce((a, r) => a + (r.total_episodes || 0), 0);
    const runs  = new Set(dbRows.map(r => r.run_id)).size;
    let peakSmoothed = 0;
    (_state.timelineData || []).forEach(r => { if ((r.smoothed_reward || 0) > peakSmoothed) peakSmoothed = r.smoothed_reward; });
    const goalSum  = dbRows.reduce((a, r) => a + (r.goal_rate || 0) * (r.total_episodes || 0), 0);
    const goalRate = total ? (goalSum / total * 100).toFixed(1) + '%' : '?';
    // Count active experiments: any arm that has at least one completed episode in
    // either metricsData or timelineData.  This ensures arms that have completed
    // episodes but no turn rows (e.g. HPVOOT arms) are still counted.
    const timelineArms = new Set((_state.timelineData || []).map(r => r.arm));
    const metricsArms  = new Set(dbRows.map(r => r.arm));
    const activeExpCount = EXP_KEYS.filter(k => metricsArms.has(k) || timelineArms.has(k)).length;
    el.innerHTML = `
        <div class="stat-card"><span class="stat-value">${total}</span><span class="stat-label">Training Episodes</span></div>
        <div class="stat-card"><span class="stat-value">${runs}</span><span class="stat-label">Training Runs</span></div>
        <div class="stat-card"><span class="stat-value">${goalRate}</span><span class="stat-label">Overall Goal Rate</span></div>
        <div class="stat-card" title="Peak ${_state.wmaWindow}-episode Weighted Moving Average of cumulative per-turn reward">
            <span class="stat-value">${peakSmoothed.toFixed(2)}</span>
            <span class="stat-label">Peak WMA Reward ⓘ</span>
        </div>
        <div class="stat-card"><span class="stat-value">${activeExpCount}</span><span class="stat-label">Active Experiments</span></div>
    `;
}

// -- Reward Stats Table -------------------------------------------------------
function _renderRewardStatsTable() {
    // Always use last-100 window — full-history mean is invalid once training
    // process or reward function changes mid-run.
    _renderStatsTableInto('reward-stats-table', 100);
}

/**
 * Render the "last N episodes" stats table.
 * N is read from the #recent-stats-n input (default 100).
 */
function _renderRecentStatsTable() {
    const n = parseInt(document.getElementById('recent-stats-n')?.value || '100', 10) || 100;
    _renderStatsTableInto('recent-stats-table', n);
}

/**
 * Core stats table renderer used by both all-time and recent-N variants.
 *
 * @param {string} targetId  - DOM element id to write into
 * @param {number|null} lastN - if non-null, only use the last N episodes per arm
 */
function _renderStatsTableInto(targetId, lastN) {
    const el = document.getElementById(targetId);
    // Use the full stats timeline (has cumulative_reward, stress_auc, etc.)
    // If not yet loaded, kick off a fetch and re-render when it arrives.
    if (!_state.statsTimelineData?.length) {
        if (!_state.statsTimelineData) {
            _state.statsTimelineData = [];   // prevent duplicate fetches
            _fetchTimelineForStats().then(() => {
                _renderStatsTableInto(targetId, lastN);
            });
        }
        if (el) el.innerHTML = '<p style="font-size:12px;color:var(--gray-400);padding:8px;">Loading…</p>';
        return;
    }
    if (!el) return;

    const allRows = _filterByDuration(_state.statsTimelineData) ?? [];

    // Show all arms that have any data — not limited to activeExperiments
    const stats = EXP_KEYS.map(arm => {
        let ep = allRows.filter(r => r.arm === arm);
        if (!ep.length) return null;
        // Slice to the last N if requested (most recent = end of sorted array)
        if (lastN != null && ep.length > lastN) ep = ep.slice(ep.length - lastN);

        const vals = ep.map(r => r.cumulative_reward).filter(v => v != null);
        if (!vals.length) return null;
        const mean    = vals.reduce((a, b) => a + b, 0) / vals.length;
        const sd      = Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length);
        const goalPct = (ep.filter(r => r.goal_achieved).length / ep.length * 100).toFixed(1);
        const critFailPct = (ep.filter(r => r.critical_failure === 1 || r.critical_failure === true).length / ep.length * 100).toFixed(1);
        const stressVals  = ep.map(r => r.stress_auc).filter(v => v != null);
        const stressMean  = stressVals.length
            ? (stressVals.reduce((a, b) => a + b, 0) / stressVals.length).toFixed(3) : '—';
        return { arm, meta: EXP_META[arm], n: vals.length, totalAvail: allRows.filter(r => r.arm === arm).length,
                 min: Math.min(...vals).toFixed(2), max: Math.max(...vals).toFixed(2),
                 mean: mean.toFixed(2), sd: sd.toFixed(2), goalPct, critFailPct, stressMean };
    }).filter(Boolean);

    const nLabel = lastN != null ? `(last&nbsp;${lastN})` : '';
    el.innerHTML = `<table style="border-collapse:collapse;width:100%;font-size:12px;">
        <thead><tr style="background:var(--gray-50);border-bottom:1px solid var(--gray-200);">
            <th style="text-align:left;padding:6px 10px;">Experiment</th>
            <th style="padding:6px 10px;" title="Episodes included in this window">N ${nLabel}</th>
            <th style="padding:6px 10px;">Min</th>
            <th style="padding:6px 10px;">Max</th>
            <th style="padding:6px 10px;">Mean &plusmn; SD</th>
            <th style="padding:6px 10px;">Goal %</th>
            <th style="padding:6px 10px;" title="Episodes where the scorer flagged a critical failure (harmful/unsafe turn)">Crit Fail %</th>
            <th style="padding:6px 10px;" title="Mean calmness AUC: (1−stress). Higher is calmer.">Stress AUC ↑</th>
        </tr></thead>
        <tbody>${stats.map(s => {
            const sliced = lastN != null && s.n < s.totalAvail;
                const failColor = parseFloat(s.critFailPct) > 5 ? 'color:#d32f2f;font-weight:600;' : '';
            return `<tr style="border-bottom:1px solid var(--gray-100);">
                <td style="padding:6px 10px;">
                    <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.meta.color};margin-right:6px;"></span>
                    ${s.meta.label}
                </td>
                <td style="text-align:center;padding:6px 10px;">
                    ${s.n}${sliced ? `<span style="color:var(--gray-400);font-size:10px;"> /${s.totalAvail}</span>` : ''}
                </td>
                <td style="text-align:center;padding:6px 10px;">${s.min}</td>
                <td style="text-align:center;padding:6px 10px;">${s.max}</td>
                <td style="text-align:center;padding:6px 10px;">${s.mean} &plusmn; ${s.sd}</td>
                <td style="text-align:center;padding:6px 10px;">${s.goalPct}%</td>
                <td style="text-align:center;padding:6px 10px;${failColor}">${s.critFailPct}%</td>
                <td style="text-align:center;padding:6px 10px;">${s.stressMean}</td>
            </tr>`;
        }).join('')}</tbody>
    </table>`;
}

// -- Learning Curves ----------------------------------------------------------
function _renderLearningCurves() {
    if (typeof Chart === 'undefined') return;
    const canvas = _destroyChart('learning-curves-chart');
    if (!canvas) return;
    const rows = _filterByDuration(_state.timelineData);
    if (!rows?.length) return;

    const datasets = _buildLineDatasets(rows, 'reward_per_turn', 'smoothed_reward');

    if (_state.showCritFail) {
        for (const [arm, meta] of Object.entries(EXP_META)) {
            if (!_state.activeExperiments.has(arm)) continue;
            const armRows = rows.filter(r => r.arm === arm);
            const fails = armRows
                .map((r, i) => ({ r, i }))
                .filter(({ r }) => r.goal_achieved === 0);
            if (fails.length) datasets.push({
                label: '_fail_' + arm,
                data: fails.map(({ r, i }) => ({ x: i + 1, y: r.cumulative_reward ?? 0 })),
                borderColor: '#c62828', backgroundColor: '#c6282899',
                borderWidth: 1.5, pointRadius: 6, pointStyle: 'crossRot', showLine: false, order: 0,
            });
        }
    }

    new Chart(canvas, {
        type: 'line', data: { datasets },
        options: {
            ..._LINE_CHART_OPTIONS,
            scales: {
                x: { type: 'linear', title: { display: true, text: 'Episode # (per arm)', font: { size: 11 } }, ticks: { callback: v => Math.round(v) } },
                y: { title: { display: true, text: 'Reward per Turn (WMA)', font: { size: 11 } } },
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, filter: i => !i.text.startsWith('_') } },
                zoom: _ZOOM_PLUGIN,
                tooltip: { mode: 'index', intersect: false, external: _buildExternalTooltip('decimal', true) },
            },
        },
    });
    _renderLagBadges('learning-curves-lag');
}

// -- Goal Rate Chart ----------------------------------------------------------
function _renderGoalRateChart() {
    if (typeof Chart === 'undefined') return;
    const canvas = _destroyChart('goal-rate-chart');
    if (!canvas) return;
    const rows = _filterByDuration(_state.timelineData);
    if (!rows?.length) return;
    const datasets = _buildLineDatasets(rows, 'goal_achieved', 'goal_rate_wma');
    new Chart(canvas, {
        type: 'line', data: { datasets },
        options: {
            ..._LINE_CHART_OPTIONS,
            scales: {
                x: { type: 'linear', title: { display: true, text: 'Episode # (per arm)', font: { size: 11 } }, ticks: { callback: v => Math.round(v) } },
                y: { min: 0, max: 1, title: { display: true, text: 'Goal Rate (WMA)', font: { size: 11 } }, ticks: { callback: v => (v*100).toFixed(0)+'%' } },
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, filter: i => !i.text.startsWith('_') } },
                zoom: _ZOOM_PLUGIN,
                tooltip: { mode: 'index', intersect: false, external: _buildExternalTooltip('percent') },
            },
        },
    });
    _renderLagBadges('goal-rate-lag');
}

// -- Critical Failure Rate Chart (time-series WMA) ----------------------------
function _renderCritFailRateChart() {
    if (typeof Chart === 'undefined') return;
    const canvas = _destroyChart('crit-fail-rate-chart');
    if (!canvas) return;
    const rows = _filterByDuration(_state.timelineData);
    if (!rows?.length) return;
    const datasets = _buildLineDatasets(rows, 'goal_achieved', 'crit_fail_rate_wma');
    new Chart(canvas, {
        type: 'line', data: { datasets },
        options: {
            ..._LINE_CHART_OPTIONS,
            scales: {
                x: { type: 'linear', title: { display: true, text: 'Episode # (per arm)', font: { size: 11 } }, ticks: { callback: v => Math.round(v) } },
                y: { min: 0, max: 1, title: { display: true, text: 'Critical Failure Rate (WMA)', font: { size: 11 } },
                     ticks: { callback: v => (v * 100).toFixed(0) + '%' } },
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, filter: i => !i.text.startsWith('_') } },
                zoom: _ZOOM_PLUGIN,
                tooltip: { mode: 'index', intersect: false, external: _buildExternalTooltip('percent') },
            },
        },
    });
    _renderLagBadges('crit-fail-rate-lag');
}

// -- Stress AUC Chart ----------------------------------------------------------
function _renderStressAucChart() {
    if (typeof Chart === 'undefined') return;
    const canvas = _destroyChart('stress-auc-chart');
    if (!canvas) return;
    const rows = _filterByDuration(_state.timelineData);
    if (!rows?.length) return;
    const datasets = _buildLineDatasets(rows, 'stress_auc', 'stress_auc_wma');
    new Chart(canvas, {
        type: 'line', data: { datasets },
        options: {
            ..._LINE_CHART_OPTIONS,
            scales: {
                x: { type: 'linear', title: { display: true, text: 'Episode # (per arm)', font: { size: 11 } }, ticks: { callback: v => Math.round(v) } },
                y: { min: 0, max: 1, title: { display: true, text: 'Stress AUC (↑ better)', font: { size: 11 } } },
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, filter: i => !i.text.startsWith('_') } },
                zoom: _ZOOM_PLUGIN,
                tooltip: { mode: 'index', intersect: false, external: _buildExternalTooltip('decimal') },
            },
        },
    });
}

// -- Scenario Heatmap ---------------------------------------------------------
function _renderScenarioHeatmap() {
    if (typeof Chart === 'undefined') return;
    const canvas = _destroyChart('scenario-heatmap-chart');
    if (!canvas) return;
    const rows = _filterByDuration(_state.timelineData);
    if (!rows?.length) return;

    const scenarios = [...new Set(rows.map(r => r.scenario_id).filter(Boolean))].sort();

    // Build datasets: one per (arm x run_label) so the tooltip can show the run name.
    // All bars for the same scenario are overlaid at 100% category width ? shortest bar
    // is always visible because bars are ordered tallest-first and rendered with alpha.
    const runsByArm = {};   // arm -> [{run_label, color}] ordered earliest first
    for (const row of rows) {
        if (!row.run_label || !row.arm) continue;
        if (!runsByArm[row.arm]) runsByArm[row.arm] = new Map();
        runsByArm[row.arm].set(row.run_label, true);
    }

    // Pre-aggregate: arm x run_label x scenario_id => [rewards]
    const grid = {};
    for (const row of rows) {
        if (!row.scenario_id || row.cumulative_reward == null || !row.run_label) continue;
        const key = `${row.arm}||${row.run_label}`;
        if (!grid[key]) grid[key] = {};
        if (!grid[key][row.scenario_id]) grid[key][row.scenario_id] = [];
        grid[key][row.scenario_id].push(row.cumulative_reward);
    }

    const datasets = [];
    for (const arm of EXP_KEYS) {
        if (!_state.activeExperiments.has(arm)) continue;
        const meta = EXP_META[arm];
        const runLabels = runsByArm[arm] ? [...runsByArm[arm].keys()] : [];
        const nRuns = runLabels.length || 1;

        runLabels.forEach((runLabel, ri) => {
            // Opacity: latest run is most opaque (front), earliest is most transparent (back).
            // Use order property so Chart.js draws earlier runs behind later runs.
            const alpha = Math.round(60 + (ri / nRuns) * 180).toString(16).padStart(2, '0');
            const key = `${arm}||${runLabel}`;
            const shortRun = runLabel.replace(/.*run_/, 'R').replace(/\s.*/, '');
            datasets.push({
                label: `${meta.label} ? ${shortRun}`,
                _arm: arm,
                _runLabel: runLabel,
                backgroundColor: meta.color + alpha,
                borderColor:     meta.color,
                borderWidth: ri === nRuns - 1 ? 1.5 : 0,  // only outline the latest run
                // Full category width so all runs for a scenario overlap exactly
                barPercentage:      1.0,
                categoryPercentage: 0.85,
                data: scenarios.map(sc => {
                    const v = grid[key]?.[sc];
                    return v?.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100 : null;
                }),
                order: nRuns - ri,   // earliest run drawn first (behind)
            });
        });
    }

    // Dynamic canvas width: ~32px per scenario, min 600px
    const dynamicW = Math.max(600, scenarios.length * 32);
    canvas.parentElement.style.overflowX = 'auto';
    canvas.style.width  = dynamicW + 'px';
    canvas.style.minWidth = dynamicW + 'px';
    canvas.width = dynamicW;

    // Render arm colour key (separate from Chart.js legend because per-run series are too many)
    const legendEl = document.getElementById('heatmap-legend');
    if (legendEl) {
        legendEl.innerHTML = EXP_KEYS
            .filter(a => _state.activeExperiments.has(a))
            .map(a => {
                const meta = EXP_META[a];
                const nRuns = runsByArm[a]?.size ?? 0;
                return `<span style="display:flex;align-items:center;gap:5px;">
                    <span style="width:28px;height:10px;background:${meta.color};border-radius:2px;opacity:0.85;"></span>
                    ${meta.label} <span style="opacity:0.55;">(${nRuns} run${nRuns !== 1 ? 's' : ''}, fading = older)</span>
                </span>`;
            })
            .join('');
    }

    new Chart(canvas, {
        type: 'bar',
        data: { labels: scenarios.map(s => s.replace(/_/g, ' ')), datasets },
        options: {
            responsive: false, maintainAspectRatio: false,
            scales: {
                x: { ticks: { font: { size: 9 }, maxRotation: 55 } },
                y: { title: { display: true, text: 'Avg Cumulative Reward', font: { size: 11 } } },
            },
            plugins: {
                legend: { display: false },  // too many series; arm color is sufficient
                tooltip: {
                    external: _buildBarExternalTooltip('decimal'),
                    mode: 'index', intersect: false,
                },
            },
        },
    });
}

// -- Scenario Goal Rate Chart --------------------------------------------------
function _renderScenarioGoalRates() {
    if (typeof Chart === 'undefined') return;
    const canvas = _destroyChart('scenario-goal-chart');
    if (!canvas) return;
    // scenarioGoalData is already canonical from _fetchScenarioGoals
    const rows = _state.scenarioGoalData;
    if (!rows?.length) return;

    // Apply scenario category filter
    const filterRows = r => {
        if (_state.scenarioFilter === 'all') return true;
        if (_state.scenarioFilter === 'composite') return r.scenario_id.startsWith('js_composite_');
        if (_state.scenarioFilter === 'escalation') return r.scenario_id.includes('crisis') || r.scenario_id.includes('suicidal') || r.scenario_id.includes('emergency') || r.scenario_id.includes('burnout');
        return true;
    };
    const filteredRows = rows.filter(filterRows);
    if (!filteredRows.length) return;

    const scenarios = [...new Set(filteredRows.map(r => r.scenario_id))].sort();
    const activeArms = EXP_KEYS.filter(arm => _state.activeExperiments.has(arm) && filteredRows.some(r => r.arm === arm));

    // Sort arms by mean goal rate DESC so the smallest bar (worst arm) is drawn last (front).
    const armMeans = activeArms.map(arm => {
        const vals = scenarios.map(sc => {
            const r = filteredRows.find(x => x.arm === arm && x.scenario_id === sc);
            return r?.goal_rate ?? null;
        }).filter(v => v != null);
        return { arm, mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 };
    });
    armMeans.sort((a, b) => b.mean - a.mean);  // best arm drawn first (back)

    const datasets = armMeans.map(({ arm }) => ({
        label: EXP_META[arm].shortLabel,
        backgroundColor: EXP_META[arm].color + 'BB',
        borderColor: EXP_META[arm].color,
        borderWidth: 1.5,
        borderRadius: 2,
        // Overlapping bars: all arms share the full category width.
        // This is identical to the metric bar chart approach.
        barPercentage:      1.0,
        categoryPercentage: 0.85,
        _armKey: arm,
        _epCounts: scenarios.map(sc => {
            const r = filteredRows.find(x => x.arm === arm && x.scenario_id === sc);
            return r?.episode_count ?? 0;
        }),
        data: scenarios.map(sc => {
            const r = filteredRows.find(x => x.arm === arm && x.scenario_id === sc);
            return r ? Math.round(r.goal_rate * 1000) / 1000 : null;
        }),
    }));

    // Dynamic canvas width: 12px per scenario (was 28px per scenario × N arms).
    // Overlapping means we no longer scale by arm count.
    const dynamicW = Math.max(600, scenarios.length * 14);
    canvas.parentElement.style.overflowX = 'auto';
    canvas.style.width    = dynamicW + 'px';
    canvas.style.minWidth = dynamicW + 'px';
    canvas.width          = dynamicW;

    new Chart(canvas, {
        type: 'bar',
        data: { labels: scenarios.map(s => s.replace(/_/g, ' ')), datasets },
        options: {
            responsive: false, maintainAspectRatio: false,
            scales: {
                x: { ticks: { font: { size: 9 }, maxRotation: 55 } },
                y: {
                    min: 0, max: 1,
                    title: { display: true, text: 'Goal Rate', font: { size: 11 } },
                    ticks: { callback: v => (v * 100).toFixed(0) + '%' },
                },
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11 } } },
                tooltip: {
                    external: _buildBarExternalTooltip('percent'),
                    mode: 'index', intersect: false,
                },
            },
        },
    });
    _renderScenarioRankTable('mean');
    _wireScenarioRankToggles();
}

function _renderScenarioRankTable(armKey) {
    const el = document.getElementById('scenario-rank-table');
    if (!el) return;
    // scenarioGoalData is already canonical from _fetchScenarioGoals
    const allRows = _state.scenarioGoalData;
    if (!allRows?.length) { el.innerHTML = '<p class="muted">No scenario goal data.</p>'; return; }

    // Apply scenario category filter matching the active filter button
    const filterFn = r => {
        if (_state.scenarioFilter === 'all') return true;
        if (_state.scenarioFilter === 'composite') return r.scenario_id.startsWith('js_composite_');
        if (_state.scenarioFilter === 'escalation') return r.scenario_id.includes('crisis') || r.scenario_id.includes('suicidal') || r.scenario_id.includes('emergency') || r.scenario_id.includes('burnout');
        return true;
    };
    const rows = allRows.filter(filterFn);
    if (!rows.length) { el.innerHTML = '<p class="muted">No data for this filter.</p>'; return; }

    const scenarios = [...new Set(rows.map(r => r.scenario_id))];
    // Only show arms that have at least one data row
    const armsWithData = EXP_KEYS.filter(arm => rows.some(r => r.arm === arm));

    // Episode totals per arm (sum across all scenarios)
    const armTotals = {};
    armsWithData.forEach(arm => {
        armTotals[arm] = rows.filter(r => r.arm === arm)
                             .reduce((s, r) => s + (r.episode_count || 0), 0);
    });

    const tableData = scenarios.map(sc => {
        const armRows = armsWithData.reduce((acc, arm) => {
            const r = rows.find(x => x.arm === arm && x.scenario_id === sc);
            if (r) acc[arm] = { rate: r.goal_rate, n: r.episode_count };
            return acc;
        }, {});
        const validRates = armsWithData.map(a => armRows[a]?.rate).filter(v => v != null);
        const meanRate = validRates.length ? validRates.reduce((a, b) => a + b, 0) / validRates.length : null;
        return { sc, armRows, meanRate };
    });

    tableData.sort((a, b) => {
        const va = armKey === 'mean' ? a.meanRate : a.armRows[armKey]?.rate;
        const vb = armKey === 'mean' ? b.meanRate : b.armRows[armKey]?.rate;
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return va - vb;
    });

    const fmt = v => v != null ? (v * 100).toFixed(1) + '%' : '—';
    const colorCell = (v, arm, n) => {
        if (v == null) return `<td style="text-align:center;color:var(--gray-400);">—</td>`;
        const col     = EXP_META[arm]?.color ?? '#888';
        const opacity = Math.round(20 + v * 70);
        const nStr    = n != null ? `<span style="font-size:10px;color:var(--gray-500);display:block;">(n=${n})</span>` : '';
        return `<td style="text-align:center;background:${col}${opacity.toString(16).padStart(2, '0')};font-weight:${v >= 0.5 ? '600' : '400'};">${fmt(v)}${nStr}</td>`;
    };

    el.innerHTML = `<table style="border-collapse:collapse;width:100%;font-size:12px;">
        <thead>
          <tr style="background:var(--gray-50);position:sticky;top:0;border-bottom:1px solid var(--gray-200);">
            <th style="text-align:left;padding:5px 8px;">#</th>
            <th style="text-align:left;padding:5px 8px;">Scenario</th>
            ${armsWithData.map(a => `<th style="padding:5px 8px;color:${EXP_META[a].color};">${EXP_META[a].shortLabel}</th>`).join('')}
            <th style="padding:5px 8px;">Mean</th>
            <th style="padding:5px 8px;color:var(--gray-500);">Total n</th>
          </tr>
          <tr style="background:var(--gray-100);position:sticky;top:28px;border-bottom:2px solid var(--gray-200);font-size:11px;color:var(--gray-500);">
            <td colspan="2" style="padding:3px 8px;font-style:italic;">Episodes (total incl. legacy)</td>
            ${armsWithData.map(a => `<td style="text-align:center;padding:3px 8px;">${armTotals[a] ?? 0}</td>`).join('')}
            <td></td>
            <td style="text-align:center;padding:3px 8px;">${armsWithData.reduce((s, a) => s + (armTotals[a] ?? 0), 0)}</td>
          </tr>
        </thead>
        <tbody>${tableData.map((d, i) => {
            const rowTotal = armsWithData.reduce((s, a) => s + (d.armRows[a]?.n ?? 0), 0);
            return `<tr style="border-bottom:1px solid var(--gray-100);">
            <td style="padding:4px 8px;color:var(--gray-500);">${i + 1}</td>
            <td style="padding:4px 8px;font-family:monospace;font-size:11px;">${d.sc}</td>
            ${armsWithData.map(a => colorCell(d.armRows[a]?.rate, a, d.armRows[a]?.n)).join('')}
            <td style="text-align:center;font-weight:600;">${fmt(d.meanRate)}</td>
            <td style="text-align:center;color:var(--gray-600);font-size:11px;">${rowTotal || '—'}</td>
        </tr>`;
        }).join('')}</tbody>
    </table>`;
}

function _wireScenarioRankToggles() {
    const container = document.getElementById('scenario-rank-toggles');
    if (!container) return;
    container.querySelectorAll('button[data-arm]').forEach(btn => {
        btn.onclick = () => {
            container.querySelectorAll('button[data-arm]').forEach(b => b.className = 'secondary');
            btn.className = 'primary';
            _renderScenarioRankTable(btn.dataset.arm);
        };
    });

    // Scenario category filter buttons
    document.querySelectorAll('[data-scenario-filter]').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('[data-scenario-filter]').forEach(b => b.className = 'secondary');
            btn.className = 'primary';
            _state.scenarioFilter = btn.dataset.scenarioFilter;
            // Re-render both the bar chart and the rank table
            _renderScenarioGoalRates();
            _renderScenarioRewardStats();
            const activeArmBtn = document.querySelector('#scenario-rank-toggles button.primary');
            _renderScenarioRankTable(activeArmBtn?.dataset.arm ?? 'mean');
        };
    });
}

// -- Scenario Reward Stats Table -----------------------------------------------
// Renders per-scenario avg reward per experiment, sorted worst-first (ascending mean).
// Uses _state.scenarioGoalData (already fetched, contains avg_reward per arm×scenario).
function _renderScenarioRewardStats() {
    const el = document.getElementById('scenario-reward-stats-wrap');
    if (!el) return;
    const allRows = _state.scenarioGoalData;
    if (!allRows?.length) { el.innerHTML = '<p class="muted" style="padding:8px;">No scenario data.</p>'; return; }

    const filterFn = r => {
        if (_state.scenarioFilter === 'all') return true;
        if (_state.scenarioFilter === 'composite') return r.scenario_id.startsWith('js_composite_');
        if (_state.scenarioFilter === 'escalation') return r.scenario_id.includes('crisis') || r.scenario_id.includes('suicidal') || r.scenario_id.includes('emergency') || r.scenario_id.includes('burnout');
        return true;
    };
    const rows = allRows.filter(filterFn);
    if (!rows.length) { el.innerHTML = '<p class="muted" style="padding:8px;">No data for this filter.</p>'; return; }

    const scenarios    = [...new Set(rows.map(r => r.scenario_id))];
    const armsWithData = EXP_KEYS.filter(arm => rows.some(r => r.arm === arm));

    // Compute per-scenario mean reward across all arms
    const tableData = scenarios.map(sc => {
        const armRewards = armsWithData.reduce((acc, arm) => {
            const r = rows.find(x => x.arm === arm && x.scenario_id === sc);
            if (r?.avg_reward != null) acc[arm] = { reward: r.avg_reward, n: r.episode_count };
            return acc;
        }, {});
        const validRewards = armsWithData.map(a => armRewards[a]?.reward).filter(v => v != null);
        const meanReward   = validRewards.length ? validRewards.reduce((a, b) => a + b, 0) / validRewards.length : null;
        return { sc, armRewards, meanReward };
    });

    // Sort ascending by mean reward (worst first)
    tableData.sort((a, b) => {
        if (a.meanReward == null && b.meanReward == null) return 0;
        if (a.meanReward == null) return 1;
        if (b.meanReward == null) return -1;
        return a.meanReward - b.meanReward;
    });

    // Determine reward range for opacity scaling
    const allRewards = tableData.flatMap(d => armsWithData.map(a => d.armRewards[a]?.reward).filter(v => v != null));
    const minR = allRewards.length ? Math.min(...allRewards) : 0;
    const maxR = allRewards.length ? Math.max(...allRewards) : 1;
    const range = maxR - minR || 1;

    const colorCell = (arm, reward, n) => {
        if (reward == null) return `<td style="text-align:center;color:var(--gray-400);">—</td>`;
        const col     = EXP_META[arm]?.color ?? '#888';
        const opacity = Math.round(15 + ((reward - minR) / range) * 65);
        const nStr    = n != null ? `<span style="font-size:10px;color:var(--gray-500);display:block;">(n=${n})</span>` : '';
        return `<td style="text-align:center;background:${col}${opacity.toString(16).padStart(2, '0')};">${reward.toFixed(2)}${nStr}</td>`;
    };

    el.innerHTML = `<table style="border-collapse:collapse;width:100%;font-size:12px;">
        <thead>
          <tr style="background:var(--gray-50);position:sticky;top:0;border-bottom:1px solid var(--gray-200);">
            <th style="text-align:left;padding:5px 8px;">#</th>
            <th style="text-align:left;padding:5px 8px;">Scenario</th>
            ${armsWithData.map(a => `<th style="padding:5px 8px;color:${EXP_META[a].color};">${EXP_META[a].shortLabel}</th>`).join('')}
            <th style="padding:5px 8px;">Mean Reward (last 100)</th>
            <th style="padding:5px 8px;color:var(--gray-500);">Total n</th>
          </tr>
        </thead>
        <tbody>${tableData.map((d, i) => {
            const rowTotal = armsWithData.reduce((s, a) => s + (d.armRewards[a]?.n ?? 0), 0);
            return `<tr style="border-bottom:1px solid var(--gray-100);">
              <td style="padding:4px 8px;color:var(--gray-500);">${i + 1}</td>
              <td style="padding:4px 8px;font-family:monospace;font-size:11px;">${d.sc}</td>
              ${armsWithData.map(a => colorCell(a, d.armRewards[a]?.reward, d.armRewards[a]?.n)).join('')}
              <td style="text-align:center;font-weight:600;">${d.meanReward != null ? d.meanReward.toFixed(2) : '—'}</td>
              <td style="text-align:center;color:var(--gray-600);font-size:11px;">${rowTotal || '—'}</td>
            </tr>`;
        }).join('')}</tbody>
    </table>`;
}

// -- Action Usage Statistics Table --------------------------------------------
// Renders an interactive table with actions as rows and experiments as columns.
// Supports "Per Experiment" (default) and "Per Scenario" views via toggle buttons.
function _renderActionStatsTable() {
    const wrap = document.getElementById('action-stats-wrap');
    if (!wrap) return;
    _wireActionStatsToggles();

    if (_state.actionStatsView === 'scenario') {
        _renderActionStatsByScenario(wrap);
    } else {
        _renderActionStatsByExp(wrap);
    }
}

function _wireActionStatsToggles() {
    const btnExp = document.getElementById('action-stats-view-exp');
    const btnSc  = document.getElementById('action-stats-view-sc');
    const scFilter = document.getElementById('action-stats-sc-filter');
    if (!btnExp || !btnSc) return;

    btnExp.onclick = () => {
        _state.actionStatsView = 'exp';
        btnExp.classList.add('active'); btnSc.classList.remove('active');
        if (scFilter) scFilter.style.display = 'none';
        _renderActionStatsTable();
    };
    btnSc.onclick = () => {
        _state.actionStatsView = 'scenario';
        btnSc.classList.add('active'); btnExp.classList.remove('active');
        if (scFilter) {
            scFilter.style.display = '';
            _populateActionScenarioFilter(scFilter);
        }
        _renderActionStatsTable();
    };
    if (scFilter) {
        scFilter.onchange = () => {
            _state.actionStatsScenario = scFilter.value || null;
            _renderActionStatsByScenario(document.getElementById('action-stats-wrap'));
        };
    }
}

function _populateActionScenarioFilter(sel) {
    const rows = _state.actionStatsByScenario || [];
    const scenarios = [...new Set(rows.map(r => r.scenario_id).filter(Boolean))].sort();
    const current = sel.value;
    sel.innerHTML = '<option value="">All scenarios</option>' +
        scenarios.map(sc => `<option value="${sc}"${sc === current ? ' selected' : ''}>${sc}</option>`).join('');
    if (!_state.actionStatsScenario && scenarios.length) _state.actionStatsScenario = scenarios[0];
    if (_state.actionStatsScenario && !sel.value) sel.value = _state.actionStatsScenario;
}

function _renderActionStatsByExp(wrap) {
    const rows = _state.actionStatsData;
    if (!rows?.length) { wrap.innerHTML = '<p class="muted" style="padding:8px;">No action stats yet.</p>'; return; }

    const arms    = EXP_KEYS.filter(arm => rows.some(r => r.arm === arm));
    const actions = [...new Set(rows.map(r => r.action))].sort();

    const totalsByArm = {};
    arms.forEach(arm => {
        totalsByArm[arm] = rows.filter(r => r.arm === arm).reduce((s, r) => s + (r.turn_count || 0), 0);
    });

    const cell = (arm, action) => {
        const r = rows.find(x => x.arm === arm && x.action === action);
        if (!r) return `<td style="text-align:center;color:var(--gray-300);">—</td>`;
        const col  = EXP_META[arm]?.color ?? '#888';
        const frac = totalsByArm[arm] ? r.turn_count / totalsByArm[arm] : 0;
        const op   = Math.round(15 + frac * 75).toString(16).padStart(2, '0');
        const goalPct = r.goal_rate != null ? (r.goal_rate * 100).toFixed(0) + '%' : '?';
        return `<td style="text-align:center;background:${col}${op};white-space:nowrap;">${r.turn_count}<br><span style="font-size:10px;color:var(--gray-600);">${goalPct}</span></td>`;
    };

    const totals = {};
    actions.forEach(action => {
        totals[action] = rows.filter(r => r.action === action).reduce((s, r) => s + (r.turn_count || 0), 0);
    });

    wrap.innerHTML = `<table style="border-collapse:collapse;width:100%;font-size:12px;">
        <thead>
          <tr style="background:var(--gray-50);position:sticky;top:0;border-bottom:1px solid var(--gray-200);">
            <th style="text-align:left;padding:5px 8px;">Action</th>
            ${arms.map(a => `<th style="padding:5px 8px;color:${EXP_META[a].color};">${EXP_META[a].shortLabel}</th>`).join('')}
            <th style="padding:5px 8px;">Total</th>
          </tr>
        </thead>
        <tbody>${actions.map(action => `
          <tr style="border-bottom:1px solid var(--gray-100);">
            <td style="padding:4px 8px;font-family:monospace;font-size:11px;">${action}</td>
            ${arms.map(arm => cell(arm, action)).join('')}
            <td style="text-align:center;font-weight:600;">${totals[action] || 0}</td>
          </tr>`).join('')}
        </tbody>
    </table>`;
}

function _renderActionStatsByScenario(wrap) {
    const allRows = _state.actionStatsByScenario;
    if (!allRows?.length) { wrap.innerHTML = '<p class="muted" style="padding:8px;">No per-scenario action stats yet.</p>'; return; }

    const targetSc = _state.actionStatsScenario;
    const rows     = targetSc ? allRows.filter(r => r.scenario_id === targetSc) : allRows;

    if (!rows.length) { wrap.innerHTML = `<p class="muted" style="padding:8px;">No data for "${targetSc || 'selected scenario'}".</p>`; return; }

    const arms    = EXP_KEYS.filter(arm => rows.some(r => r.arm === arm));
    const actions = [...new Set(rows.map(r => r.action))].sort();

    const totalsByArm = {};
    arms.forEach(arm => {
        totalsByArm[arm] = rows.filter(r => r.arm === arm).reduce((s, r) => s + (r.turn_count || 0), 0);
    });

    const cell = (arm, action) => {
        const r = rows.find(x => x.arm === arm && x.action === action);
        if (!r) return `<td style="text-align:center;color:var(--gray-300);">—</td>`;
        const col  = EXP_META[arm]?.color ?? '#888';
        const frac = totalsByArm[arm] ? r.turn_count / totalsByArm[arm] : 0;
        const op   = Math.round(15 + frac * 75).toString(16).padStart(2, '0');
        const goalPct = r.goal_rate != null ? (r.goal_rate * 100).toFixed(0) + '%' : '?';
        return `<td style="text-align:center;background:${col}${op};white-space:nowrap;">${r.turn_count}<br><span style="font-size:10px;color:var(--gray-600);">${goalPct}</span></td>`;
    };

    const totals = {};
    actions.forEach(action => {
        totals[action] = rows.filter(r => r.action === action).reduce((s, r) => s + (r.turn_count || 0), 0);
    });

    wrap.innerHTML = `<table style="border-collapse:collapse;width:100%;font-size:12px;">
        <thead>
          <tr style="background:var(--gray-50);position:sticky;top:0;border-bottom:1px solid var(--gray-200);">
            <th style="text-align:left;padding:5px 8px;">Action</th>
            ${arms.map(a => `<th style="padding:5px 8px;color:${EXP_META[a].color};">${EXP_META[a].shortLabel}</th>`).join('')}
            <th style="padding:5px 8px;">Total</th>
          </tr>
        </thead>
        <tbody>${actions.map(action => `
          <tr style="border-bottom:1px solid var(--gray-100);">
            <td style="padding:4px 8px;font-family:monospace;font-size:11px;">${action}</td>
            ${arms.map(arm => cell(arm, action)).join('')}
            <td style="text-align:center;font-weight:600;">${totals[action] || 0}</td>
          </tr>`).join('')}
        </tbody>
    </table>`;
}

// -- Critical Failure Stats ----------------------------------------------------
function _renderCritFailStats() {
    const el = document.getElementById('crit-fail-stats-row');
    if (!el) return;
    const rows = _state.critFailData;
    if (!rows?.length) { el.innerHTML = '<p class="muted">No critical failure data.</p>'; return; }
    const byExp = {};
    rows.forEach(r => { if (!byExp[r.arm]) byExp[r.arm] = {total:0,failed:0}; byExp[r.arm].total += r.total_episodes; byExp[r.arm].failed += r.failed_episodes; });
    el.innerHTML = EXP_KEYS.map(arm => {
        if (!byExp[arm]) return '';
        const meta = EXP_META[arm]; const {total,failed} = byExp[arm]; const rate = total ? (failed/total*100).toFixed(1) : 0;
        return `<div class="stat-card" style="border-left:4px solid ${meta.color};"><span class="stat-value" style="color:${meta.color};">${rate}%</span><span class="stat-label" style="text-align:center;">${meta.label}<br><small style="color:var(--gray-500);">${failed}/${total} failed</small></span></div>`;
    }).join('');
}

function _renderCritFailTable() {
    const el = document.getElementById('crit-fail-table');
    if (!el) return;
    const rows = _state.critFailData;
    if (!rows?.length) { el.innerHTML = '<p class="muted" style="padding:8px;">No critical failure data yet.</p>'; return; }

    const armsWithData = EXP_KEYS.filter(arm => rows.some(r => r.arm === arm));
    const scenarios    = [...new Set(rows.map(r => r.scenario_id).filter(Boolean))].sort();

    // Sort scenarios by worst mean failure rate (most problematic first)
    const scenarioMeans = scenarios.map(sc => {
        const vals = armsWithData.map(arm => {
            const r = rows.find(x => x.arm === arm && x.scenario_id === sc);
            return (r && r.total_episodes) ? r.failed_episodes / r.total_episodes : null;
        }).filter(v => v != null);
        return { sc, mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 };
    });
    scenarioMeans.sort((a, b) => b.mean - a.mean);

    const fmtRate = (r, arm) => {
        if (!r || !r.total_episodes) return `<td style="text-align:center;color:var(--gray-300);">—</td>`;
        const pct = (r.failed_episodes / r.total_episodes * 100);
        const col = EXP_META[arm]?.color ?? '#888';
        const opacity = Math.round(15 + pct * 0.7).toString(16).padStart(2, '0');
        return `<td style="text-align:center;background:${col}${opacity};font-weight:${pct > 20 ? '600' : '400'};">
            ${pct.toFixed(1)}%<small style="display:block;color:var(--gray-500);font-size:10px;">${r.failed_episodes}/${r.total_episodes}</small>
        </td>`;
    };

    el.innerHTML = `<table style="border-collapse:collapse;width:100%;font-size:12px;">
        <thead>
          <tr style="background:var(--gray-50);position:sticky;top:0;border-bottom:1px solid var(--gray-200);">
            <th style="text-align:left;padding:5px 8px;">#</th>
            <th style="text-align:left;padding:5px 8px;">Scenario</th>
            ${armsWithData.map(a => `<th style="padding:5px 8px;color:${EXP_META[a].color};">${EXP_META[a].shortLabel}</th>`).join('')}
            <th style="padding:5px 8px;">Mean</th>
          </tr>
        </thead>
        <tbody>
          ${scenarioMeans.map((d, i) => `
            <tr style="border-bottom:1px solid var(--gray-100);">
              <td style="padding:4px 8px;color:var(--gray-500);">${i + 1}</td>
              <td style="padding:4px 8px;font-family:monospace;font-size:11px;">${d.sc}</td>
              ${armsWithData.map(arm => fmtRate(rows.find(r => r.arm === arm && r.scenario_id === d.sc), arm)).join('')}
              <td style="text-align:center;font-weight:600;">${d.mean > 0 ? (d.mean * 100).toFixed(1) + '%' : '—'}</td>
            </tr>`).join('')}
        </tbody>
    </table>`;
}

// -- Cumulative Reward Distribution (min/mean/max per experiment per run) ------
function _renderCumulativeRewardDist() {
    if (typeof Chart === 'undefined') return;
    const rows = _state.metricsData;
    const ctx  = document.getElementById('cumulative-reward-dist-chart')?.getContext('2d');
    if (!ctx || !rows?.length) return;

    // For each experiment, one bar cluster (one bar per run) showing mean reward
    // with error bars approximated as floating bars [min, max].
    const labels   = [];
    const datasets = [];

    EXP_KEYS.filter(arm => _state.activeExperiments.has(arm)).forEach(arm => {
        const meta   = EXP_META[arm];
        const armRows = rows.filter(r => r.arm === arm);
        armRows.forEach((r, i) => {
            const runLabel = r.run_label?.replace(/^run_/, 'R') ?? `R${i + 1}`;
            const lbl = `${meta.shortLabel} ? ${runLabel}`;
            if (!labels.includes(lbl)) labels.push(lbl);
        });
    });

    // Min bar (transparent base)
    const minData = [], meanData = [], maxData = [];
    const barColors = [];
    let li = 0;
    EXP_KEYS.filter(arm => _state.activeExperiments.has(arm)).forEach(arm => {
        const meta    = EXP_META[arm];
        const armRows = rows.filter(r => r.arm === arm);
        armRows.forEach(r => {
            minData.push(r.min_reward ?? 0);
            meanData.push(r.mean_reward ?? 0);
            maxData.push(r.max_reward ?? 0);
            barColors.push(meta.color + 'CC');
            li++;
        });
    });

    // Rebuild labels in same order
    const orderedLabels = [];
    EXP_KEYS.filter(arm => _state.activeExperiments.has(arm)).forEach(arm => {
        const meta   = EXP_META[arm];
        const armRows = rows.filter(r => r.arm === arm);
        armRows.forEach((r, i) => {
            const runLabel = r.run_label?.replace(/^run_/, 'R') ?? `R${i + 1}`;
            orderedLabels.push(`${meta.shortLabel} ? ${runLabel}`);
        });
    });

    if (window._cumulDistChart) { try { window._cumulDistChart.destroy(); } catch {} }
    window._cumulDistChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: orderedLabels,
            datasets: [
                { label: 'Min', data: minData,  backgroundColor: barColors.map(c => c.replace('CC', '44')), stack: 'none' },
                { label: 'Mean', data: meanData, backgroundColor: barColors,                                 stack: 'none' },
                { label: 'Max', data: maxData,  backgroundColor: barColors.map(c => c.replace('CC', '66')), stack: 'none' },
            ],
        },
        options: {
            animation: false,
            responsive: true,
            plugins: {
                legend: { labels: { font: { size: 11 } } },
                    tooltip: { mode: 'index', intersect: false, external: _buildExternalTooltip('decimal') },
            },
            scales: {
                x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
                y: { title: { display: true, text: 'Cumulative Reward (sum of per-turn rewards)' } },
            },
        },
    });
}

// -- Reward Component Line Charts ---------------------------------------------
// One line per experiment for each of the 5 reward dimensions (goal, stress,
// trust, info, consistency), plotted against wall-clock hours with WMA smoothing.
// This replaces the "all rolled into one" view and lets the user see which
// specific dimension is improving, stagnating, or regressing.
function _renderRewardComponentCharts() {
    if (typeof Chart === 'undefined') return;
    const rows = _state.rewardComponentData;
    const wrap = document.getElementById('reward-component-charts');
    if (!wrap) return;
    wrap.innerHTML = '';

    if (!rows?.length) {
        wrap.innerHTML = '<p style="color:var(--gray-500);font-size:13px;">No reward component data yet.</p>';
        return;
    }

    const dims = [
        { key: 'goal_wma',        label: 'Goal Progress',    color: '#4285F4' },
        { key: 'stress_wma',      label: 'Stress Reduction', color: '#EA4335' },
        { key: 'trust_wma',       label: 'Trust Delta',      color: '#34A853' },
        { key: 'info_wma',        label: 'Info Gain',        color: '#FBBC05' },
        { key: 'consistency_wma', label: 'Consistency',      color: '#9C27B0' },
    ];

    // Group rows by arm
    const byArm = {};
    for (const r of rows) (byArm[r.arm] = byArm[r.arm] || []).push(r);

    // One chart per dimension — laid out in a 2-column grid matching the rest
    // of the dashboard.  A position:relative wrapper with a fixed height is
    // required for Chart.js responsive mode to honour the height constraint.
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;';
    wrap.appendChild(grid);

    for (const dim of dims) {
        const canvasId = `rc-chart-${dim.key}`;
        const cell = document.createElement('div');
        cell.innerHTML = `
            <div style="font-size:11px;color:var(--gray-600);margin-bottom:4px;">
                ${dim.label}
                <span title="Weighted Moving Average across the scoring window" style="cursor:help;opacity:.5;">ⓘ</span>
            </div>
            <div style="position:relative;height:180px;">
                <canvas id="${canvasId}"></canvas>
            </div>`;

        const datasets = EXP_KEYS
            .filter(arm => _state.activeExperiments.has(arm) && byArm[arm])
            .map(arm => {
                const meta = EXP_META[arm];
                const ep   = byArm[arm];
                const data = ep.map((r, i) => ({ x: i + 1, y: r[dim.key] != null ? +r[dim.key].toFixed(4) : null }));
                return {
                    label: meta.shortLabel,
                    data,
                    borderColor:     meta.color,
                    backgroundColor: meta.bg,
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.3,
                    spanGaps: false,
                };
            });

        grid.appendChild(cell);

        const ctx = document.getElementById(canvasId)?.getContext('2d');
        if (!ctx) continue;
        new Chart(ctx, {
            type: 'line',
            data: { datasets },
            options: {
                ..._LINE_CHART_OPTIONS,
                parsing: false,
                plugins: {
                    legend: { labels: { font: { size: 11 } } },
                    tooltip: { mode: 'index', intersect: false, external: _buildExternalTooltip('decimal') },
                    zoom: _ZOOM_PLUGIN,
                },
                scales: {
                    x: { type: 'linear', title: { display: true, text: 'Episode number (per arm)' }, ticks: { callback: v => Math.round(v) } },
                    y: { min: 0, max: 1, title: { display: true, text: dim.label } },
                },
            },
        });
    }
}

// -- Metric Bar Charts (per-run, overlapping per experiment) ------------------
function _renderMetricBars() {
    if (typeof Chart === 'undefined') return;
    // metricsData is already canonical from _fetchMetrics.
    // One row per (arm, run_id); we aggregate to one value per arm by
    // weighted-averaging over all runs (weight = episode count).
    const rows = _state.metricsData || [];
    if (!rows.length) return;

    const metrics = [
        { key: 'mean_reward',        label: 'Mean Cumul. Reward (last 100 eps)', canvas: 'metric-bar-reward'  },
        { key: 'goal_rate',          label: 'Goal Rate',             canvas: 'metric-bar-goal'    },
        { key: 'mean_stress_auc',    label: 'Stress AUC (↑ better)', canvas: 'metric-bar-stress'  },
        { key: 'safety_failures',    label: 'Safety Failures',       canvas: 'metric-bar-safety'  },
        { key: 'discrepancy_turns',  label: 'Discrepancy Turns *',   canvas: 'metric-bar-disc'    },
        { key: 'mean_goal_reward',   label: 'Reward: Goal',          canvas: 'metric-bar-rgoal'   },
        { key: 'mean_stress_reward', label: 'Reward: Stress',        canvas: 'metric-bar-rstress' },
        { key: 'mean_trust_reward',  label: 'Reward: Trust',         canvas: 'metric-bar-rtrust'  },
        { key: 'mean_latency_ms',    label: 'Avg Latency (ms)',      canvas: 'metric-bar-latency' },
        { key: 'cost_usd_total',     label: 'Cost USD/episode',      canvas: 'metric-bar-cost'    },
        { key: 'llm_calls_total',    label: 'LLM calls/episode',     canvas: 'metric-bar-llmcalls'},
    ];

    // Aggregate per arm: weighted average over all runs for each metric
    const activeArms = EXP_KEYS.filter(arm =>
        _state.activeExperiments.has(arm) && rows.some(r => r.arm === arm)
    );
    if (!activeArms.length) return;

    const armAgg = {};
    for (const arm of activeArms) {
        const armRows = rows.filter(r => r.arm === arm);
        const totalN  = armRows.reduce((s, r) => s + (r.total_episodes || 0), 0);
        armAgg[arm] = {};
        for (const { key } of metrics) {
            if (!totalN) { armAgg[arm][key] = null; continue; }
            const wsum = armRows.reduce((s, r) => s + (r[key] ?? 0) * (r.total_episodes || 0), 0);
            armAgg[arm][key] = Math.round(wsum / totalN * 10000) / 10000;
        }
        armAgg[arm]._totalEpisodes = totalN;
    }

    // x-axis labels = experiment short labels
    const labels = activeArms.map(a => EXP_META[a].shortLabel);

    metrics.forEach(({ key, label, canvas: cid }) => {
        const cv = _destroyChart(cid);
        if (!cv) return;

        const data   = activeArms.map(arm => armAgg[arm][key]);
        const colors = activeArms.map(arm => EXP_META[arm].color + 'cc');
        const borders= activeArms.map(arm => EXP_META[arm].color);

        new Chart(cv, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label,
                    data,
                    backgroundColor: colors,
                    borderColor:     borders,
                    borderWidth: 1.5,
                    borderRadius: 3,
                    maxBarThickness: 36,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { font: { size: 10 } } },
                    y: { beginAtZero: true, ticks: { font: { size: 10 } } },
                },
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: label, font: { size: 11 }, padding: { bottom: 4 } },
                    tooltip: {
                        external: _buildBarExternalTooltip('decimal'),
                    },
                },
            },
        });
    });
}

// -- Cost & LLM Calls Charts ---------------------------------------------------
function _renderCostCharts() {
    if (typeof Chart === 'undefined') return;
    // Cost charts need the full timeline (slim lacks cost_usd_total / llm_calls_total).
    // If full data isn't loaded yet, fetch it then re-render.
    if (!_state.statsTimelineData) {
        _fetchTimelineForStats().then(() => _renderCostCharts()).catch(() => {});
        return;
    }
    const rows = _state.statsTimelineData;
    if (!rows?.length) return;

    // Cost per episode line chart
    const cvCost = _destroyChart('cost-per-episode-chart');
    if (cvCost) {
        const datasets = [];
        for (const [arm, meta] of Object.entries(EXP_META)) {
            if (!_state.activeExperiments.has(arm)) continue;
            const ep = rows.filter(r => r.arm === arm && r.cost_usd_total != null);
            if (!ep.length) continue;
            datasets.push({
                label: meta.shortLabel,
                data:  ep.map((r, i) => ({ x: i + 1, y: r.cost_usd_total })),
                borderColor: meta.color, backgroundColor: 'transparent',
                borderWidth: 2, pointRadius: 0, tension: 0.3,
            });
        }
        if (datasets.length) {
            new Chart(cvCost, {
                type: 'line',
                data: { datasets },
                options: {
                    ..._LINE_CHART_OPTIONS,
                    plugins: {
                        legend: { position: 'top' },
                        title: { display: true, text: 'Cost per Episode (USD)' },
                        tooltip: { mode: 'index', intersect: false, external: _buildExternalTooltip('decimal') },
                    },
                    scales: { x: { title: { display: true, text: 'Episode #' } }, y: { title: { display: true, text: 'USD' } } },
                },
            });
        }
    }

    // LLM calls per episode bar chart (stacked by model)
    const cvCalls = _destroyChart('llm-calls-per-episode-chart');
    if (cvCalls) {
        const armData = {};
        for (const [arm, meta] of Object.entries(EXP_META)) {
            if (!_state.activeExperiments.has(arm)) continue;
            const ep = rows.filter(r => r.arm === arm && r.llm_calls_total != null);
            if (!ep.length) continue;
            const mean = ep.reduce((s, r) => s + r.llm_calls_total, 0) / ep.length;
            armData[arm] = { meta, mean };
        }
        if (Object.keys(armData).length) {
            new Chart(cvCalls, {
                type: 'bar',
                data: {
                    labels: Object.values(armData).map(d => d.meta.shortLabel),
                    datasets: [{
                        label: 'Mean LLM Calls / Episode',
                        data: Object.values(armData).map(d => d.mean.toFixed(2)),
                        backgroundColor: Object.values(armData).map(d => d.meta.color + 'CC'),
                        borderColor: Object.values(armData).map(d => d.meta.color),
                        borderWidth: 1.5,
                    }],
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, title: { display: true, text: 'Mean LLM API Calls per Episode' } },
                    scales: { y: { title: { display: true, text: 'LLM calls' }, beginAtZero: true } },
                },
            });
        }
    }
}

// -- Stratified Goal Rates (L5) -----------------------------------------------
function _renderStratifiedGoalRates() {
    const el = document.getElementById('stratified-goal-section');
    if (!el) return;
    const rows = _state.stratifiedGoalRates;
    if (!rows?.length) {
        el.innerHTML = '<p class="muted" style="padding:8px;">No stratified goal rate data yet (curriculum_pool column not populated).</p>';
        return;
    }

    const POOLS   = ['success', 'recovery', 'dormant', 'initial', 'unknown'];
    const COLOURS = { success: '#22c55e', recovery: '#f59e0b', dormant: '#ef4444', initial: '#60a5fa', unknown: '#94a3b8' };
    const arms    = [...new Set(rows.map(r => r.arm))].sort();

    // One grouped-bar chart: arms on X, one bar-segment per pool
    const datasets = POOLS.map(pool => ({
        label:           pool.charAt(0).toUpperCase() + pool.slice(1),
        data:            arms.map(arm => {
            const r = rows.find(x => x.arm === arm && x.curriculum_pool === pool);
            return r ? r.goal_rate : null;
        }),
        backgroundColor: COLOURS[pool],
        borderWidth:     1,
        borderRadius:    3,
        skipNull:        true,
    })).filter(ds => ds.data.some(v => v != null));

    el.innerHTML = `
        <h3 style="margin:0 0 10px;font-size:13px;color:var(--text-muted)">
            Goal Rate by Curriculum Pool (last 100 eps per arm)
        </h3>
        <canvas id="stratified-goal-chart" height="220"></canvas>
        <p style="font-size:11px;color:var(--text-muted);margin-top:6px">
            Stratified by which curriculum pool the episode landed in.
            Downward total trend can reflect harder pool surfacing (difficulty drift),
            not necessarily a worse policy.
        </p>`;

    const ctx = el.querySelector('#stratified-goal-chart');
    _destroyChart(ctx);
    new Chart(ctx, {
        type: 'bar',
        data: { labels: arms.map(_shortArmName), datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: {
                    external: _buildBarExternalTooltip('decimal'),
                },
            },
            scales: {
                x: { stacked: false, ticks: { font: { size: 10 } } },
                y: { min: 0, max: 100, title: { display: true, text: 'Goal Rate (%)' }, ticks: { font: { size: 10 } } },
            },
        },
    });
}

// -- Physio Scatter -----------------------------------------------------------
function _renderPhysioScatter() {
    if (typeof Chart === 'undefined') return;
    const rows = _state.physioData;
    if (!rows?.length) return;
    _renderScatter('physio-hrv-chart', rows, 'mean_hrv', 'cumulative_reward', 'Mean HRV (ms)', 'Cumulative Reward');
    _renderScatter('physio-stress-chart', rows, 'mean_stress_index', 'mean_stress_reward', 'Mean Stress Index', 'Stress Reward Component');
}
function _renderScatter(cid, rows, xKey, yKey, xLabel, yLabel) {
    const cv = _destroyChart(cid);
    if (!cv) return;
    const datasets = EXP_KEYS.filter(arm => _state.activeExperiments.has(arm)).map(arm => {
        const meta = EXP_META[arm];
        const ep = rows.filter(r => r.arm === arm && r[xKey] != null && r[yKey] != null);
        return { label: meta.shortLabel, backgroundColor: meta.color + '88', borderColor: meta.color, borderWidth: 0.5, pointRadius: 3, data: ep.map(r => ({ x: r[xKey], y: r[yKey] })) };
    });
    new Chart(cv, {
        type: 'scatter', data: { datasets },
        options: { responsive: true, maintainAspectRatio: false, scales: { x:{title:{display:true,text:xLabel,font:{size:11}}}, y:{title:{display:true,text:yLabel,font:{size:11}}} }, plugins: { legend:{position:'top',labels:{boxWidth:12,font:{size:11}}} } },
    });
}

// -- Inline Report -------------------------------------------------------------
export async function loadInlineReport(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-500);">Loading report?</div>';
    try {
        const check = await fetch(`${config.ORCHESTRATOR_URL}/reports/simulation_report.html`, { method: 'HEAD' });
        if (!check.ok) { container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-500);">No report yet. Generate one first.</div>'; return; }
    } catch (e) { container.innerHTML = `<div style="padding:16px;color:var(--red-700);">Report load error: ${e.message}</div>`; return; }
    container.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.src = `${config.ORCHESTRATOR_URL}/reports/simulation_report.html?t=${Date.now()}`;
    frame.style.cssText = 'width:100%;height:100%;min-height:600px;border:none;border-radius:8px;background:#fff;display:block;';
    frame.title = 'Simulation Report';
    frame.allow = 'scripts';
    frame.setAttribute('allowfullscreen', '');
    container.appendChild(frame);
}
export function handleDbToggle() { if (_state.simStats) _renderSimOverview(); }

// -- Conversation Viewer -------------------------------------------------------
/**
 * Wires the experiment/scenario/episode selects and the Load button.
 * Called once from initBenchmarksDashboard.
 */
export function initConversationViewer() {
    const expSel      = document.getElementById('conv-exp-select');
    const scenSel     = document.getElementById('conv-scenario-select');
    const epSel       = document.getElementById('conv-episode-select');
    const loadBtn     = document.getElementById('conv-load-btn');
    const panel       = document.getElementById('conv-viewer-panel');
    if (!expSel) return;

    async function refreshEpisodes() {
        const arm  = expSel.value;
        const scen = scenSel.value;
        epSel.innerHTML = '<option value="">Loading?</option>';
        try {
            const params = new URLSearchParams();
            if (arm)  params.set('arm', arm);
            if (scen) params.set('scenario_id', scen);
            params.set('limit', '200');
            const { rows } = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/episodes?${params}`).then(r=>r.json());
            epSel.innerHTML = '<option value="">-- Select Episode --</option>';
            rows.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.episode_id;
                const dt  = r.started_at ? new Date(r.started_at).toLocaleString() : '?';
                const goal = r.goal_achieved === 1 ? '? goal' : r.goal_achieved === 0 ? '? no goal' : '? goal?';
                opt.textContent = `${dt} | ${r.scenario_id} | R=${(r.cumulative_reward??0).toFixed(2)} ${goal}`;
                epSel.appendChild(opt);
            });
        } catch { epSel.innerHTML = '<option value="">Error loading episodes</option>'; }
    }

    async function populateScenarios() {
        const arm = expSel.value;
        scenSel.innerHTML = '<option value="">-- All Scenarios --</option>';
        if (!arm) return;
        try {
            const params = new URLSearchParams({ arm, limit: '500' });
            const { rows } = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/episodes?${params}`).then(r=>r.json());
            const scenarios = [...new Set(rows.map(r => r.scenario_id).filter(Boolean))].sort();
            scenarios.forEach(sc => {
                const opt = document.createElement('option');
                opt.value = sc;
                opt.textContent = sc.replace(/_/g, ' ');
                scenSel.appendChild(opt);
            });
        } catch {}
    }

    expSel.addEventListener('change', async () => { await populateScenarios(); await refreshEpisodes(); });
    scenSel.addEventListener('change', refreshEpisodes);

    loadBtn.addEventListener('click', async () => {
        const epId = epSel.value;
        if (!epId) return;
        panel.style.display = 'block';
        panel.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-500);">Loading conversation?</div>';
        try {
            const data = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/episodes/${epId}/conversation`).then(r=>r.json());
            panel.innerHTML = _renderConversation(data);
        } catch (e) {
            panel.innerHTML = `<div style="color:var(--red-700);padding:12px;">Error: ${e.message}</div>`;
        }
    });
}

function _renderConversation({ episode, turns, transcript }) {
    const ep = episode;
    const goal = ep.goal_achieved ? '? Goal achieved' : '? Goal not achieved';
    let html = `
        <div style="margin-bottom:12px;padding:10px 14px;background:var(--gray-100);border-radius:6px;font-size:12px;display:flex;flex-wrap:wrap;gap:12px;">
            <span><strong>Run:</strong> ${ep.run_label}</span>
            <span><strong>Scenario:</strong> ${ep.scenario_id}</span>
            <span><strong>Arm:</strong> ${ep.arm}</span>
            <span><strong>Reward:</strong> ${(ep.cumulative_reward??0).toFixed(3)}</span>
            <span><strong>Stress AUC:</strong> ${(ep.stress_auc??0).toFixed(3)}</span>
            <span><strong>Turns:</strong> ${ep.turn_count}</span>
            <span>${goal}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
    `;

    if (transcript?.length) {
        // Transcript has both patient and agent messages
        transcript.forEach(msg => {
            const isAgent = msg.role === 'assistant' || msg.role === 'companion' || msg.sender === 'companion';
            const isPatient = msg.role === 'user' || msg.role === 'patient' || msg.sender === 'patient';
            const content = msg.content || msg.message || msg.text || '';
            const name = isAgent ? 'Agent' : isPatient ? 'Patient' : (msg.role || msg.sender || '?');
            const bg = isAgent ? 'var(--blue-50,#e8f0fe)' : isPatient ? '#fff' : 'var(--gray-50)';
            const align = isAgent ? 'flex-end' : 'flex-start';
            html += `<div style="display:flex;justify-content:${align};">
                <div style="max-width:80%;background:${bg};border:1px solid var(--gray-200);border-radius:8px;padding:8px 12px;font-size:12px;">
                    <div style="font-weight:600;font-size:11px;color:var(--gray-500);margin-bottom:3px;">${name}</div>
                    <div style="white-space:pre-wrap;">${_escapeHtml(content)}</div>
                </div>
            </div>`;
        });
    } else if (turns.length) {
        // No transcript ? show agent turns with metadata
        turns.forEach(t => {
            html += `<div style="display:flex;justify-content:flex-end;">
                <div style="max-width:80%;background:var(--blue-50,#e8f0fe);border:1px solid var(--gray-200);border-radius:8px;padding:8px 12px;font-size:12px;">
                    <div style="font-weight:600;font-size:11px;color:var(--gray-500);margin-bottom:3px;">
                        Agent | Turn ${t.turn_number} | Action: ${t.action || '?'} | Stress: ${(t.stress_index??0).toFixed(2)}
                    </div>
                    <div style="white-space:pre-wrap;">${_escapeHtml(t.response || '')}</div>
                </div>
            </div>`;
        });
        html += `<div style="font-size:11px;color:var(--gray-500);text-align:center;padding:8px;">Patient messages not stored in turn records (no htn_transcripts entry).</div>`;
    } else {
        html += '<div style="padding:12px;color:var(--gray-500);">No conversation data found for this episode.</div>';
    }

    html += '</div>';
    return html;
}

// -- Sensor vs No-Sensor Comparison -------------------------------------------
// The split is determined by physio_source in the scenario, not the arm name:
//   • "sensor" / "simulated" scenarios  → sensor group
//   • scenario_id ending "_no_sensor"   → no-sensor group (physio_source="none")
//   • oldschool arm                     → no-sensor group (ignores physio always)
//
// This lets us compare across ALL arms for the same scenario type, rather than
// just contrasting the oldschool arm vs the rest.

function _renderSensorComparison() {
    const container = document.getElementById('sensor-comparison-section');
    if (!container) return;
    // Both datasets are already canonical from fetchers
    const goalRows = _state.scenarioGoalData || [];
    const tlRows   = _filterByDuration(_state.timelineData) || [];

    if (!goalRows.length && !tlRows.length) {
        container.innerHTML = '<p class="muted" style="padding:8px;">No data yet.</p>';
        return;
    }

    // Classify each (arm, scenario_id) pair:
    //   no-sensor: scenario ends in _no_sensor OR arm is oldschool
    //   sensor: everything else
    const _isNoSensor = (arm, scenarioId) =>
        arm === 'oldschool' || (typeof scenarioId === 'string' && scenarioId.endsWith('_no_sensor'));

    // Aggregate by base scenario (strip _no_sensor suffix for grouping)
    const _baseScenario = sid =>
        typeof sid === 'string' && sid.endsWith('_no_sensor')
            ? sid.slice(0, -'_no_sensor'.length)
            : sid;

    const baseScenarios = [...new Set(goalRows.map(r => _baseScenario(r.scenario_id)))].sort();

    const sensorGoal   = baseScenarios.map(base => {
        const relevant = goalRows.filter(r => !_isNoSensor(r.arm, r.scenario_id)
            && _baseScenario(r.scenario_id) === base);
        if (!relevant.length) return null;
        const totalN = relevant.reduce((s, r) => s + (r.episode_count || 0), 0);
        return totalN ? relevant.reduce((s, r) => s + (r.goal_rate || 0) * (r.episode_count || 0), 0) / totalN : null;
    });
    const noSensorGoal = baseScenarios.map(base => {
        const relevant = goalRows.filter(r => _isNoSensor(r.arm, r.scenario_id)
            && _baseScenario(r.scenario_id) === base);
        if (!relevant.length) return null;
        const totalN = relevant.reduce((s, r) => s + (r.episode_count || 0), 0);
        return totalN ? relevant.reduce((s, r) => s + (r.goal_rate || 0) * (r.episode_count || 0), 0) / totalN : null;
    });

    // Overall episode counts & mean metrics per group
    const sensorEps   = tlRows.filter(r => !_isNoSensor(r.arm, r.scenario_id)).length;
    const noSensorEps = tlRows.filter(r => _isNoSensor(r.arm, r.scenario_id)).length;

    const _groupMean = (rows, key) => {
        const vals = rows.map(r => r[key]).filter(v => v != null);
        return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };
    const sensorMeanReward   = _groupMean(tlRows.filter(r => !_isNoSensor(r.arm, r.scenario_id)), 'cumulative_reward');
    const noSensorMeanReward = _groupMean(tlRows.filter(r => _isNoSensor(r.arm, r.scenario_id)), 'cumulative_reward');
    const sensorStressAuc    = _groupMean(tlRows.filter(r => !_isNoSensor(r.arm, r.scenario_id)), 'stress_auc');
    const noSensorStressAuc  = _groupMean(tlRows.filter(r => _isNoSensor(r.arm, r.scenario_id)), 'stress_auc');

    const fmt = (v, dec=3) => v != null ? v.toFixed(dec) : '—';
    const cardHtml = [
        { label: 'With Sensor (physio_source=sensor/simulated)', color: '#4285F4',
          eps: sensorEps, reward: sensorMeanReward, stress: sensorStressAuc },
        { label: 'No Sensor (_no_sensor suffix or Exp 0 oldschool)', color: '#34A853',
          eps: noSensorEps, reward: noSensorMeanReward, stress: noSensorStressAuc },
    ].map(g => `
        <div class="stat-card" style="border-left:4px solid ${g.color};">
            <span class="stat-value" style="color:${g.color};">${g.eps}</span>
            <span class="stat-label">${g.label}<br>
            <small>Mean Reward: ${fmt(g.reward)} &nbsp;|&nbsp; Stress AUC: ${fmt(g.stress)}</small></span>
        </div>`).join('');

    container.innerHTML = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">${cardHtml}</div>
        <p style="font-size:11px;color:var(--gray-500);margin:0 0 6px;">
            Goal rate per base scenario — sensor vs no-sensor variants.
            Each bar is a weighted average across all arms that ran that scenario type.
            Ctrl+scroll or pinch to zoom.
        </p>
        <div style="overflow-x:auto;">
            <canvas id="sensor-comparison-chart" height="220"></canvas>
        </div>`;

    if (typeof Chart === 'undefined') return;
    const cv = document.getElementById('sensor-comparison-chart');
    if (!cv) return;
    const dynamicW = Math.max(400, baseScenarios.length * 26);
    cv.parentElement.style.overflowX = 'auto';
    cv.style.width    = dynamicW + 'px';
    cv.style.minWidth = dynamicW + 'px';
    cv.width          = dynamicW;

    const hasAnyData = sensorGoal.some(v => v != null) || noSensorGoal.some(v => v != null);
    if (!hasAnyData) {
        cv.parentElement.innerHTML = '<p class="muted" style="padding:8px 0;">No scenario goal data available yet.</p>';
        return;
    }

    new Chart(cv, {
        type: 'bar',
        data: {
            labels: baseScenarios.map(s => s.replace(/_/g, ' ')),
            datasets: [
                {
                    label: 'Sensor / Simulated',
                    data: sensorGoal,
                    backgroundColor: 'rgba(66,133,244,0.7)',
                    borderColor: '#4285F4', borderWidth: 1.5,
                    barPercentage: 0.8, categoryPercentage: 0.7,
                },
                {
                    label: 'No Sensor',
                    data: noSensorGoal,
                    backgroundColor: 'rgba(52,168,83,0.7)',
                    borderColor: '#34A853', borderWidth: 1.5,
                    barPercentage: 0.8, categoryPercentage: 0.7,
                },
            ],
        },
        options: {
            responsive: false, maintainAspectRatio: false,
            scales: {
                x: { ticks: { font: { size: 9 }, maxRotation: 55 } },
                y: {
                    min: 0, max: 1,
                    title: { display: true, text: 'Goal Rate', font: { size: 11 } },
                    ticks: { callback: v => (v * 100).toFixed(0) + '%' },
                },
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11 } } },
                tooltip: {
                    external: _buildBarExternalTooltip('percent'),
                    mode: 'index', intersect: false,
                },
            },
        },
    });
}

function _escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
