/**
 * @fileoverview Unified Benchmarks Dashboard
 *
 * Merges the A3C training benchmarks and the simulation analysis dashboard
 * into a single view inside the main GUI's Benchmarks tab.
 *
 * Sections
 * --------
 * A. SIMULATION OVERVIEW  — Stats cards (simulated runs, interactions, scores, personas)
 *                           + Score-over-time trend chart (simulation vs production)
 * B. A3C LEARNING CURVES  — D3 line chart, one line per arm, reward vs episode index
 * C. ARM SUMMARY          — Table: mean reward, goal rate, mean turns, mean latency
 * D. SCENARIO BREAKDOWN   — Per-scenario reward heatmap for the selected run
 *
 * Data sources
 * ------------
 *   GET  /api/simulation/analysis/stats               → simulation overview stats
 *   GET  /api/benchmarks/learning-curves?limit=200    → A3C learning curve rows
 *   POST /api/benchmarks/compare                      → arm summary
 *   GET  /api/benchmarks/runs?limit=20                → run selector
 *   GET  /api/benchmarks/scenario-breakdown/:run_id   → scenario heatmap
 */

import config from '../config.js';

const BASE = config.ORCHESTRATOR_URL;

// ── Arm display metadata ──────────────────────────────────────────────────────

const ARM_META = {
    htn_mcts:          { label: 'Arm 1 — HTN + MCTS',         color: '#4285F4' },
    oldschool:         { label: 'Arm 2 — JS Companion',        color: '#34A853' },
    hysteresis_prompt: { label: 'Arm 3 — Hysteresis Prompt',   color: '#EA4335' },
};

function armLabel(arm) { return ARM_META[arm]?.label ?? arm; }
function armColor(arm) { return ARM_META[arm]?.color ?? '#888'; }

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchSimStats(dbKey = 'simulation') {
    try {
        const r = await fetch(`${BASE}/api/simulation/analysis/stats?db=${encodeURIComponent(dbKey)}`);
        if (!r.ok) return null;
        return await r.json();
    } catch { return null; }
}

async function fetchLearningCurves(runId) {
    const qs = runId ? `?run_id=${encodeURIComponent(runId)}&limit=200` : '?limit=200';
    const r = await fetch(`${BASE}/api/benchmarks/learning-curves${qs}`);
    return (await r.json()).rows ?? [];
}

