/**
 * @fileoverview gui/ui/benchmarksDashboard.js ? Benchmarks view v3
 *
 * v3 additions:
 *  - WMA window slider (default 20, range 5-50)
 *  - Stress AUC WMA line chart
 *  - Reward stats table (min/max/mean/SD per experiment)
 *  - Prompt version markers on learning curves
 *  - Scenario goal-rate per-scenario line chart
 *  - Metric bar charts show all missing metrics
 *  - All per-episode line charts respect WMA window
 */

import config from '../config.js';

const EXP_META = {
    physio_llm:                          { label: 'Exp 0 \u2014 PhysioLLM',               shortLabel: 'Exp 0', color: '#EA4335', bg: 'rgba(234,67,53,0.18)'    },
    physio_llm_cot_mcts:                 { label: 'Exp 1 \u2014 PhysioLLM CoT-MCTS',      shortLabel: 'Exp 1', color: '#FF6D00', bg: 'rgba(255,109,0,0.18)'    },
    physio_mps_mcts:                     { label: 'Exp 2 \u2014 PhysioMPS-MCTS',          shortLabel: 'Exp 2', color: '#4285F4', bg: 'rgba(66,133,244,0.18)'   },
    inertial_physio_mps_mcts:            { label: 'Exp 3 \u2014 Inertial PhysioMPS-MCTS', shortLabel: 'Exp 3', color: '#9C27B0', bg: 'rgba(156,39,176,0.18)'   },
    inertial_physio_llm_cot_mcts:        { label: 'Exp 4 \u2014 Inertial PhysioLLM CoT',  shortLabel: 'Exp 4', color: '#00897B', bg: 'rgba(0,137,123,0.18)'    },
    oldschool:                           { label: 'Exp 5 \u2014 Oldschool (no physio)',    shortLabel: 'Exp 5', color: '#34A853', bg: 'rgba(52,168,83,0.18)'    },
    inertial_hpvoot_physio_mps_mcts:     { label: 'Exp 6 \u2014 Inertial HPVOOT MPS',     shortLabel: 'Exp 6', color: '#E91E8C', bg: 'rgba(233,30,140,0.18)'   },
    inertial_hpvoot_physio_llm_cot_mcts: { label: 'Exp 7 \u2014 Inertial HPVOOT CoT',     shortLabel: 'Exp 7', color: '#FF9800', bg: 'rgba(255,152,0,0.18)'    },
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
    timelineData:   null,
    armEpisodeCounts: {},
    metricsData:    null,
    simStats:       null,
    scenarioGoalData: null,
    physioData:     null,
    critFailData:   null,
    rewardComponentData: null,
};

export async function initBenchmarksDashboard() {
    _attachToolbar();
    await _refresh();
}
export async function refreshBenchmarksDashboard() { await _refresh(); }

