/**
 * @fileoverview gui/ui/benchmarksDashboard.js — Benchmarks view v3
 *
 * v3 additions:
 *  • WMA window slider (default 20, range 5-50)
 *  • Stress AUC WMA line chart
 *  • Reward stats table (min/max/mean/SD per experiment)
 *  • Prompt version markers on learning curves
 *  • Scenario goal-rate per-scenario line chart
 *  • Metric bar charts show all missing metrics
 *  • All per-episode line charts respect WMA window
 */

import config from '../config.js';

const EXP_META = {
    htn_mcts:          { label: 'Exp 1 — HTN + MCTS',                color: '#4285F4', bg: 'rgba(66,133,244,0.18)'  },
    oldschool:         { label: 'Exp 2 — LLM Agents w/o Physiology', color: '#34A853', bg: 'rgba(52,168,83,0.18)'   },
    hysteresis_prompt: { label: 'Exp 3 — Hysteresis Prompt',         color: '#EA4335', bg: 'rgba(234,67,53,0.18)'   },
};
const EXP_KEYS = Object.keys(EXP_META);

let _state = {
    activeExperiments: new Set(EXP_KEYS),
    showRawTraces:  false,
    showSD:         false,
    showCritFail:   false,
    durationDays:   0,
    wmaWindow:      20,
    timelineData:   null,
    metricsData:    null,
    simStats:       null,
    scenarioGoalData: null,
    physioData:     null,
    critFailData:   null,
    promptVersions: null,
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
            _fetchPromptVersions(),
        ]);
        _renderAll();
    } catch (e) { console.error('[benchmarks] refresh error', e); }
    finally { _showSpinner(false); }
}

