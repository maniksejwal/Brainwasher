/**
 * @fileoverview gui/ui/analysisUI.js
 * Analysis tab UI functions
 */

export async function generateAndShowAnalysis(api) {
    const resultsDiv = document.getElementById('analysis-results');
    if (!resultsDiv) return;
    
    resultsDiv.innerHTML = `
        <div class="analysis-progress">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 18px;">⠋</span>
                <div>
                    <div style="font-weight: 500; color: var(--google-blue);">Generating Analysis...</div>
                    <div style="font-size: 12px; color: var(--gray-700);">Processing training logs and feedback</div>
                </div>
            </div>
        </div>
    `;

    try {
        const analysis = await api.generateAnalysis();
        resultsDiv.innerHTML = `
            <h4>Performance Analysis</h4>
            <p>Total Interactions: ${analysis.total}</p>
            <p>Average Latency: ${analysis.avgLatency}ms</p>
            <p>Escalations: ${analysis.escalations}</p>
            <p>Shares: ${analysis.shares}</p>
        `;
    } catch (error) {
        resultsDiv.innerHTML = `<p>❌ Error: ${error.message}</p>`;
    }
}