async function _refresh() {
    _showSpinner(true);
    try {
        await Promise.all([
            _fetchTimeline(),
            _fetchMetrics(),
            _fetchSimStats(),
            _fetchScenarioGoals(),
            _fetchPhysio(),
            _fetchCritFail(),
            _fetchRewardComponents(),
            _fetchCheckpoints(),
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
        // Merge legacy arm rows into canonical arms
        const merged = {};
        for (const r of (rows || []).map(_canonicalizeArm)) {
            const key = `${r.arm}|${r.scenario_id}`;
            if (!merged[key]) { merged[key] = { ...r }; }
            else {
                const a = merged[key], b = r;
                const totalN = (a.episode_count || 0) + (b.episode_count || 0);
                a.goal_rate = totalN ? ((a.goal_rate || 0) * (a.episode_count || 0) + (b.goal_rate || 0) * (b.episode_count || 0)) / totalN : 0;
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
            _renderMetricBars(); _renderCritFailChart(); _renderPhysioScatter();
        });
    });
}

function _renderAll() {
    _renderSimOverview();
    _renderRewardStatsTable();
    _renderCumulativeRewardDist();
    _renderLearningCurves();
    _renderGoalRateChart();
    _renderCritFailRateChart();
    _renderStressAucChart();
    _renderRewardComponentCharts();
    _renderScenarioHeatmap();
    _renderScenarioGoalRates();
    _renderCritFailStats();
    _renderCritFailChart();
    _renderMetricBars();
    _renderCostCharts();
    _renderPhysioScatter();
    _renderSensorComparison();
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
const _ZOOM_PLUGIN = {
    zoom:  { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
    pan:   { enabled: true, mode: 'x' },
    limits: { x: { min: 'original', max: 'original' } },
};

function _mergeRows(rows) {
    if (!rows?.length) return rows;
    return rows.map(r => {
        const canonical = LEGACY_ALIAS[r.arm];
        if (!canonical) return r;
        return { ...r, arm: canonical, _legacy: true };
    });
}

function _buildLineDatasets(rows, yKey, wmaKey) {
    const datasets = [];
    // timelineData is already canonical; no per-call merging needed
    for (const [arm, meta] of Object.entries(EXP_META)) {
        if (!_state.activeExperiments.has(arm)) continue;
        const ep = rows.filter(r => r.arm === arm);
        if (!ep.length) continue;

        // Re-index per arm so x = 1, 2, 3... regardless of wall-clock gaps
        const data = [];
        const errorData = [];   // missing_arm_slot points
        ep.forEach((r, i) => {
            if (r.missing_arm_slot) {
                errorData.push({ x: i + 1, y: null });
                return;
            }
            if (r.run_restart && i > 0) {
                data.push({ x: i, y: null }); // single null = visible break, no whitespace
            }
            const yVal = r[wmaKey ?? yKey];
            // null WMA means data genuinely unavailable (old-format episodes without goal tracking)
            // push null so spanGaps:false leaves a gap rather than connecting across missing data
            data.push({ x: i + 1, y: (yVal !== null && yVal !== undefined) ? yVal : null });
        });

        datasets.push({
            label: meta.shortLabel,
            data,
            borderColor: meta.color, backgroundColor: 'transparent',
            borderWidth: 2.5, pointRadius: 0, tension: 0.3,
            spanGaps: false,  // null gaps render as breaks in the line
            order: 1,
        });

        // Arm-lag is now shown as a badge below the chart (see _renderLagBadges).
        // No triangle markers here ? they caused a blank canvas extension to the right.

        if (_state.showSD && wmaKey === 'smoothed_reward') {
            const sdData    = ep.map((r, i) => ({ x: i + 1, y: r.smoothed_reward + r.stddev }));
            const sdDataLow = ep.map((r, i) => ({ x: i + 1, y: Math.max(0, r.smoothed_reward - r.stddev) }));
            datasets.push({ label: '_+sd', data: sdData,    borderColor: 'transparent', backgroundColor: meta.bg, fill: '+1', pointRadius: 0, tension: 0.3, spanGaps: false, order: 3 });
            datasets.push({ label: '_-sd', data: sdDataLow, borderColor: 'transparent', backgroundColor: meta.bg, fill: false, pointRadius: 0, tension: 0.3, spanGaps: false, order: 3 });
        }

        if (_state.showRawTraces && yKey) {
            datasets.push({ label: '_raw', data: ep.map((r, i) => ({ x: i + 1, y: r[yKey] })), borderColor: meta.color, backgroundColor: meta.color + '44', borderWidth: 0, pointRadius: 2.5, showLine: false, order: 2 });
        }
    }
    return datasets;
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
    const LEGACY_ARMS = new Set(Object.keys(LEGACY_ALIAS));
    const NEW_ARMS    = new Set(EXP_KEYS);

    // ── Run-restart lines (grey dashed) ──────────────────────────────────────
    for (const [arm] of Object.entries(EXP_META)) {
        if (!_state.activeExperiments.has(arm)) continue;
        const allRows = _state.timelineData?.episodes || _state.timelineData || [];
        // timelineData is already canonical
        const ep = allRows.filter(r => r.arm === arm);
        ep.forEach((r, i) => {
            if (r.run_restart && i > 0) {
                const key = `restart_${arm}_${i}`;
                annotations[key] = {
                    type: 'line', scaleID: 'x', value: i + 1,
                    borderColor: '#bbb', borderWidth: 1, borderDash: [4, 4],
                    label: { display: false },
                };
            }
        });
    }

    // ── STOP-at-checkpoint lines (amber, labelled) ───────────────────────────
    const ckpts = (_state.checkpointEvents || []).filter(ck => ck.stopped);
    if (ckpts.length) {
        const allRows = _state.timelineData?.episodes || _state.timelineData || [];
        const mergedRows = allRows; // already canonical
        const armAbsEpMap = {};
        for (const [arm] of Object.entries(EXP_META)) {
            armAbsEpMap[arm] = mergedRows.filter(r => r.arm === arm);
        }
        ckpts.forEach((ck, ci) => {
            const canonArm = LEGACY_ALIAS[ck.arm] ?? ck.arm;
            if (!_state.activeExperiments.has(canonArm)) return;
            const armRows = armAbsEpMap[canonArm] || [];
            const xVal = Math.min(ck.episode, armRows.length);
            if (xVal < 1) return;
            annotations[`stop_${canonArm}_${ci}`] = {
                type: 'line', scaleID: 'x', value: xVal,
                borderColor: '#f59e0b', borderWidth: 2, borderDash: [8, 4],
                label: {
                    display: true,
                    content: 'STOP',
                    position: 'start',
                    font: { size: 9 },
                    color: '#f59e0b',
                    backgroundColor: 'transparent',
                    padding: 2,
                },
            };
        });
    }

    // ── Legacy → new experiment rename boundary (gray solid line) ────────────
    // Drawn at the x position where legacy data ends and new arm name begins,
    // for each arm that has legacy data folded in.
    const allRows = _state.timelineData?.episodes || _state.timelineData || [];
    for (const [legacyArm, canonArm] of Object.entries(LEGACY_ALIAS)) {
        if (!_state.activeExperiments.has(canonArm)) continue;
        const legacyCount = allRows.filter(r => r.arm === legacyArm).length;
        if (legacyCount > 0 && allRows.some(r => r.arm === canonArm)) {
            annotations[`legacy_boundary_${canonArm}`] = {
                type: 'line', scaleID: 'x', value: legacyCount,
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
    const activeExpCount = EXP_KEYS.filter(k => dbRows.some(r => r.arm === k)).length;
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
    const el = document.getElementById('reward-stats-table');
    if (!el || !_state.timelineData?.length) return;
    // timelineData is already canonicalized by _fetchTimeline
    const rows = _filterByDuration(_state.timelineData) ?? [];
    const stats = EXP_KEYS.map(arm => {
        const ep = rows.filter(r => r.arm === arm);
        if (!ep.length) return null;
        const vals = ep.map(r => r.cumulative_reward).filter(v => v != null);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const sd   = Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length);
        const goalPct = (ep.filter(r => r.goal_achieved).length / ep.length * 100).toFixed(1);
        const stressVals = ep.map(r => r.stress_auc).filter(v => v != null);
        const stressMean = stressVals.length ? (stressVals.reduce((a, b) => a + b, 0) / stressVals.length).toFixed(3) : '?';
        return { arm, meta: EXP_META[arm], n: vals.length, min: Math.min(...vals).toFixed(2), max: Math.max(...vals).toFixed(2), mean: mean.toFixed(2), sd: sd.toFixed(2), goalPct, stressMean };
    }).filter(Boolean);

    el.innerHTML = `<table style="border-collapse:collapse;width:100%;font-size:12px;">
        <thead><tr style="background:var(--gray-50);border-bottom:1px solid var(--gray-200);">
            <th style="text-align:left;padding:6px 10px;">Experiment</th>
            <th style="padding:6px 10px;">N</th>
            <th style="padding:6px 10px;">Min Reward</th>
            <th style="padding:6px 10px;">Max Reward</th>
            <th style="padding:6px 10px;">Mean &plusmn; SD</th>
            <th style="padding:6px 10px;">Goal Rate</th>
            <th style="padding:6px 10px;" title="Mean calmness per episode = avg(1−stress_index). Higher ↑ is better. 1.0 = calm throughout, 0.0 = maximally stressed every turn.">Avg Stress AUC ↑</th>
        </tr></thead>
        <tbody>${stats.map(s => `<tr style="border-bottom:1px solid var(--gray-100);">
            <td style="padding:6px 10px;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.meta.color};margin-right:6px;"></span>${s.meta.label}</td>
            <td style="text-align:center;padding:6px 10px;">${s.n}</td>
            <td style="text-align:center;padding:6px 10px;">${s.min}</td>
            <td style="text-align:center;padding:6px 10px;">${s.max}</td>
            <td style="text-align:center;padding:6px 10px;">${s.mean} ± ${s.sd}</td>
            <td style="text-align:center;padding:6px 10px;">${s.goalPct}%</td>
            <td style="text-align:center;padding:6px 10px;">${s.stressMean}</td>
        </tr>`).join('')}</tbody>
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
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { type: 'linear', title: { display: true, text: 'Episode number (per arm)', font: { size: 11 } }, ticks: { callback: v => Math.round(v) } },
                y: { title: { display: true, text: 'Reward per Turn (WMA)', font: { size: 11 } } },
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, filter: i => !i.text.startsWith('_') } },
                annotation: { annotations: _buildRestartAnnotations() },
                zoom: _ZOOM_PLUGIN,
                tooltip: {
                    callbacks: {
                        footer(items) {
                            const x = items[0]?.parsed?.x;
                            const armLabel = items.find(i => !i.dataset.label.startsWith('_'))?.dataset?.label;
                            const armKey = Object.entries(EXP_META).find(([,m]) => m.label === armLabel)?.[0];
                            const d = _state.timelineData?.find(r => r.arm === armKey && r.global_episode_idx === x);
                            if (!d) return [];
                            const lines = [
                                `Run: ${d.run_label}`,
                                `Scenario: ${d.scenario_id || '?'}`,
                                `Turns: ${d.turn_count ?? '?'}  |  Reward/turn: ${d.reward_per_turn?.toFixed(3) ?? '?'}`,
                                `Cumul. reward: ${d.cumulative_reward?.toFixed(3) ?? '?'}`,
                                `Stress AUC: ${d.stress_auc?.toFixed(3) ?? '?'}`,
                            ];
                            if (d.run_restart) lines.push('⟳ Restart (code change)');
                            return lines;
                        },
                    },
                },
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
    // Only include episodes where goal_achieved is not null ? NULL episodes were
    // old-format runs without goal tracking and have been removed from the DB.
    // Lines end naturally where data ends; no bridging or interpolation.
    const datasets = _buildLineDatasets(rows, 'goal_achieved', 'goal_rate_wma');
    new Chart(canvas, {
        type: 'line', data: { datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { type: 'linear', title: { display: true, text: 'Episode number (per arm)', font: { size: 11 } }, ticks: { callback: v => Math.round(v) } },
                y: { min: 0, max: 1, title: { display: true, text: 'Goal Rate (WMA)', font: { size: 11 } }, ticks: { callback: v => (v*100).toFixed(0)+'%' } },
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, filter: i => !i.text.startsWith('_') } },
                annotation: { annotations: _buildRestartAnnotations() },
                zoom: _ZOOM_PLUGIN,
                tooltip: {
                    callbacks: {
                        label: item => `${item.dataset.label}: ${(item.parsed.y * 100).toFixed(1)}%`,
                    }
                },
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
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { type: 'linear', title: { display: true, text: 'Episode number (per arm)', font: { size: 11 } }, ticks: { callback: v => Math.round(v) } },
                y: { min: 0, max: 1, title: { display: true, text: 'Critical Failure Rate (WMA)', font: { size: 11 } },
                     ticks: { callback: v => (v * 100).toFixed(0) + '%' } },
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, filter: i => !i.text.startsWith('_') } },
                annotation: { annotations: _buildRestartAnnotations() },
                zoom: _ZOOM_PLUGIN,
                tooltip: {
                    callbacks: {
                        label: item => `${item.dataset.label}: ${(item.parsed.y * 100).toFixed(1)}%`,
                        afterBody: () => ['', '↓ Lower = fewer episodes without goal completion'],
                    },
                },
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
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { type: 'linear', title: { display: true, text: 'Episode number (per arm)', font: { size: 11 } }, ticks: { callback: v => Math.round(v) } },
                y: { min: 0, max: 1, title: { display: true, text: 'Stress AUC (↑ better)', font: { size: 11 } } },
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, filter: i => !i.text.startsWith('_') } },
                annotation: { annotations: _buildRestartAnnotations() },
                zoom: _ZOOM_PLUGIN,
                tooltip: {
                    callbacks: {
                        afterBody: () => ['', '↑ Higher = calmer patient throughout the session'],
                    }
                },
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
                    callbacks: {
                        title: ctx => ctx[0]?.label ?? '',
                        label: ctx => {
                            const ds = ctx.dataset;
                            const arm = EXP_META[ds._arm]?.label ?? ds._arm ?? '';
                            return ` ${arm}  ?  ${ds._runLabel ?? ''}:  ${ctx.parsed.y?.toFixed(2) ?? 'n/a'}`;
                        },
                    },
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

    const scenarios = [...new Set(rows.map(r => r.scenario_id))].sort();
    const activeArms = EXP_KEYS.filter(arm => _state.activeExperiments.has(arm) && rows.some(r => r.arm === arm));

    // Sort arms by mean goal rate DESC so the smallest bar (worst arm) is drawn last (front).
    const armMeans = activeArms.map(arm => {
        const vals = scenarios.map(sc => {
            const r = rows.find(x => x.arm === arm && x.scenario_id === sc);
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
            const r = rows.find(x => x.arm === arm && x.scenario_id === sc);
            return r?.episode_count ?? 0;
        }),
        data: scenarios.map(sc => {
            const r = rows.find(x => x.arm === arm && x.scenario_id === sc);
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
                    callbacks: {
                        label: ctx => {
                            const pct = ctx.parsed.y != null ? (ctx.parsed.y * 100).toFixed(1) + '%' : 'n/a';
                            const n   = ctx.dataset._epCounts?.[ctx.dataIndex] ?? '?';
                            return ` ${ctx.dataset.label}: ${pct}  (n=${n})`;
                        },
                    },
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
    const rows = _state.scenarioGoalData;
    if (!rows?.length) { el.innerHTML = '<p class="muted">No scenario goal data.</p>'; return; }

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
    const colorCell = (v, arm) => {
        if (v == null) return `<td style="text-align:center;color:var(--gray-400);">—</td>`;
        const col     = EXP_META[arm]?.color ?? '#888';
        const opacity = Math.round(20 + v * 70);
        return `<td style="text-align:center;background:${col}${opacity.toString(16).padStart(2, '0')};font-weight:${v >= 0.5 ? '600' : '400'};">${fmt(v)}</td>`;
    };

    el.innerHTML = `<table style="border-collapse:collapse;width:100%;font-size:12px;">
        <thead>
          <tr style="background:var(--gray-50);position:sticky;top:0;border-bottom:1px solid var(--gray-200);">
            <th style="text-align:left;padding:5px 8px;">#</th>
            <th style="text-align:left;padding:5px 8px;">Scenario</th>
            ${armsWithData.map(a => `<th style="padding:5px 8px;color:${EXP_META[a].color};">${EXP_META[a].shortLabel}</th>`).join('')}
            <th style="padding:5px 8px;">Mean</th>
          </tr>
          <tr style="background:var(--gray-100);position:sticky;top:28px;border-bottom:2px solid var(--gray-200);font-size:11px;color:var(--gray-500);">
            <td colspan="2" style="padding:3px 8px;font-style:italic;">Episodes (total incl. legacy)</td>
            ${armsWithData.map(a => `<td style="text-align:center;padding:3px 8px;">${armTotals[a] ?? 0}</td>`).join('')}
            <td></td>
          </tr>
        </thead>
        <tbody>${tableData.map((d, i) => `<tr style="border-bottom:1px solid var(--gray-100);">
            <td style="padding:4px 8px;color:var(--gray-500);">${i + 1}</td>
            <td style="padding:4px 8px;font-family:monospace;font-size:11px;">${d.sc}</td>
            ${armsWithData.map(a => colorCell(d.armRows[a]?.rate, a)).join('')}
            <td style="text-align:center;font-weight:600;">${fmt(d.meanRate)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function _wireScenarioRankToggles() {
    const container = document.getElementById('scenario-rank-toggles');
    if (!container) return;
    container.querySelectorAll('button[data-arm]').forEach(btn => {
        btn.onclick = () => {
            container.querySelectorAll('button').forEach(b => b.className = 'secondary');
            btn.className = 'primary';
            _renderScenarioRankTable(btn.dataset.arm);
        };
    });
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

function _renderCritFailChart() {
    if (typeof Chart === 'undefined') return;
    const canvas = _destroyChart('crit-fail-chart');
    if (!canvas) return;
    const rows = _state.critFailData;
    if (!rows?.length) return;

    // All data is already canonicalized by _fetchCritFail
    const scenarios = [...new Set(rows.map(r => r.scenario_id).filter(Boolean))].sort();
    if (!scenarios.length) return;

    // Overlapping bars — sort by mean failure rate DESC (worst first = back)
    const armMeansF = EXP_KEYS.filter(arm => _state.activeExperiments.has(arm) && rows.some(r => r.arm === arm)).map(arm => {
        const vals = scenarios.map(sc => {
            const row = rows.find(r => r.arm === arm && r.scenario_id === sc);
            if (!row || !row.total_episodes) return 0;
            return row.failed_episodes / row.total_episodes;
        });
        return { arm, mean: vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length) };
    });
    if (!armMeansF.length) return;
    armMeansF.sort((a, b) => b.mean - a.mean);

    const datasets = armMeansF.map(({ arm }) => {
        const meta = EXP_META[arm];
        return {
            label: meta.shortLabel,
            backgroundColor: meta.color + 'bb',
            borderColor:     meta.color,
            borderWidth: 1,
            barPercentage:      1.0,
            categoryPercentage: 0.85,
            _epCounts: scenarios.map(sc => {
                const row = rows.find(r => r.arm === arm && r.scenario_id === sc);
                return row ? row.total_episodes : 0;
            }),
            data: scenarios.map(sc => {
                const row = rows.find(r => r.arm === arm && r.scenario_id === sc);
                if (!row || !row.total_episodes) return 0;
                return Math.round(row.failed_episodes / row.total_episodes * 1000) / 10;
            }),
        };
    });

    const dynamicW = Math.max(600, scenarios.length * 14);
    canvas.parentElement.style.overflowX = 'auto';
    canvas.style.width = dynamicW + 'px';
    canvas.style.minWidth = dynamicW + 'px';
    canvas.width = dynamicW;

    new Chart(canvas, {
        type: 'bar',
        data: { labels: scenarios.map(s => s.replace(/_/g, ' ')), datasets },
        options: {
            responsive: false, maintainAspectRatio: false,
            scales: {
                x: { ticks: { font: { size: 9 }, maxRotation: 55 } },
                y: { min: 0, max: 100, title: { display: true, text: 'Critical Failure %', font: { size: 11 } },
                     ticks: { callback: v => v + '%' } },
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const n = ctx.dataset._epCounts?.[ctx.dataIndex] ?? '?';
                            return ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%  (n=${n})`;
                        },
                    },
                    mode: 'index', intersect: false,
                },
            },
        },
    });
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
                tooltip: { mode: 'index', intersect: false },
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

    // One chart per dimension, all 3 experiments on the same chart
    for (const dim of dims) {
        const canvasId = `rc-chart-${dim.key}`;
        const wrap2 = document.createElement('div');
        wrap2.style.cssText = 'margin-bottom:28px;';
        wrap2.innerHTML = `<h4 style="margin:0 0 6px;font-size:13px;color:var(--gray-700);">${dim.label} ? WMA (window ${_state.wmaWindow})</h4><canvas id="${canvasId}" height="130"></canvas>`;
        wrap.appendChild(wrap2);

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

        const ctx = document.getElementById(canvasId)?.getContext('2d');
        if (!ctx) continue;
        new Chart(ctx, {
            type: 'line',
            data: { datasets },
            options: {
                animation: false,
                responsive: true,
                parsing: false,
                plugins: { legend: { labels: { font: { size: 11 } } }, tooltip: { mode: 'index', intersect: false } },
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
    // metricsData is already canonical from _fetchMetrics
    const rows = _state.metricsData || [];
    if (!rows.length) return;

    const metrics = [
        { key: 'mean_reward',        label: 'Mean Cumul. Reward',    canvas: 'metric-bar-reward'  },
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
    const runIds = [...new Set(rows.map(r => r.run_label?.split('/')[0]?.trim()))].filter(Boolean).sort();
    // Only show arms that have actual data in this run set (after legacy merge)
    const activeArms = EXP_KEYS.filter(arm =>
        _state.activeExperiments.has(arm) && rows.some(r => r.arm === arm)
    );
    if (!activeArms.length || !runIds.length) return;

    metrics.forEach(({ key, label, canvas: cid }) => {
        const cv = _destroyChart(cid);
        if (!cv) return;

        // Pre-compute per-arm values so we can determine draw order.
        const armValues = activeArms.map(arm => ({
            arm,
            meta: EXP_META[arm],
            data: runIds.map(rid => {
                const row = rows.find(r => r.arm === arm && r.run_label?.startsWith(rid));
                if (!row) return null;
                return Math.round((row[key] ?? 0) * 1000) / 1000;
            }),
        }));

        // Draw order: largest-sum arm first (back), smallest-sum arm last (front).
        // This ensures the shortest bar is always fully visible at the front.
        const armSums = armValues.map(av => av.data.reduce((s, v) => s + (v ?? 0), 0));
        const drawOrder = armValues
            .map((_, i) => i)
            .sort((a, b) => armSums[b] - armSums[a]);

        const datasets = drawOrder.map((idx, rank) => {
            const { arm, meta, data } = armValues[idx];
            return {
                label: meta.shortLabel,
                backgroundColor: meta.color + 'aa',
                borderColor: meta.color,
                borderWidth: 1.5,
                borderRadius: 3,
                // Full overlap — all bars occupy the same category slot
                barPercentage: 0.85,
                categoryPercentage: 1.0,
                maxBarThickness: 36,
                // Lower order = drawn later = on top in Chart.js
                order: rank,
                data,
            };
        });

        new Chart(cv, {
            type: 'bar',
            data: { labels: runIds, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { font: { size: 9 }, maxRotation: 45 } },
                    y: { beginAtZero: true, ticks: { font: { size: 10 } } },
                },
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: label, font: { size: 11 }, padding: { bottom: 4 } },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: (ctx) => {
                                return ` ${ctx.dataset.label}: ${ctx.parsed.y ?? 'n/a'}`;
                            },
                        },
                    },
                },
            },
        });
    });
}