// ── Fetchers ─────────────────────────────────────────────────────────────────
async function _fetchTimeline() {
    const { rows } = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/experiment-timeline?window=${_state.wmaWindow}`).then(r=>r.json());
    _state.timelineData = rows;
}
async function _fetchMetrics() {
    const { rows } = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/experiment-metrics`).then(r=>r.json());
    _state.metricsData = rows;
}
async function _fetchSimStats() {
    try { const r = await fetch(`${config.ORCHESTRATOR_URL}/api/analysis/stats`); if (r.ok) _state.simStats = await r.json(); } catch { _state.simStats = null; }
}
async function _fetchScenarioGoals() {
    try { const { rows } = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/scenario-goal-rates`).then(r=>r.json()); _state.scenarioGoalData = rows; } catch { _state.scenarioGoalData = null; }
}
async function _fetchPhysio() {
    try { const { rows } = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/physio-reward`).then(r=>r.json()); _state.physioData = rows; } catch { _state.physioData = null; }
}
async function _fetchCritFail() {
    try { const { rows } = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/critical-failures`).then(r=>r.json()); _state.critFailData = rows; } catch { _state.critFailData = null; }
}
async function _fetchPromptVersions() {
    try { const { rows } = await fetch(`${config.ORCHESTRATOR_URL}/api/benchmarks/prompt-versions`).then(r=>r.json()); _state.promptVersions = rows; } catch { _state.promptVersions = null; }
}

// ── Toolbar ─────────────────────────────────────────────────────────────────
function _attachToolbar() {
    const rawCb = document.getElementById('show-raw-traces');
    if (rawCb) {
        rawCb.title = 'Show individual episode reward dots behind the Weighted Moving Average line.';
        rawCb.addEventListener('change', () => { _state.showRawTraces = rawCb.checked; _renderLearningCurves(); _renderGoalRateChart(); _renderStressAucChart(); });
        const lbl = rawCb.closest('label') || rawCb.parentElement;
        if (lbl && !lbl.querySelector('.trace-tooltip-hint')) {
            const hint = document.createElement('span');
            hint.className = 'trace-tooltip-hint'; hint.title = rawCb.title; hint.textContent = ' ⓘ';
            hint.style.cssText = 'cursor:help;color:var(--gray-500);font-size:12px;';
            lbl.appendChild(hint);
        }
    }
    const sdCb = document.getElementById('show-sd-band');
    if (sdCb) sdCb.addEventListener('change', () => { _state.showSD = sdCb.checked; _renderLearningCurves(); _renderGoalRateChart(); _renderStressAucChart(); });
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
            _renderLearningCurves(); _renderGoalRateChart(); _renderStressAucChart(); _renderRewardStatsTable();
        });
    }

    document.querySelectorAll('[data-exp-toggle]').forEach(btn => {
        btn.addEventListener('click', () => {
            const exp = btn.dataset.expToggle;
            if (_state.activeExperiments.has(exp)) _state.activeExperiments.delete(exp);
            else _state.activeExperiments.add(exp);
            btn.classList.toggle('inactive', !_state.activeExperiments.has(exp));
            _renderLearningCurves(); _renderGoalRateChart(); _renderStressAucChart();
            _renderMetricBars(); _renderCritFailChart(); _renderPhysioScatter();
        });
    });
}

function _renderAll() {
    _renderSimOverview();
    _renderRewardStatsTable();
    _renderLearningCurves();
    _renderGoalRateChart();
    _renderStressAucChart();
    _renderScenarioHeatmap();
    _renderScenarioGoalRates();
    _renderCritFailStats();
    _renderCritFailChart();
    _renderMetricBars();
    _renderPhysioScatter();
}

// ── Helpers ──────────────────────────────────────────────────────────────────
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

// Build common line datasets for any per-episode metric (pre-smoothed in server response)
function _buildLineDatasets(rows, yKey, wmaKey) {
    const datasets = [];
    for (const [arm, meta] of Object.entries(EXP_META)) {
        if (!_state.activeExperiments.has(arm)) continue;
        const ep = rows.filter(r => r.arm === arm);
        if (!ep.length) continue;
        datasets.push({
            label: meta.label,
            data:  ep.map(r => ({ x: r.global_episode_idx, y: r[wmaKey ?? yKey] })),
            borderColor: meta.color, backgroundColor: 'transparent',
            borderWidth: 2.5, pointRadius: 0, tension: 0.3, order: 1,
        });
        if (_state.showSD && wmaKey === 'smoothed_reward') {
            datasets.push({ label: '_+sd', data: ep.map(r => ({ x: r.global_episode_idx, y: r.smoothed_reward + r.stddev })), borderColor: 'transparent', backgroundColor: meta.bg, fill: '+1', pointRadius: 0, tension: 0.3, order: 3 });
            datasets.push({ label: '_-sd', data: ep.map(r => ({ x: r.global_episode_idx, y: Math.max(0, r.smoothed_reward - r.stddev) })), borderColor: 'transparent', backgroundColor: meta.bg, fill: false, pointRadius: 0, tension: 0.3, order: 3 });
        }
        if (_state.showRawTraces && yKey) {
            datasets.push({ label: '_raw', data: ep.map(r => ({ x: r.global_episode_idx, y: r[yKey] })), borderColor: meta.color, backgroundColor: meta.color + '44', borderWidth: 0, pointRadius: 2.5, showLine: false, order: 2 });
        }
    }
    return datasets;
}

// ── Sim Overview ─────────────────────────────────────────────────────────────
function _renderSimOverview() {
    const el = document.getElementById('simulation-overview-stats');
    if (!el) return;
    const dbRows = _state.metricsData;
    const total = dbRows?.reduce((a, r) => a + (r.total_episodes || 0), 0) ?? 0;
    const runs  = new Set(dbRows?.map(r => r.run_id) ?? []).size;
    let peakSmoothed = 0;
    _state.timelineData?.forEach(r => { if (r.smoothed_reward > peakSmoothed) peakSmoothed = r.smoothed_reward; });
    const goalSum   = dbRows?.reduce((a, r) => a + (r.goal_rate || 0) * (r.total_episodes || 0), 0) ?? 0;
    const goalRate  = total ? (goalSum / total * 100).toFixed(1) + '%' : '—';
    el.innerHTML = `
        <div class="stat-card"><span class="stat-value">${total}</span><span class="stat-label">Training Episodes</span></div>
        <div class="stat-card"><span class="stat-value">${runs}</span><span class="stat-label">Training Runs</span></div>
        <div class="stat-card"><span class="stat-value">${goalRate}</span><span class="stat-label">Overall Goal Rate</span></div>
        <div class="stat-card" title="Peak ${_state.wmaWindow}-episode Weighted Moving Average of cumulative per-turn reward">
            <span class="stat-value">${peakSmoothed.toFixed(2)}</span>
            <span class="stat-label">Peak WMA Reward ⓘ</span>
        </div>
        <div class="stat-card"><span class="stat-value">${EXP_KEYS.length}</span><span class="stat-label">Experiments</span></div>
    `;
}

// ── Reward Stats Table ───────────────────────────────────────────────────────
function _renderRewardStatsTable() {
    const el = document.getElementById('reward-stats-table');
    if (!el || !_state.timelineData?.length) return;
    const rows = _filterByDuration(_state.timelineData) ?? [];
    const stats = EXP_KEYS.map(arm => {
        const ep = rows.filter(r => r.arm === arm);
        if (!ep.length) return null;
        const vals = ep.map(r => r.cumulative_reward).filter(v => v != null);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const sd   = Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length);
        const goalPct = (ep.filter(r => r.goal_achieved).length / ep.length * 100).toFixed(1);
        const stressVals = ep.map(r => r.stress_auc).filter(v => v != null);
        const stressMean = stressVals.length ? (stressVals.reduce((a, b) => a + b, 0) / stressVals.length).toFixed(3) : '—';
        return { arm, meta: EXP_META[arm], n: vals.length, min: Math.min(...vals).toFixed(2), max: Math.max(...vals).toFixed(2), mean: mean.toFixed(2), sd: sd.toFixed(2), goalPct, stressMean };
    }).filter(Boolean);

    el.innerHTML = `<table style="border-collapse:collapse;width:100%;font-size:12px;">
        <thead><tr style="background:var(--gray-50);border-bottom:1px solid var(--gray-200);">
            <th style="text-align:left;padding:6px 10px;">Experiment</th>
            <th style="padding:6px 10px;">N</th>
            <th style="padding:6px 10px;">Min Reward</th>
            <th style="padding:6px 10px;">Max Reward</th>
            <th style="padding:6px 10px;">Mean ± SD</th>
            <th style="padding:6px 10px;">Goal Rate</th>
            <th style="padding:6px 10px;">Avg Stress AUC</th>
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

// ── Learning Curves ──────────────────────────────────────────────────────────
function _buildRestartAnnotations() {
    const annotations = {};
    _state.timelineData
        ?.filter(r => r.run_restart && _state.activeExperiments.has(r.arm))
        .forEach((r, i) => {
            annotations['r' + i] = { type: 'line', scaleID: 'x', value: r.global_episode_idx, borderColor: '#bbb', borderWidth: 1, borderDash: [4, 4], label: { display: false } };
        });
    return annotations;
}

function _buildPromptAnnotations(baseAnnotations) {
    if (!_state.promptVersions?.length || !_state.timelineData?.length) return baseAnnotations;
    const allEps = _state.timelineData;
    _state.promptVersions.forEach((pv, i) => {
        const ts = pv.deployed_at || pv.created_at;
        if (!ts) return;
        // Find closest global_episode_idx by started_at
        const closest = allEps.reduce((best, r) => Math.abs(r.started_at - ts) < Math.abs((best?.started_at ?? Infinity) - ts) ? r : best, null);
        if (!closest) return;
        baseAnnotations['pv_' + i] = {
            type: 'line', scaleID: 'x', value: closest.global_episode_idx,
            borderColor: '#FF9800', borderWidth: 1.5, borderDash: [2, 4],
            label: { display: true, content: '✏ prompt', position: 'end', color: '#FF9800', font: { size: 9 }, backgroundColor: 'rgba(255,255,255,0.85)', yAdjust: 10 + (i % 3) * 14 },
        };
    });
    return baseAnnotations;
}

function _renderLearningCurves() {
    if (typeof Chart === 'undefined') return;
    const canvas = _destroyChart('learning-curves-chart');
    if (!canvas) return;
    const rows = _filterByDuration(_state.timelineData);
    if (!rows?.length) return;

    const datasets = _buildLineDatasets(rows, 'cumulative_reward', 'smoothed_reward');

    if (_state.showCritFail) {
        for (const [arm, meta] of Object.entries(EXP_META)) {
            if (!_state.activeExperiments.has(arm)) continue;
            const fails = rows.filter(r => r.arm === arm && r.goal_achieved === 0);
            if (fails.length) datasets.push({ label: '_fail_' + arm, data: fails.map(r => ({ x: r.global_episode_idx, y: r.cumulative_reward ?? 0 })), borderColor: '#c62828', backgroundColor: '#c6282899', borderWidth: 1.5, pointRadius: 6, pointStyle: 'crossRot', showLine: false, order: 0 });
        }
    }

    new Chart(canvas, {
        type: 'line', data: { datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { type: 'linear', title: { display: true, text: 'Episode (global index)', font: { size: 11 } } },
                y: { title: { display: true, text: 'Cumulative Reward', font: { size: 11 } } },
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, filter: i => !i.text.startsWith('_') } },
                annotation: { annotations: _buildPromptAnnotations(_buildRestartAnnotations()) },
                tooltip: {
                    callbacks: {
                        footer(items) {
                            const x = items[0]?.parsed?.x;
                            const armLabel = items.find(i => !i.dataset.label.startsWith('_'))?.dataset?.label;
                            const armKey = Object.entries(EXP_META).find(([,m]) => m.label === armLabel)?.[0];
                            const d = _state.timelineData?.find(r => r.arm === armKey && r.global_episode_idx === x);
                            if (!d) return [];
                            const lines = [`Run: ${d.run_label}`, `Scenario: ${d.scenario_id || '—'}`, `Stress AUC: ${d.stress_auc?.toFixed(3) ?? '—'}`];
                            if (d.run_restart) lines.push('▶ Restart (code change)');
                            return lines;
                        },
                    },
                },
            },
        },
    });
}