async function fetchArmSummary() {
    const r = await fetch(`${BASE}/api/benchmarks/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario_set: '' }),
    });
    return (await r.json()).rows ?? [];
}

async function fetchRuns() {
    const r = await fetch(`${BASE}/api/benchmarks/runs?limit=20`);
    return (await r.json()).runs ?? [];
}

async function fetchScenarioBreakdown(runId) {
    if (!runId) return [];
    const r = await fetch(`${BASE}/api/benchmarks/scenario-breakdown/${encodeURIComponent(runId)}`);
    return (await r.json()).rows ?? [];
}

// ── Section A: Simulation stats cards + trend chart ──────────────────────────

function renderSimulationOverview(container, stats) {
    if (!stats?.success) {
        container.innerHTML = `<p style="color:var(--gray-500);font-size:13px">Simulation stats unavailable. Run a simulation first.</p>`;
        return;
    }

    const { logStats, dbStats, timeSeriesData } = stats;

    // ── Stats cards row ───────────────────────────────────────────────────────
    const simCount   = logStats?.conversationsCount ?? 0;
    const interactions = logStats?.interactions ?? 0;

    const aiScores   = (timeSeriesData?.aiTimeSeries ?? []).filter(t => t.score != null).map(t => t.score);
    const prodScores = (timeSeriesData?.productionTimeSeries ?? timeSeriesData?.humanTimeSeries ?? []).filter(t => t.score != null).map(t => t.score);

    const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : null;
    const simScore  = avg(aiScores);
    const prodScore = avg(prodScores);

    const definedPersonas = stats.definedPersonas
        ? Object.values(stats.definedPersonas).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0)
        : 0;

    const fmtScore = v => v == null ? 'N/A' : v.toFixed(2);
    const fmtCount = v => v.toLocaleString();

    const scoreColor = v => {
        if (v == null) return 'var(--gray-500)';
        if (v >= 0.5)  return '#137333';
        if (v >= 0)    return '#e37400';
        return '#c5221f';
    };

    container.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:20px">
            ${card('📊', 'Simulated Runs',    fmtCount(simCount),         '')}
            ${card('💬', 'Interactions',      fmtCount(interactions),     '')}
            ${card('🤖', 'Simulation Score',  fmtScore(simScore),  simScore  == null ? '' : `${fmtCount(aiScores.length)} samples`, scoreColor(simScore))}
            ${card('👥', 'Production Score',  fmtScore(prodScore), prodScore == null ? '' : `${fmtCount(prodScores.length)} samples`, scoreColor(prodScore))}
            ${card('🧬', 'Defined Personas',  fmtCount(definedPersonas), '')}
        </div>
        <div id="sim-trend-chart" style="width:100%;min-height:260px;background:white;border:1px solid var(--gray-200);border-radius:8px;padding:8px 0;box-sizing:border-box"></div>`;

    // ── Trend chart ───────────────────────────────────────────────────────────
    const trendEl = container.querySelector('#sim-trend-chart');
    const ts = timeSeriesData?.aiTimeSeries ?? timeSeriesData ?? [];
    if (!ts.length) {
        trendEl.innerHTML = '<p style="color:var(--gray-500);padding:16px;font-size:13px">No time-series data yet.</p>';
        return;
    }
    renderTrendChart(trendEl, ts, timeSeriesData?.humanTimeSeries ?? []);
}

function card(icon, label, value, sub, valueColor = 'var(--gray-800)') {
    return `
        <div style="background:white;border:1px solid var(--gray-200);border-radius:8px;padding:14px 16px">
            <div style="font-size:20px;margin-bottom:4px">${icon}</div>
            <div style="font-size:11px;color:var(--gray-500);text-transform:uppercase;letter-spacing:.5px">${label}</div>
            <div style="font-size:22px;font-weight:600;color:${valueColor};line-height:1.2;margin-top:2px">${value}</div>
            ${sub ? `<div style="font-size:11px;color:var(--gray-500);margin-top:2px">${sub}</div>` : ''}
        </div>`;
}

function renderTrendChart(container, simTs, prodTs) {
    container.innerHTML = '';
    const W = container.clientWidth || 680;
    const H = 240;
    const margin = { top: 20, right: 100, bottom: 44, left: 50 };
    const iW = W - margin.left - margin.right;
    const iH = H - margin.top - margin.bottom;

    const allDates = [...new Set([...simTs.map(t => t.date), ...prodTs.map(t => t.date)])].sort();
    if (!allDates.length) return;

    const svg = d3.select(container).append('svg')
        .attr('width', W).attr('height', H).style('font-family', 'inherit');
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scalePoint().domain(allDates).range([0, iW]).padding(0.2);

    const allScores = [...simTs, ...prodTs].map(t => t.score).filter(v => v != null);
    const yMin = Math.min(0, d3.min(allScores) ?? 0);
    const yMax = Math.max(1, d3.max(allScores) ?? 1);
    const y = d3.scaleLinear().domain([yMin, yMax]).range([iH, 0]).nice();

    // Grid
    g.append('g').call(d3.axisLeft(y).tickSize(-iW).tickFormat(''))
        .selectAll('line').style('stroke', '#e8eaed').style('stroke-dasharray', '3,3');
    g.select('.domain').remove();

    // Zero line
    g.append('line').attr('x1', 0).attr('x2', iW)
        .attr('y1', y(0)).attr('y2', y(0))
        .style('stroke', '#bdc1c6').style('stroke-width', 1);

    // Axes
    const tickEvery = Math.max(1, Math.floor(allDates.length / 6));
    g.append('g').attr('transform', `translate(0,${iH})`)
        .call(d3.axisBottom(x).tickValues(allDates.filter((_, i) => i % tickEvery === 0)))
        .selectAll('text').style('font-size', '10px').attr('transform', 'rotate(-25)').attr('text-anchor', 'end');
    g.append('g').call(d3.axisLeft(y).ticks(5));

    // Axis labels
    g.append('text').attr('x', iW / 2).attr('y', iH + 40)
        .attr('text-anchor', 'middle').style('font-size', '11px').style('fill', '#5f6368')
        .text('Date');
    g.append('text').attr('transform', 'rotate(-90)').attr('x', -iH / 2).attr('y', -38)
        .attr('text-anchor', 'middle').style('font-size', '11px').style('fill', '#5f6368')
        .text('Avg Score');

    function drawLine(series, color, label) {
        const valid = series.filter(t => t.score != null);
        if (!valid.length) return;
        const line = d3.line()
            .x(d => x(d.date))
            .y(d => y(d.score))
            .defined(d => d.score != null)
            .curve(d3.curveCatmullRom.alpha(0.5));
        g.append('path').datum(valid)
            .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2)
            .attr('d', line);
        // Dots
        g.selectAll(null).data(valid).enter().append('circle')
            .attr('cx', d => x(d.date)).attr('cy', d => y(d.score))
            .attr('r', 3).attr('fill', color);
        // Legend
        const lx = iW + 8;
        const ly = label === 'Simulation' ? 0 : 22;
        svg.append('line')
            .attr('x1', margin.left + lx).attr('x2', margin.left + lx + 16)
            .attr('y1', margin.top + ly + 6).attr('y2', margin.top + ly + 6)
            .attr('stroke', color).attr('stroke-width', 2);
        svg.append('text')
            .attr('x', margin.left + lx + 20).attr('y', margin.top + ly + 10)
            .style('font-size', '11px').style('fill', '#3c4043').text(label);
    }

    drawLine(simTs,  '#4285F4', 'Simulation');
    drawLine(prodTs, '#34A853', 'Production');
}