// -- Cost & LLM Calls Charts ---------------------------------------------------
function _renderCostCharts() {
    if (typeof Chart === 'undefined') return;
    // timelineData is an array of episode rows (same source as learning curves)
    const rows = _state.timelineData;
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
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'top' }, title: { display: true, text: 'Cost per Episode (USD)' } },
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
        { label: 'No Sensor (_no_sensor suffix or oldschool)', color: '#34A853',
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
            Scroll/pinch to zoom.
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
                    callbacks: {
                        label: ctx => ctx.parsed.y != null
                            ? ` ${ctx.dataset.label}: ${(ctx.parsed.y * 100).toFixed(1)}%`
                            : ` ${ctx.dataset.label}: no data`,
                        footer: items => {
                            const base = baseScenarios[items[0]?.dataIndex];
                            if (!base) return [];
                            const sCnt = goalRows.filter(r => !_isNoSensor(r.arm, r.scenario_id)
                                && _baseScenario(r.scenario_id) === base)
                                .reduce((s, r) => s + (r.episode_count || 0), 0);
                            const nsCnt = goalRows.filter(r => _isNoSensor(r.arm, r.scenario_id)
                                && _baseScenario(r.scenario_id) === base)
                                .reduce((s, r) => s + (r.episode_count || 0), 0);
                            return [`sensor n=${sCnt}  |  no-sensor n=${nsCnt}`];
                        },
                    },
                    mode: 'index', intersect: false,
                },
            },
        },
    });
}

function _escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