// ── Goal Rate Chart ──────────────────────────────────────────────────────────
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
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { type: 'linear', title: { display: true, text: 'Episode (global index)', font: { size: 11 } } },
                y: { min: 0, max: 1, title: { display: true, text: 'Goal Rate', font: { size: 11 } }, ticks: { callback: v => (v*100).toFixed(0)+'%' } },
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, filter: i => !i.text.startsWith('_') } },
                annotation: { annotations: _buildRestartAnnotations() },
            },
        },
    });
}

// ── Stress AUC Chart ──────────────────────────────────────────────────────────
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
                x: { type: 'linear', title: { display: true, text: 'Episode (global index)', font: { size: 11 } } },
                y: { min: 0, max: 1, title: { display: true, text: 'Stress AUC', font: { size: 11 } } },
            },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, filter: i => !i.text.startsWith('_') } },
                annotation: { annotations: _buildRestartAnnotations() },
            },
        },
    });
}

// ── Scenario Heatmap ─────────────────────────────────────────────────────────
function _renderScenarioHeatmap() {
    if (typeof Chart === 'undefined') return;
    const canvas = _destroyChart('scenario-heatmap-chart');
    if (!canvas) return;
    const rows = _filterByDuration(_state.timelineData);
    if (!rows?.length) return;
    const scenarios = [...new Set(rows.map(r => r.scenario_id).filter(Boolean))].sort();
    const grid = {};
    scenarios.forEach(sc => { grid[sc] = {}; EXP_KEYS.forEach(a => { grid[sc][a] = []; }); });
    rows.forEach(r => { if (r.scenario_id && r.cumulative_reward != null) grid[r.scenario_id]?.[r.arm]?.push(r.cumulative_reward); });
    const datasets = EXP_KEYS.map(arm => ({
        label: EXP_META[arm].label,
        backgroundColor: EXP_META[arm].color + 'CC', borderColor: EXP_META[arm].color, borderWidth: 1,
        data: scenarios.map(sc => { const v = grid[sc][arm]; return v.length ? Math.round(v.reduce((a, b) => a+b, 0)/v.length*100)/100 : null; }),
    }));
    new Chart(canvas, {
        type: 'bar', data: { labels: scenarios.map(s=>s.replace(/_/g,' ')), datasets },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { font:{size:9}, maxRotation:45 } }, y: { title:{display:true,text:'Avg Cumulative Reward',font:{size:11}} } }, plugins: { legend: { position:'top', labels:{boxWidth:12,font:{size:11}} } } },
    });
}

