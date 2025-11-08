/**
 * @fileoverview Prompt Comparison UI
 * Executes prompts CLI and displays comparisons
 */

import CommandExecutor from '../utils/commandExecutor.js';

const LEARNING_SIGNALS = [
    {
        title: 'Escalation discipline',
        positive: '+2 when a critical symptom triggers the orchestrator escalation',
        negative: '-2 when escalation is missed; -3 if the agent accepts patient denial',
        source: 'training/simulation/simulation_scorer.js'
    },
    {
        title: 'Handling vagueness',
        positive: '+1 when the companion asks targeted follow-ups to vague users',
        negative: '-1.5 for vague or generic answers when the user withholds details',
        source: 'training/simulation/simulation_scorer.js'
    },
    {
        title: 'Care-plan progression',
        positive: '+1 when adherence, scheduling or symptom tracking goals advance',
        negative: '-1 when medication/adherence guidance is skipped on relevant turns',
        source: 'training/simulation/simulation_scorer.js'
    },
    {
        title: 'Conversation quality (LLM audit)',
        positive: 'Up to +1.5 for empathic structure, safety language and alignment',
        negative: '-1 when the LLM scorer flags safety, empathy or compliance issues',
        source: 'training/simulation/llm_scorer.js'
    }
];

export function initPromptComparison() {
    const container = document.getElementById('prompt-comparison');
    if (!container) return;

    const executor = new CommandExecutor('');

    container.innerHTML = `
        <div style="padding: 16px; display: flex; flex-direction: column; gap: 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                <h3 style="margin: 0;">Prompts</h3>
                <button id="prompts-refresh" class="secondary">Refresh</button>
            </div>
            <sl-select id="prompt-select" filterable clearable hoist placeholder="Search prompt versions..." style="max-width: 520px;">
                <sl-option value="" disabled>Select a prompt...</sl-option>
            </sl-select>
            <div id="prompt-meta-panel" style="border: 1px solid var(--gray-200); border-radius: 8px; padding: 16px; background: #ffffff; display: flex; flex-direction: column; gap: 12px;">
                <div style="font-size: 13px; color: var(--gray-700);">Select a prompt to view metadata (version history, deployment status, scoring).</div>
            </div>
            <div id="prompt-learning-panel" style="background: #ffffff; border: 1px solid var(--gray-200); border-radius: 8px; padding: 16px; display: none; flex-direction: column; gap: 12px;"></div>
            <div id="prompt-output" style="font-family: monospace; font-size: 12px; background: var(--gray-50); padding: 16px; border-radius: 4px; min-height: 240px; max-height: 500px; overflow-y: auto; white-space: pre-wrap;">Select a prompt to view its details.</div>
        </div>
    `;

    const outputDiv = document.getElementById('prompt-output');
    const promptSelect = document.getElementById('prompt-select');
    const refreshButton = document.getElementById('prompts-refresh');
    const metaPanel = document.getElementById('prompt-meta-panel');
    let promptEntries = [];

    function setOutput(text) {
        outputDiv.textContent = text;
        outputDiv.scrollTop = outputDiv.scrollHeight;
    }

    function renderLearningSignalsPanel() {
        const panel = document.getElementById('prompt-learning-panel');
        if (!panel) return;
        if (!LEARNING_SIGNALS.length) {
            panel.style.display = 'none';
            panel.innerHTML = '';
            return;
        }

        const cards = LEARNING_SIGNALS.map(signal => `
            <div style="border: 1px solid var(--gray-200); border-radius: 8px; padding: 12px; background: var(--gray-50); display: flex; flex-direction: column; gap: 6px;">
                <div style="font-weight: 600; color: #202124; font-size: 13px;">${signal.title}</div>
                <div style="font-size: 12px; color: #0b8043;">Reward: ${signal.positive}</div>
                <div style="font-size: 12px; color: #d93025;">Penalty: ${signal.negative}</div>
                <div style="font-size: 11px; color: #5f6368;">Source: ${signal.source}</div>
            </div>
        `).join('');

        panel.style.display = 'flex';
        panel.style.flexDirection = 'column';
        panel.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="font-weight: 600; color: #202124; font-size: 14px;">How the scorer rewards or penalises agent prompts</div>
                <div style="font-size: 12px; color: #5f6368;">
                    Signals originate from the simulation scorer and LLM audits. Use them to compare prompt variants with real optimisation criteria.
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
                    ${cards}
                </div>
            </div>
        `;
    }

    function renderPromptMetadata(entry = null) {
        if (!metaPanel) return;

        if (!entry) {
            metaPanel.innerHTML = `<div style="font-size: 13px; color: var(--gray-700);">Select a prompt to view metadata (version history, deployment status, scoring).</div>`;
            return;
        }

        const formatDate = (value) => {
            if (!value) return '—';
            try {
                return new Date(value).toLocaleString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            } catch {
                return value;
            }
        };

        const score = typeof entry.performance_score === 'number' ? entry.performance_score.toFixed(2) : '0.00';
        const deployedBadge = entry.deployed_at
            ? `<span style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; background:#e6f4ea; color:#188038; font-size:12px;">✅ Deployed ${formatDate(entry.deployed_at)}</span>`
            : `<span style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; background:#f1f3f4; color:#5f6368; font-size:12px;">Not deployed</span>`;

        metaPanel.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px;">
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <div style="font-size:16px; font-weight:600; color:#202124;">${entry.name || 'Unnamed prompt'}</div>
                    <div style="font-size:12px; color:#5f6368;">${entry.description || 'No description provided.'}</div>
                </div>
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:12px; font-size:12px; color:#202124;">
                    <div style="border:1px solid var(--gray-200); border-radius:8px; padding:12px;">
                        <div style="font-weight:600; color:#5f6368;">Version</div>
                        <div style="margin-top:4px; font-family:monospace;">${entry.version}</div>
                    </div>
                    <div style="border:1px solid var(--gray-200); border-radius:8px; padding:12px;">
                        <div style="font-weight:600; color:#5f6368;">Created</div>
                        <div style="margin-top:4px;">${formatDate(entry.created_at)}</div>
                    </div>
                    <div style="border:1px solid var(--gray-200); border-radius:8px; padding:12px;">
                        <div style="font-weight:600; color:#5f6368;">Performance score</div>
                        <div style="margin-top:4px; font-family:monospace;">${score}</div>
                    </div>
                    <div style="border:1px solid var(--gray-200); border-radius:8px; padding:12px;">
                        <div style="font-weight:600; color:#5f6368;">Deployment</div>
                        <div style="margin-top:6px;">${deployedBadge}</div>
                    </div>
                </div>
                <div style="font-size:12px; color:#5f6368;">
                    Use the dropdown to compare versions. Prompt content is shown below; optimisation signals are summarised in the learning panel.
                </div>
            </div>
        `;
    }

    function populatePromptSelect() {
        promptSelect.innerHTML = '';
        const placeholder = document.createElement('sl-option');
        placeholder.value = '';
        placeholder.disabled = true;
        placeholder.textContent = promptEntries.length ? 'Select a prompt...' : 'No prompts available';
        promptSelect.appendChild(placeholder);

        promptEntries.forEach(entry => {
            const option = document.createElement('sl-option');
            option.value = encodeURIComponent(entry.version);
            option.dataset.version = entry.version;
            option.textContent = entry.displayLabel;
            promptSelect.appendChild(option);
        });

        promptSelect.value = '';
    }

    async function loadPromptList(showStatus = true) {
        if (showStatus) setOutput('Loading prompts...');

        try {
            const { prompts = [] } = await window.api.getPrompts(150);
            promptEntries = prompts.map((prompt) => ({
                ...prompt,
                displayLabel: prompt.name ? `${prompt.name} (${prompt.version})` : prompt.version
            }));

            populatePromptSelect();
            if (showStatus) {
                setOutput(promptEntries.length ? 'Select a prompt to view its content.' : 'No prompts available.');
            }
            renderPromptMetadata(null);
        } catch (error) {
            setOutput(`❌ Error loading prompts: ${error.message}`);
            renderPromptMetadata(null);
        }
    }

    async function loadPrompt(version) {
        if (!version) {
            setOutput('Select a prompt to view its details.');
            renderPromptMetadata(null);
            return;
        }

        const selected = promptEntries.find(entry => entry.version === version);
        renderPromptMetadata(selected || null);

        setOutput(`Loading prompt ${version}...\n`);
        let outputBuffer = '';

        try {
            await executor.execute('prompts', {
                command: 'show',
                version
            }, (chunk) => {
                outputBuffer += chunk;
                setOutput(outputBuffer);
            }, (errChunk) => {
                outputBuffer += errChunk;
                setOutput(outputBuffer);
            });
        } catch (error) {
            setOutput(`❌ Error: ${error.message}`);
        }
    }

    promptSelect.addEventListener('sl-change', (event) => {
        const encoded = event.target.value;
        const version = encoded ? decodeURIComponent(encoded) : '';
        loadPrompt(version);
    });

    refreshButton.addEventListener('click', async () => {
        await loadPromptList(true);
    });

    renderLearningSignalsPanel();
    loadPromptList(false);
}

export default initPromptComparison;

