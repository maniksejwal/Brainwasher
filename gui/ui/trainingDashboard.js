/**
 * @fileoverview Training Dashboard UI
 * Executes training CLI commands and displays results
 */

import CommandExecutor from '../utils/commandExecutor.js';

export function initTrainingDashboard() {
    const container = document.getElementById('training-dashboard');
    if (!container) return;

    const executor = new CommandExecutor('');

    // Create UI
    container.innerHTML = `
        <div style="padding: 16px;">
            <h3>Training Dashboard</h3>
            <div style="margin-bottom: 16px;">
                <button id="train-run" class="primary" style="margin-right: 8px;">Run Training</button>
                <button id="train-status" class="secondary" style="margin-right: 8px;">Check Status</button>
                <button id="train-force" class="secondary">Force Optimization</button>
            </div>
            <div id="training-output" style="font-family: monospace; font-size: 12px; background: var(--gray-50); padding: 16px; border-radius: 4px; max-height: 500px; overflow-y: auto; white-space: pre-wrap;"></div>
        </div>
    `;

    const outputDiv = document.getElementById('training-output');
    const metricsContainer = document.getElementById('training-metrics');
    const metricsBars = document.getElementById('training-metrics-bars');
    let outputBuffer = '';
    let activeCommand = null;
    const metricsState = {
        conversationCount: null,
        averageScore: null,
        adherenceScore: null,
        conversationScore: null,
        nextOptimization: null,
        lastOptimization: null
    };

    const METRIC_CONFIG = {
        conversationCount: { label: 'Conversations (7d)', min: 0, max: 200 },
        averageScore: { label: 'Average Score', min: -2, max: 2 },
        adherenceScore: { label: 'Adherence Score', min: -2, max: 2 },
        conversationScore: { label: 'Conversation Score', min: -2, max: 2 }
    };

    function appendOutput(text) {
        outputBuffer += text;
        outputDiv.textContent = outputBuffer;
        outputDiv.scrollTop = outputDiv.scrollHeight;
        if (activeCommand === 'status') {
            parseMetricsChunk(text);
            renderMetrics();
        }
    }

    function parseMetricsChunk(chunk) {
        const convMatch = chunk.match(/Conversations \(last 7 days\):\s*(\d+)/i);
        if (convMatch) metricsState.conversationCount = Number(convMatch[1]);

        const avgMatch = chunk.match(/Average Score:\s*([\-0-9.]+)/i);
        if (avgMatch) metricsState.averageScore = Number(avgMatch[1]);

        const adhMatch = chunk.match(/Adherence Score:\s*([\-0-9.]+)/i);
        if (adhMatch) metricsState.adherenceScore = Number(adhMatch[1]);

        const convScoreMatch = chunk.match(/Conversation Score:\s*([\-0-9.]+)/i);
        if (convScoreMatch) metricsState.conversationScore = Number(convScoreMatch[1]);

        const nextMatch = chunk.match(/Next Optimization:\s*(.+)/i);
        if (nextMatch) metricsState.nextOptimization = nextMatch[1].trim();

        const lastMatch = chunk.match(/Last Optimization:\s*(.+)/i);
        if (lastMatch) metricsState.lastOptimization = lastMatch[1].trim();
    }

    function renderMetrics() {
        if (!metricsContainer || !metricsBars) return;
        const hasData = Object.values(metricsState).some(v => v !== null);
        metricsContainer.style.display = hasData ? 'block' : 'none';
        if (!hasData) return;

        const fragments = [];
        Object.entries(METRIC_CONFIG).forEach(([key, config]) => {
            const value = metricsState[key];
            if (value === null || Number.isNaN(value)) return;
            const clamped = Math.max(config.min, Math.min(config.max, value));
            const range = config.max - config.min || 1;
            const percent = ((clamped - config.min) / range) * 100;
            fragments.push(`
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 500;">
                        <span>${config.label}</span>
                        <span>${value.toFixed(2)}</span>
                    </div>
                    <div style="height: 8px; background: var(--gray-200); border-radius: 999px; overflow: hidden;">
                        <div style="height: 100%; width: ${percent}%; background: var(--blue-500);"></div>
                    </div>
                </div>
            `);
        });

        if (metricsState.lastOptimization || metricsState.nextOptimization) {
            fragments.push(`
                <div style="font-size: 12px; color: var(--gray-600); display: flex; flex-direction: column; gap: 4px;">
                    ${metricsState.lastOptimization ? `<span>Last optimization: ${metricsState.lastOptimization}</span>` : ''}
                    ${metricsState.nextOptimization ? `<span>Next optimization: ${metricsState.nextOptimization}</span>` : ''}
                </div>
            `);
        }

        metricsBars.innerHTML = fragments.join('');
    }

    function resetMetrics() {
        Object.keys(metricsState).forEach(key => {
            metricsState[key] = null;
        });
        renderMetrics();
    }

    document.getElementById('train-run').addEventListener('click', async () => {
        outputBuffer = '';
        outputDiv.textContent = 'Starting training cycle...\n';
        activeCommand = 'run';
        resetMetrics();
        try {
            await executor.execute('train', {
                command: 'run'
            }, appendOutput, appendOutput);
            appendOutput('\n✅ Training complete!');
        } catch (error) {
            appendOutput(`\n❌ Error: ${error.message}`);
        }
    });

    async function loadMetrics() {
        try {
            const response = await fetch('/api/simulation/analysis/stats');
            const data = await response.json();

            if (data.success) {
                // Map API data to metricsState
                metricsState.conversationCount = data.logStats.conversationsCount;

                // Calculate average AI score
                if (data.timeSeriesData && data.timeSeriesData.aiTimeSeries) {
                    const aiScores = data.timeSeriesData.aiTimeSeries
                        .filter(t => t.score !== null)
                        .map(t => t.score);

                    if (aiScores.length > 0) {
                        const sum = aiScores.reduce((a, b) => a + b, 0);
                        metricsState.averageScore = sum / aiScores.length;
                    }
                }

                renderMetrics();

                // Append summary to output for visibility
                appendOutput(`\n[API] Fetched stats: ${metricsState.conversationCount} runs, Avg Score: ${metricsState.averageScore?.toFixed(2) || 'N/A'}\n`);
            }
        } catch (error) {
            console.error('Failed to load analysis stats:', error);
            // Don't clutter output on fail, just log
        }
    }

    document.getElementById('train-status').addEventListener('click', async () => {
        outputBuffer = '';
        outputDiv.textContent = 'Checking status...\n';
        activeCommand = 'status';
        resetMetrics();

        // Call API in parallel with CLI command
        loadMetrics();

        try {
            await executor.execute('train', {
                command: 'status'
            }, appendOutput, appendOutput);
        } catch (error) {
            appendOutput(`\n❌ Error: ${error.message}`);
        }
    });

    document.getElementById('train-force').addEventListener('click', async () => {
        outputBuffer = '';
        outputDiv.textContent = 'Forcing optimization...\n';
        activeCommand = 'force';
        resetMetrics();
        try {
            await executor.execute('train', {
                command: 'force'
            }, appendOutput, appendOutput);
            appendOutput('\n✅ Optimization complete!');
        } catch (error) {
            appendOutput(`\n❌ Error: ${error.message}`);
        }
    });
}

export default initTrainingDashboard;