// ── Scenario Goal Rate Chart ──────────────────────────────────────────────────
function _renderScenarioGoalRates() {
    if (typeof Chart === 'undefined') return;
    const canvas = _destroyChart('scenario-goal-chart');
    if (!canvas) return;
    const rows = _state.scenarioGoalData;
    if (!rows?.length) return;
    const scenarios = [...new Set(rows.map(r => r.scenario_id))].sort();
    const datasets = EXP_KEYS.map(arm => ({
        label: EXP_META[arm].label,
        backgroundColor: EXP_META[arm].color + 'BB', borderColor: EXP_META[arm].color, borderWidth: 1.5,
        data: scenarios.map(sc => { const row = rows.find(r => r.arm === arm && r.scenario_id === sc); return row ? Math.round(row.goal_rate*1000)/1000 : null; }),
    }));
    new Chart(canvas, {
        type: 'bar', data: { labels: scenarios.map(s=>s.replace(/_/g,' ')), datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { x: { ticks:{font:{size:9},maxRotation:45} }, y: { min:0,max:1,title:{display:true,text:'Goal Rate',font:{size:11}},ticks:{callback:v=>(v*100).toFixed(0)+'%'} } },
            plugins: { legend: { position:'top', labels:{boxWidth:12,font:{size:11}} } },
        },
    });
}