// ── Section B: A3C Learning-curves chart ─────────────────────────────────────

function renderLearningCurveChart(container, rows, showRaw) {
    container.innerHTML = '';
    if (!rows.length) {
        container.innerHTML = '<p style="color:var(--gray-500);padding:24px">No episode data yet. Start a training run to see curves.</p>';
        return;
    }

    const W = container.clientWidth || 700;
    const H = 340;
    const margin = { top: 24, right: 150, bottom: 48, left: 56 };
    const iW = W - margin.left - margin.right;
    const iH = H - margin.top - margin.bottom;

    const svg = d3.select(container).append('svg')
        .attr('width', W).attr('height', H).style('font-family', 'inherit');
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const byArm = d3.group(rows, d => d.arm);
    const xMax  = d3.max(rows, d => d.episode_index) ?? 1;
    const yMin  = d3.min(rows, d => Math.min(d.cumulative_reward ?? 0, d.smoothed_reward ?? 0));
    const yMax  = d3.max(rows, d => Math.max(d.cumulative_reward ?? 0, d.smoothed_reward ?? 0));

    const x = d3.scaleLinear().domain([1, xMax]).range([0, iW]);
    const y = d3.scaleLinear().domain([yMin * 1.1, yMax * 1.1 + 0.1]).range([iH, 0]);

    g.append('g').call(d3.axisLeft(y).tickSize(-iW).tickFormat(''))
        .selectAll('line').style('stroke', '#e8eaed').style('stroke-dasharray', '3,3');
    g.select('.grid .domain').remove();

    g.append('line').attr('x1', 0).attr('x2', iW)
        .attr('y1', y(0)).attr('y2', y(0)).style('stroke', '#bdc1c6').style('stroke-width', 1);

    g.append('g').attr('transform', `translate(0,${iH})`)
        .call(d3.axisBottom(x).ticks(Math.min(xMax, 10)).tickFormat(d3.format('d')));
    g.append('g').call(d3.axisLeft(y).ticks(6));

    g.append('text').attr('x', iW / 2).attr('y', iH + 40)
        .attr('text-anchor', 'middle').style('font-size', '12px').style('fill', '#5f6368')
        .text('Episode (per arm)');
    g.append('text').attr('transform', 'rotate(-90)').attr('x', -iH / 2).attr('y', -42)
        .attr('text-anchor', 'middle').style('font-size', '12px').style('fill', '#5f6368')
        .text('Cumulative Reward');

    const lineSmoothed = d3.line()
        .x(d => x(d.episode_index)).y(d => y(d.smoothed_reward ?? 0))
        .curve(d3.curveCatmullRom.alpha(0.5));
    const lineRaw = d3.line()
        .x(d => x(d.episode_index)).y(d => y(d.cumulative_reward ?? 0))
        .curve(d3.curveLinear);

    let legendY = 0;
    for (const [arm, armRows] of byArm) {
        const color  = armColor(arm);
        const sorted = [...armRows].sort((a, b) => a.episode_index - b.episode_index);
        if (showRaw) {
            g.append('path').datum(sorted)
                .attr('fill', 'none').attr('stroke', color)
                .attr('stroke-width', 1).attr('stroke-opacity', 0.25).attr('d', lineRaw);
        }
        g.append('path').datum(sorted)
            .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2.5).attr('d', lineSmoothed);
        const last = sorted[sorted.length - 1];
        g.append('circle')
            .attr('cx', x(last.episode_index)).attr('cy', y(last.smoothed_reward ?? 0))
            .attr('r', 4).attr('fill', color);
        const lx = iW + 10;
        svg.append('line')
            .attr('x1', margin.left + lx).attr('x2', margin.left + lx + 18)
            .attr('y1', margin.top + legendY + 6).attr('y2', margin.top + legendY + 6)
            .attr('stroke', color).attr('stroke-width', 2.5);
        svg.append('text')
            .attr('x', margin.left + lx + 22).attr('y', margin.top + legendY + 10)
            .style('font-size', '11px').style('fill', '#3c4043').text(armLabel(arm));
        legendY += 22;
    }
}

