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
            <div style="margin-bottom: 16px; display: flex; flex-direction: column; gap: 12px;">
                <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                    <button id="prompts-refresh" class="primary">Refresh List</button>
                    <input type="text" id="prompt-search" placeholder="Search prompts..." style="padding: 8px; border: 1px solid var(--gray-300); border-radius: 4px; min-width: 240px;">
                    <label style="display: flex; align-items: center; gap: 4px;">
                        <input type="checkbox" id="prompt-compare"> Compare
                    </label>
                    <button id="prompts-show" class="secondary">Show Prompt</button>
                </div>
                <select id="prompt-version-select" size="8" style="width: 100%; max-height: 220px; padding: 8px; border: 1px solid var(--gray-300); border-radius: 4px; font-size: 13px;"></select>
            </div>
            <div id="prompt-output" style="font-family: monospace; font-size: 12px; background: var(--gray-50); padding: 16px; border-radius: 4px; max-height: 500px; overflow-y: auto; white-space: pre-wrap;"></div>
        </div>
    `;

    const outputDiv = document.getElementById('prompt-output');
    const promptSelect = document.getElementById('prompt-version-select');
    const promptSearchInput = document.getElementById('prompt-search');
    let outputBuffer = '';
    let promptEntries = [];

    function appendOutput(text) {
        outputBuffer += text;
        outputDiv.textContent = outputBuffer;
        outputDiv.scrollTop = outputDiv.scrollHeight;
    }

    function normaliseLine(line = '') {
        return line.replace(/^[\-\*•\s]+/, '').trim();
    }

    function extractVersion(line = '') {
        const trimmed = normaliseLine(line);
        if (!trimmed) return '';
        if (trimmed.includes(':')) {
            return trimmed.split(':')[0].trim();
        }
        const match = trimmed.match(/([A-Za-z0-9_.-]+)/);
        return match ? match[1] : trimmed;
    }

    function populatePromptSelect(filterText = '') {
        const filter = filterText.toLowerCase();
        promptSelect.innerHTML = '';
        const filtered = promptEntries.filter(entry =>
            entry.label.toLowerCase().includes(filter) || entry.version.toLowerCase().includes(filter)
        );
        if (filtered.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = filter ? `No prompts match "${filterText}"` : 'No prompts available';
            option.disabled = true;
            promptSelect.appendChild(option);
            promptSelect.selectedIndex = -1;
            return;
        }
        filtered.forEach(entry => {
            const option = document.createElement('option');
            option.value = entry.version;
            option.textContent = entry.label;
            promptSelect.appendChild(option);
        });
        promptSelect.selectedIndex = 0;
    }

    async function loadPromptList(showOutput = true) {
        outputBuffer = '';
        if (showOutput) {
            outputDiv.textContent = 'Loading prompts...\n';
        }

        let rawOutput = '';
        try {
            await executor.execute('prompts', {
                command: 'list'
            }, (chunk) => {
                rawOutput += `${chunk}\n`;
                if (showOutput) appendOutput(`${chunk}\n`);
            }, (errChunk) => {
                rawOutput += `${errChunk}\n`;
                if (showOutput) appendOutput(`${errChunk}\n`);
            });

            const lines = rawOutput.split(/\n+/).map(line => line.trim()).filter(Boolean);
            promptEntries = lines.map(line => ({
                label: line,
                version: extractVersion(line)
            })).filter(entry => entry.version);

            populatePromptSelect(promptSearchInput.value.trim());
        } catch (error) {
            appendOutput(`\n❌ Error loading prompts: ${error.message}`);
        }
    }

    promptSearchInput.addEventListener('input', () => {
        populatePromptSelect(promptSearchInput.value.trim());
    });

    promptSelect.addEventListener('dblclick', () => {
        document.getElementById('prompts-show').click();
    });

    promptSelect.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            document.getElementById('prompts-show').click();
        }
    });

    document.getElementById('prompts-refresh').addEventListener('click', async () => {
        await loadPromptList(true);
    });

    document.getElementById('prompts-show').addEventListener('click', async () => {
        const version = promptSelect.value?.trim();
        if (!version) {
            appendOutput('\n❌ Please select a prompt version');
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

    // Initial load (without dumping raw output into the console area)
    loadPromptList(false);
    populatePromptSelect();
}

export default initPromptComparison;