// ── Critical Failure Stats ────────────────────────────────────────────────────
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
        return `<div class="stat-card" style="border-left:4px solid ${meta.color};"><span class="stat-value" style="color:${meta.color};">${rate}%</span><span class="stat-label" style="text-align:center;">${meta.label.split('—')[1]?.trim()||meta.label}<br><small style="color:var(--gray-500);">${failed}/${total} failed</small></span></div>`;
    }).join('');
}

function _renderCritFailChart() {
    if (typeof Chart === 'undefined') return;
    const canvas = _destroyChart('crit-fail-chart');
    if (!canvas) return;
    const rows = _state.critFailData;
    if (!rows?.length) return;
    const scenarios = [...new Set(rows.map(r => r.scenario_id))].sort();
    const datasets = EXP_KEYS.filter(arm => _state.activeExperiments.has(arm)).map(arm => {
        const meta = EXP_META[arm];
        return {
            label: meta.label,
            borderColor: meta.color, backgroundColor: meta.color + '55', borderWidth: 2,
            pointRadius: 4, tension: 0.3,
            data: scenarios.map(sc => { const row = rows.find(r => r.arm === arm && r.scenario_id === sc); if (!row||!row.total_episodes) return null; return Math.round(row.failed_episodes/row.total_episodes*100)/100; }),
        };
    });
    new Chart(canvas, {
        type: 'line', data: { labels: scenarios.map(s=>s.replace(/_/g,' ')), datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { x:{ticks:{font:{size:9},maxRotation:45}}, y:{min:0,max:1,title:{display:true,text:'Failure Rate',font:{size:11}},ticks:{callback:v=>(v*100).toFixed(0)+'%'}} },
            plugins: { legend: { position:'top', labels:{boxWidth:12,font:{size:11}} } },
        },
    });
}

