/**
 * @fileoverview gui/ui/analysisUI.js
 * Analysis tab UI functions - uses CLI executor for Deep Analysis
 */

import CommandExecutor from '../utils/commandExecutor.js';
import config from '../config.js';

export function initAnalysisUI() {
    const controls = document.getElementById('analysis-controls');
    if (!controls) return;

    // Render controls
    controls.innerHTML = `
        <div style="display: flex; gap: 12px; flex-wrap: wrap; padding: 16px; background: var(--gray-50); border-radius: 8px;">
            <button class="secondary" data-cmd="prompts" title="Analyze performance per prompt version">
                📊 Prompt Stats
            </button>
            <button class="secondary" data-cmd="failures" title="Identify common failure patterns">
                🚨 Failure Patterns
            </button>
            <button class="secondary" data-cmd="rewards" title="View reward backpropagation signals">
                🎯 Reward Signals
            </button>
            <button class="secondary" data-cmd="optimize" title="Suggest prompt optimizations">
                🚀 Optimize Prompts
            </button>
            <div style="width: 1px; background: var(--gray-300); margin: 0 8px;"></div>
            <button class="primary" data-cmd="all" title="Run full analysis suite">
                🔄 Run All Analysis
            </button>
        </div>
    `;

    // Bind events
    controls.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => runAnalysis(btn.dataset.cmd));
    });
}

async function runAnalysis(command) {
    const resultsDiv = document.getElementById('analysis-results');
    if (!resultsDiv) return;

    resultsDiv.innerHTML = `
        <div class="analysis-progress" style="margin-top: 20px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span class="loading-spinner">⠋</span>
                <div>
                    <div style="font-weight: 500; color: var(--google-blue);">Running Analysis: ${command.toUpperCase()}...</div>
                    <div style="font-size: 12px; color: var(--gray-700);">Executing CLI tools</div>
                </div>
            </div>
        </div>
    `;

    const executor = new CommandExecutor(config.ORCHESTRATOR_URL);
    let output = '';

    try {
        // Pass the specific command as an argument to the 'analyze' endpoint
        const result = await executor.execute('analyze', { command }, (chunk) => {
            output += chunk;
            resultsDiv.innerHTML = `
                <div style="margin-top: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <h4 style="margin: 0;">Output - ${command}</h4>
                        <span style="font-size: 11px; padding: 2px 6px; background: #eee; border-radius: 4px;">Running...</span>
                    </div>
                    <pre style="
                        background: #1e1e1e;
                        color: #a9b7c6;
                        padding: 12px;
                        border-radius: 4px;
                        font-family: 'Consolas', monospace;
                        font-size: 12px;
                        white-space: pre-wrap;
                        max-height: 500px;
                        overflow-y: auto;
                    ">${output}<span class="cursor">_</span></pre>
                </div>
            `;
        }, (error) => {
            output += `\n[ERROR] ${error}`;
            // Error updates are handled by the stream mostly, but if hard error:
        });

        // Final State
        if (result && result.success) {
            resultsDiv.innerHTML = `
                <div style="margin-top: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <h4 style="margin: 0; color: var(--green-700);">✅ Analysis Complete</h4>
                        <button class="small secondary" onclick="document.getElementById('analysis-results').innerHTML = ''">Clear</button>
                    </div>
                    <pre style="
                        background: #1e1e1e;
                        color: #a9b7c6;
                        padding: 12px;
                        border-radius: 4px;
                        font-family: 'Consolas', monospace;
                        font-size: 12px;
                        white-space: pre-wrap;
                        max-height: 600px;
                        overflow-y: auto;
                    ">${output}</pre>
                </div>
            `;
        }
    } catch (error) {
        resultsDiv.innerHTML = `
            <div style="margin-top: 20px; padding: 12px; background: var(--red-50); border-radius: 8px;">
                <h4 style="color: var(--red-700); margin: 0 0 8px 0;">Execution Failed</h4>
                <p style="margin: 0; font-size: 13px;">${error.message}</p>
            </div>
        `;
    }
}