// ── Section C: Arm summary table ─────────────────────────────────────────────

function renderArmSummaryTable(container, rows) {
    if (!rows.length) {
        container.innerHTML = '<p style="color:var(--gray-500)">No comparison data yet.</p>';
        return;
    }
    const fmt2   = v => (v == null ? '—' : (+v).toFixed(2));
    const fmtPct = v => (v == null ? '—' : `${(+v * 100).toFixed(0)}%`);
    const fmtMs  = v => (v == null ? '—' : `${Math.round(+v)}ms`);
    const best   = {};
    ['mean_reward', 'goal_rate'].forEach(k => { best[k] = Math.max(...rows.map(r => r[k] ?? -Infinity)); });

    const rowHtml = rows.map(r => {
        const isBestReward = (r.mean_reward ?? -Infinity) === best.mean_reward;
        const isBestGoal   = (r.goal_rate   ?? -Infinity) === best.goal_rate;
        return `<tr>
            <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${armColor(r.arm)};margin-right:6px;"></span>${armLabel(r.arm)}</td>
            <td style="text-align:center">${r.episodes ?? '—'}</td>
            <td style="text-align:center;${isBestReward ? 'font-weight:600;color:#137333' : ''}">${fmt2(r.mean_reward)}</td>
            <td style="text-align:center;${isBestGoal   ? 'font-weight:600;color:#137333' : ''}">${fmtPct(r.goal_rate)}</td>
            <td style="text-align:center">${fmt2(r.mean_turns)}</td>
            <td style="text-align:center">${fmtMs(r.mean_latency_ms)}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="border-bottom:2px solid var(--gray-200);text-align:left">
                <th style="padding:8px 12px">Arm</th>
                <th style="padding:8px 12px;text-align:center">Episodes</th>
                <th style="padding:8px 12px;text-align:center">Mean Reward</th>
                <th style="padding:8px 12px;text-align:center">Goal Rate</th>
                <th style="padding:8px 12px;text-align:center">Mean Turns</th>
                <th style="padding:8px 12px;text-align:center">Mean Latency</th>
            </tr></thead>
            <tbody>${rowHtml}</tbody>
        </table>`;
}

// ── Section D: Scenario heatmap ───────────────────────────────────────────────

function renderScenarioHeatmap(container, rows) {
    if (!rows.length) {
        container.innerHTML = '<p style="color:var(--gray-500)">Select a specific run to see scenario breakdown.</p>';
        return;
    }
    const scenarios = [...new Set(rows.map(r => r.scenario_id))].sort();
    const arms      = [...new Set(rows.map(r => r.arm ?? ''))].sort();
    const lookup    = {};
    for (const r of rows) {
        lookup[`${r.scenario_id}||${r.arm ?? ''}`] = r.cumulative_reward ?? null;
    }
    const allVals = Object.values(lookup).filter(v => v != null);
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    function cellColor(v) {
        if (v == null) return '#f1f3f4';
        const t = maxV === minV ? 0.5 : (v - minV) / (maxV - minV);
        const r = Math.round(t < 0.5 ? 220 : 220 - (t - 0.5) * 2 * 160);
        const g = Math.round(t < 0.5 ? t * 2 * 200 : 200);
        return `rgb(${r},${g},60)`;
    }
    const headerCells = arms.map(a => `<th style="padding:6px 10px;font-size:11px;text-align:center;white-space:nowrap">${armLabel(a)}</th>`).join('');
    const bodyRows = scenarios.map(sc => {
        const cells = arms.map(a => {
            const v  = lookup[`${sc}||${a}`];
            const bg = cellColor(v);
            const text = v == null ? '—' : v.toFixed(2);
            return `<td style="padding:5px 10px;text-align:center;background:${bg};color:${v != null && v > (minV + maxV) / 2 ? '#fff' : '#202124'};font-size:12px;font-weight:500">${text}</td>`;
        }).join('');
        return `<tr><td style="padding:5px 10px;font-size:12px;white-space:nowrap;color:#3c4043">${sc.replace(/_/g, ' ')}</td>${cells}</tr>`;
    }).join('');
    container.innerHTML = `
        <table style="border-collapse:collapse;font-size:13px">
            <thead><tr style="border-bottom:2px solid var(--gray-200)">
                <th style="padding:6px 10px;text-align:left;font-size:11px">Scenario</th>
                ${headerCells}
            </tr></thead>
            <tbody>${bodyRows}</tbody>
        </table>
        <p style="font-size:11px;color:var(--gray-500);margin-top:8px">Colour: red = low reward → green = high reward.</p>`;
}

// ── Section divider helper ────────────────────────────────────────────────────

function sectionDivider(title) {
    return `<div style="display:flex;align-items:center;gap:12px;margin:28px 0 14px">
        <span style="font-size:14px;font-weight:600;color:#3c4043;white-space:nowrap">${title}</span>
        <div style="flex:1;height:1px;background:var(--gray-200)"></div>
    </div>`;
}

// ── Main init ─────────────────────────────────────────────────────────────────

export async function initBenchmarksDashboard() {
    const root = document.getElementById('benchmarks-dashboard');
    if (!root) return;

    root.innerHTML = `
        <div style="padding:16px">
            <!-- Controls bar -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <h3 style="margin:0">Benchmarks</h3>
                <div style="display:flex;gap:8px;align-items:center">
                    <label style="font-size:12px;color:var(--gray-600)">DB:
                        <select id="bench-db-select" style="font-size:12px;padding:4px 8px;border:1px solid var(--gray-300);border-radius:4px;margin-left:4px">
                            <option value="simulation">Simulation</option>
                            <option value="development">Development</option>
                            <option value="production">Production</option>
                        </select>
                    </label>
                    <label style="font-size:12px;color:var(--gray-600)">
                        <input type="checkbox" id="bench-show-raw" style="margin-right:4px"> Show raw A3C traces
                    </label>
                    <select id="bench-run-select" style="font-size:12px;padding:4px 8px;border:1px solid var(--gray-300);border-radius:4px">
                        <option value="">All A3C runs</option>
                    </select>
                    <button id="bench-refresh" class="secondary" style="font-size:12px;padding:4px 10px">↻ Refresh all</button>
                </div>
            </div>

            <!-- A: Simulation overview -->
            ${sectionDivider('Simulation Overview')}
            <div id="bench-sim-overview"></div>

            <!-- B: A3C Learning curves -->
            ${sectionDivider('A3C Learning Curves')}
            <div id="bench-chart-container" style="width:100%;min-height:340px;background:white;border:1px solid var(--gray-200);border-radius:8px;padding:8px 0;box-sizing:border-box"></div>

            <!-- C: Arm summary -->
            ${sectionDivider('Arm Summary (all runs)')}
            <div id="bench-summary-table"></div>

            <!-- D: Scenario heatmap -->
            ${sectionDivider('Scenario Reward Heatmap <span style="font-weight:400;font-size:12px;color:var(--gray-500)">(select a run above)</span>')}
            <div id="bench-scenario-heatmap" style="overflow-x:auto"></div>

            <p style="font-size:11px;color:var(--gray-500);margin-top:16px">
                A3C reward is cumulative per episode (not normalised). Smoothed line uses 5-episode rolling window.
                Each arm trains an independent Actor/Critic — curves show per-environment learning rate.
            </p>
        </div>`;

    const simOverviewEl = document.getElementById('bench-sim-overview');
    const chartEl       = document.getElementById('bench-chart-container');
    const tableEl       = document.getElementById('bench-summary-table');
    const heatmapEl     = document.getElementById('bench-scenario-heatmap');
    const dbSelect      = document.getElementById('bench-db-select');
    const runSelect     = document.getElementById('bench-run-select');
    const rawCb         = document.getElementById('bench-show-raw');
    const refreshBtn    = document.getElementById('bench-refresh');

    async function refresh() {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Loading…';
        try {
            const runId = runSelect.value || undefined;
            const dbKey = dbSelect.value || 'simulation';
            const [simStats, curveRows, summaryRows, runs, heatRows] = await Promise.all([
                fetchSimStats(dbKey),
                fetchLearningCurves(runId),
                fetchArmSummary(),
                fetchRuns(),
                fetchScenarioBreakdown(runId),
            ]);

            renderSimulationOverview(simOverviewEl, simStats);

            // Populate run selector
            const existing = new Set([...runSelect.options].map(o => o.value));
            for (const r of runs) {
                if (!existing.has(r.run_id)) {
                    const opt = document.createElement('option');
                    opt.value = r.run_id;
                    opt.textContent = `${r.arm ?? 'all'} — ${new Date(r.started_at).toLocaleDateString()} (${r.episode_count ?? 0} ep)`;
                    runSelect.appendChild(opt);
                }
            }

            renderLearningCurveChart(chartEl, curveRows, rawCb.checked);
            renderArmSummaryTable(tableEl, summaryRows);
            renderScenarioHeatmap(heatmapEl, heatRows);
        } catch (e) {
            chartEl.innerHTML = `<p style="color:#c5221f;padding:16px">Error loading benchmark data: ${e.message}</p>`;
        } finally {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '↻ Refresh all';
        }
    }

    refreshBtn.addEventListener('click', refresh);
    rawCb.addEventListener('change', refresh);
    runSelect.addEventListener('change', refresh);
    dbSelect.addEventListener('change', refresh);

    await refresh();
}

export default initBenchmarksDashboard;
