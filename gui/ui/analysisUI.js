/**
 * @fileoverview gui/ui/analysisUI.js
 * Analysis tab UI functions - uses CLI executor
 */

import CommandExecutor from '../utils/commandExecutor.js';

export async function generateAndShowAnalysis(api) {
    const resultsDiv = document.getElementById('analysis-results');
    if (!resultsDiv) return;
    
    resultsDiv.innerHTML = `
        <div class="analysis-progress">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 18px;">⠋</span>
                <div>
                    <div style="font-weight: 500; color: var(--google-blue);">Generating Analysis...</div>
                    <div style="font-size: 12px; color: var(--gray-700);">Running CLI analysis command</div>
                </div>
            </div>
        </div>
    `;

    const executor = new CommandExecutor('');
    let output = '';

    try {
        const result = await executor.execute('analyze', {
            command: 'all'
        }, (chunk) => {
            output += chunk;
            // Update UI with streaming output
            resultsDiv.innerHTML = `
                <div style="padding: 16px; background: var(--gray-50); border-radius: 8px;">
                    <h4>Analysis Output</h4>
                    <pre style="font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 500px; overflow-y: auto;">${output}</pre>
                </div>
            `;
        }, (error) => {
            output += `\n[ERROR] ${error}`;
            resultsDiv.innerHTML = `
                <div style="padding: 16px; background: var(--red-50); border-radius: 8px;">
                    <h4>Analysis Error</h4>
                    <pre style="font-family: monospace; font-size: 12px; white-space: pre-wrap;">${output}</pre>
                </div>
            `;
        });
        
        // Final result display
        if (result && result.success) {
            resultsDiv.innerHTML = `
                <div style="padding: 16px; background: var(--green-50); border-radius: 8px;">
                    <h4>✅ Analysis Complete</h4>
                    <pre style="font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 500px; overflow-y: auto;">${output || 'Analysis completed successfully'}</pre>
                </div>
            `;
        }
    } catch (error) {
        resultsDiv.innerHTML = `<p>❌ Error: ${error.message}</p>`;
    }
}

