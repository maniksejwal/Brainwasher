/**
 * @fileoverview gui/ui/reportUI.js
 * Report tab UI functions - generates HTML reports
 */

import CommandExecutor from '../utils/commandExecutor.js';

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

    const executor = new CommandExecutor('');
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
            resultsDiv.innerHTML = `
                <div style="padding: 20px; background: var(--green-50); border: 1px solid var(--green-200); border-radius: 8px; text-align: center;">
                    <div style="font-size: 48px; margin-bottom: 10px;">📊</div>
                    <h3 style="margin: 0 0 8px 0; color: var(--green-900);">Report Ready</h3>
                    <p style="color: var(--green-800); margin-bottom: 20px;">The latest simulation analysis is available.</p>
                    
                    <a href="/reports/simulation_report.html" target="_blank" class="button primary" style="
                        display: inline-flex;
                        align-items: center;
                        gap: 8px;
                        text-decoration: none;
                        background-color: var(--google-blue);
                        color: white;
                        padding: 10px 24px;
                        border-radius: 20px;
                        font-weight: 600;
                        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                        transition: transform 0.1s;
                    ">
                        <span>Open Interactive Report</span>
                        <span>↗</span>
                    </a>

                    <div style="margin-top: 20px; text-align: left;">
                        <details>
                            <summary style="cursor: pointer; color: var(--gray-600); font-size: 12px; user-select: none;">View Generation Log</summary>
                            <pre style="
                                margin-top: 8px;
                                padding: 12px;
                                background: #2d2d2d;
                                color: #eee;
                                border-radius: 4px;
                                font-family: 'Consolas', monospace;
                                font-size: 11px;
                                white-space: pre-wrap;
                                max-height: 200px;
                                overflow-y: auto;
                            ">${output}</pre>
                        </details>
                    </div>
                </div>
            `;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<p style="color: red;">❌ Error: ${error.message}</p>`;
    } finally {
        if (btn) btn.disabled = false;
    }
}
