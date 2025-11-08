/**
 * @fileoverview Prompt Comparison UI
 * Executes prompts CLI and displays comparisons
 */

import CommandExecutor from '../utils/commandExecutor.js';

export function initPromptComparison() {
    const container = document.getElementById('prompt-comparison');
    if (!container) return;

    const executor = new CommandExecutor('');

    // Create UI
    container.innerHTML = `
        <div style="padding: 16px;">
            <h3>Prompt Comparison</h3>
            <div style="margin-bottom: 16px;">
                <button id="prompts-list" class="primary" style="margin-right: 8px;">List Prompts</button>
                <input type="text" id="prompt-version" placeholder="Version (e.g., v123)" style="padding: 8px; margin-right: 8px; border: 1px solid var(--gray-300); border-radius: 4px;">
                <button id="prompts-show" class="secondary" style="margin-right: 8px;">Show Prompt</button>
                <label style="margin-right: 8px;">
                    <input type="checkbox" id="prompt-compare"> Compare
                </label>
            </div>
            <div id="prompt-output" style="font-family: monospace; font-size: 12px; background: var(--gray-50); padding: 16px; border-radius: 4px; max-height: 500px; overflow-y: auto; white-space: pre-wrap;"></div>
        </div>
    `;

    const outputDiv = document.getElementById('prompt-output');
    let outputBuffer = '';

    function appendOutput(text) {
        outputBuffer += text;
        outputDiv.textContent = outputBuffer;
        outputDiv.scrollTop = outputDiv.scrollHeight;
    }

    document.getElementById('prompts-list').addEventListener('click', async () => {
        outputBuffer = '';
        outputDiv.textContent = 'Loading prompts...\n';
        try {
            await executor.execute('prompts', {
                command: 'list'
            }, appendOutput, appendOutput);
        } catch (error) {
            appendOutput(`\n❌ Error: ${error.message}`);
        }
    });

    document.getElementById('prompts-show').addEventListener('click', async () => {
        const version = document.getElementById('prompt-version').value.trim();
        if (!version) {
            appendOutput('\n❌ Please enter a version');
            return;
        }
        outputBuffer = '';
        outputDiv.textContent = `Loading prompt ${version}...\n`;
        try {
            await executor.execute('prompts', {
                command: 'show',
                version,
                compare: document.getElementById('prompt-compare').checked
            }, appendOutput, appendOutput);
        } catch (error) {
            appendOutput(`\n❌ Error: ${error.message}`);
        }
    });
}

export default initPromptComparison;

