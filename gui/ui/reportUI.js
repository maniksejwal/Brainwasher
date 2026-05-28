/**
 * @fileoverview gui/ui/reportUI.js
 * Report tab UI functions - generates HTML reports
 */

import CommandExecutor from '../utils/commandExecutor.js';
import config from '../config.js';

export function initReportUI() {
    const generateBtn = document.getElementById('generate-report-btn');
    if (generateBtn) {
        // Clone to remove old listeners if any
        const newBtn = generateBtn.cloneNode(true);
        generateBtn.parentNode.replaceChild(newBtn, generateBtn);
        newBtn.addEventListener('click', generateAndShowReport);
    }
}

export async function generateAndShowReport() {
    const resultsDiv = document.getElementById('report-results');
    const btn = document.getElementById('generate-report-btn');

    if (!resultsDiv) return;

    if (btn) btn.disabled = true;

    resultsDiv.innerHTML = `
        <div class="analysis-progress">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span class="loading-spinner">⠋</span>
                <div>
                    <div style="font-weight: 500; color: var(--google-blue);">Generating Report...</div>
                    <div style="font-size: 12px; color: var(--gray-700);">Processing simulation data...</div>
                </div>
            </div>
        </div>
    `;

    const executor = new CommandExecutor(config.ORCHESTRATOR_URL);
    let output = '';

    try {
        // execute 'generate-report' which server maps to generate_simulation_report.js
        const result = await executor.execute('generate-report', {}, (chunk) => {
            output += chunk;
            // Only update output if expanded detailed view (optional) - for now just keep spinner
            // Or show last line
        }, (error) => {
            output += `\n[ERROR] ${error}`;
            resultsDiv.innerHTML = `
                <div style="padding: 16px; background: var(--red-50); border-radius: 8px;">
                    <h4>Generation Error</h4>
                    <pre style="font-family: monospace; font-size: 12px; white-space: pre-wrap;">${output}</pre>
                </div>
            `;
        });

        if (result && result.success) {
            // Show a brief toast then clear — the report is shown inline below
            resultsDiv.innerHTML = `
                <div style="padding:10px 16px;background:var(--green-50);border:1px solid var(--green-200);border-radius:8px;display:flex;align-items:center;gap:10px;font-size:13px;">
                    <span>✅</span>
                    <span style="color:var(--green-900);font-weight:500;">Report generated</span>
                    <details style="margin-left:auto;font-size:11px;">
                        <summary style="cursor:pointer;color:var(--gray-500);">log</summary>
                        <pre style="margin-top:6px;padding:8px;background:#2d2d2d;color:#eee;border-radius:4px;font-size:10px;white-space:pre-wrap;max-height:120px;overflow-y:auto;">${output}</pre>
                    </details>
                    <button onclick="this.closest('#report-results').innerHTML=''" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--gray-500);padding:2px 6px;" title="Dismiss">×</button>
                </div>
            `;
            // Auto-load into inline frame
            import('./benchmarksDashboard.js').then(m => m.loadInlineReport('report-inline-frame'));
        }
    } catch (error) {
        resultsDiv.innerHTML = `<p style="color: red;">❌ Error: ${error.message}</p>`;
    } finally {
        if (btn) btn.disabled = false;
    }
}