// ── Metric Bar Charts (per-run, overlapping per experiment) ──────────────────
function _renderMetricBars() {
    if (typeof Chart === 'undefined') return;
    const rows = _state.metricsData;
    if (!rows?.length) return;

    const metrics = [
        { key: 'mean_reward',        label: 'Mean Cumul. Reward',   canvas: 'metric-bar-reward'  },
        { key: 'goal_rate',          label: 'Goal Rate',            canvas: 'metric-bar-goal'    },
        { key: 'mean_stress_auc',    label: 'Stress AUC',           canvas: 'metric-bar-stress'  },
        { key: 'safety_failures',    label: 'Safety Failures',      canvas: 'metric-bar-safety'  },
        { key: 'discrepancy_turns',  label: 'Discrepancy Turns *',  canvas: 'metric-bar-disc'    },
        { key: 'mean_goal_reward',   label: 'Reward: Goal',         canvas: 'metric-bar-rgoal'   },
        { key: 'mean_stress_reward', label: 'Reward: Stress',       canvas: 'metric-bar-rstress' },
        { key: 'mean_trust_reward',  label: 'Reward: Trust',        canvas: 'metric-bar-rtrust'  },
        { key: 'mean_latency_ms',    label: 'Avg Latency (ms)',     canvas: 'metric-bar-latency' },
    ];
    const runIds = [...new Set(rows.map(r => r.run_label?.split('/')[0]?.trim()))].sort();

    metrics.forEach(({ key, label, canvas: cid }) => {
        const cv = _destroyChart(cid);
        if (!cv) return;
        const datasets = EXP_KEYS.filter(arm => _state.activeExperiments.has(arm)).map(arm => {
            const meta = EXP_META[arm];
            return {
                label: meta.label,
                backgroundColor: meta.color + '88', borderColor: meta.color, borderWidth: 1.5,
                borderRadius: 4, barPercentage: 0.95, categoryPercentage: 1.0,
                data: runIds.map(rid => { const row = rows.find(r => r.arm === arm && r.run_label?.startsWith(rid)); if (!row) return null; const v = row[key] ?? 0; return Math.round(v*100)/100; }),
            };
        });
        new Chart(cv, {
            type: 'bar', data: { labels: runIds, datasets },
            options: { responsive: true, maintainAspectRatio: false, scales: { x:{ticks:{font:{size:9}}}, y:{beginAtZero:true,ticks:{font:{size:10}}} }, plugins: { legend:{display:false}, title:{display:true,text:label,font:{size:11},padding:{bottom:4}} } },
        });
    });
}

// ── Physio Scatter ───────────────────────────────────────────────────────────
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
        return { label: meta.label, backgroundColor: meta.color + '88', borderColor: meta.color, borderWidth: 0.5, pointRadius: 3, data: ep.map(r => ({ x: r[xKey], y: r[yKey] })) };
    });
    new Chart(cv, {
        type: 'scatter', data: { datasets },
        options: { responsive: true, maintainAspectRatio: false, scales: { x:{title:{display:true,text:xLabel,font:{size:11}}}, y:{title:{display:true,text:yLabel,font:{size:11}}} }, plugins: { legend:{position:'top',labels:{boxWidth:12,font:{size:11}}} } },
    });
}

// ── Inline Report ─────────────────────────────────────────────────────────────
export async function loadInlineReport(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-500);">Loading report…</div>';
    try {
        const check = await fetch(`${config.ORCHESTRATOR_URL}/reports/simulation_report.html`, { method: 'HEAD' });
        if (!check.ok) { container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-500);">No report yet. Generate one first.</div>'; return; }
    } catch (e) { container.innerHTML = `<div style="padding:16px;color:var(--red-700);">Report load error: ${e.message}</div>`; return; }
    container.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.src = `${config.ORCHESTRATOR_URL}/reports/simulation_report.html?t=${Date.now()}`;
    frame.style.cssText = 'width:100%;height:100%;min-height:600px;border:none;border-radius:8px;background:#fff;display:block;';
    frame.title = 'Simulation Report';
    container.appendChild(frame);
}
export function handleDbToggle() { if (_state.simStats) _renderSimOverview(); }
