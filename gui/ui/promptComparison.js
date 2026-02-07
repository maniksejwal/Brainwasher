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

    // Cache for loaded prompt contents
    const contentCache = new Map();
    let promptEntries = [];
    let groupedPrompts = {};
    let currentType = '';
    let selectedBaseFn = null;
    let selectedCompareFn = null;

    container.innerHTML = `
        <div style="padding: 16px; display: flex; flex-direction: column; gap: 16px; height: 100%;">
            <!-- Header & Filter -->
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; background: white; padding: 12px; border-radius: 8px; border: 1px solid var(--gray-200);">
                <div style="display: flex; align-items: center; gap: 16px; flex: 1;">
                    <h3 style="margin: 0; min-width: 140px;">Prompt Library</h3>
                    <div style="height: 24px; width: 1px; background: var(--gray-200);"></div>
                    <sl-select id="prompt-type-select" placeholder="Select Prompt Type" style="width: 300px;">
                    </sl-select>
                    <span id="prompt-count" style="font-size: 12px; color: var(--gray-500);"></span>
                </div>
                <button id="prompts-refresh" class="secondary">Refresh</button>
            </div>

            <!-- Versions Table (Scrollable) -->
            <div style="background: white; border: 1px solid var(--gray-200); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; max-height: 300px;">
                <div style="padding: 12px 16px; background: var(--gray-50); border-bottom: 1px solid var(--gray-200); font-weight: 600; font-size: 12px; color: var(--gray-700); display: grid; grid-template-columns: 40px 40px 2fr 100px 140px 100px; gap: 12px;">
                    <div>Base</div>
                    <div>Comp</div>
                    <div>Variant / Description</div>
                    <div>Score</div>
                    <div>Date</div>
                    <div>Status</div>
                </div>
                <div id="versions-list" style="overflow-y: auto; flex: 1;">
                    <div style="padding: 20px; text-align: center; color: var(--gray-500); font-size: 13px;">Select a prompt type to view versions using the dropdown above.</div>
                </div>
            </div>

            <!-- Learning Panel -->
            <div id="prompt-learning-panel" style="background: #ffffff; border: 1px solid var(--gray-200); border-radius: 8px; padding: 16px; display: none; flex-direction: column; gap: 12px;"></div>

            <!-- Comparison View -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; flex: 1; min-height: 400px;">
                <div style="display: flex; flex-direction: column; gap: 0; border: 1px solid var(--gray-200); border-radius: 8px; overflow: hidden; background: white;">
                     <div style="padding: 12px; background: var(--gray-50); border-bottom: 1px solid var(--gray-200); font-weight: 600; font-size: 13px; color: var(--gray-700);">Base Version</div>
                     <div id="prompt-output-1" style="font-family: monospace; font-size: 12px; padding: 16px; height: 100%; overflow-y: auto; white-space: pre-wrap; border: 1px solid var(--gray-200);">Select a base version above...</div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 0; border: 1px solid var(--gray-200); border-radius: 8px; overflow: hidden; background: white;">
                     <div style="padding: 12px; background: var(--gray-50); border-bottom: 1px solid var(--gray-200); font-weight: 600; font-size: 13px; color: var(--gray-700); display: flex; justify-content: space-between;">
                        <span>Comparison Version</span>
                        <span id="score-delta" style="font-weight: bold;"></span>
                     </div>
                     <div id="prompt-output-2" style="font-family: monospace; font-size: 12px; padding: 16px; height: 100%; overflow-y: auto; white-space: pre-wrap; border: 1px solid var(--gray-200);">Select a comparison version above...</div>
                </div>
            </div>
        </div>
    `;

    const typeSelect = document.getElementById('prompt-type-select');
    const versionsList = document.getElementById('versions-list');
    const output1 = document.getElementById('prompt-output-1');
    const output2 = document.getElementById('prompt-output-2');
    const scoreDelta = document.getElementById('score-delta');
    const promptCount = document.getElementById('prompt-count');

    function getPromptType(entry) {
        // Heuristic to group prompts by type based on version string or name
        if (!entry.version) return 'unknown';

        const v = entry.version;
        if (v.startsWith('unified')) return 'Unified Agent';
        if (v.startsWith('doctor_summary')) return 'Doctor Summary';
        if (v.startsWith('doctor_probe')) return 'Doctor Probe';
        if (v.startsWith('enrichment')) return 'Enrichment';
        if (v.startsWith('intent')) return 'Intent';
        if (v.startsWith('companion_')) {
            // Further breakdown for companions?
            if (v.includes('patient_optimizer')) return 'Companion: Patient Optimizer';
            if (v.includes('doctor_optimizer')) return 'Companion: Doctor Optimizer';
            if (v.includes('empathy')) return 'Companion: Empathy';
            if (v.includes('input')) return 'Companion: Input Understanding';
            if (v.includes('clinical')) return 'Companion: Clinical';
            return 'Companion System';
        }

        // Fallback checks on name
        const name = (entry.name || '').toLowerCase();
        if (name.includes('unified')) return 'Unified Agent';
        if (name.includes('doctor') && name.includes('summary')) return 'Doctor Summary';

        return 'Other';
    }

    function renderVersionsTable(type) {
        if (!type || !groupedPrompts[type]) {
            versionsList.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--gray-500); font-size: 13px;">No versions found for this type.</div>`;
            return;
        }

        const entries = groupedPrompts[type]; // Already sorted by date desc

        versionsList.innerHTML = entries.map(entry => {
            const isDeployed = !!entry.deployed_at;
            const score = typeof entry.performance_score === 'number' ? entry.performance_score.toFixed(2) : '0.00';
            const date = new Date(entry.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const description = entry.description || 'No description';
            // Parse "Why" from description if possible, or use full description

            const isBase = selectedBaseFn === entry.version;
            const isComp = selectedCompareFn === entry.version;

            const bg = isDeployed ? '#f0f9ff' : (isBase || isComp ? '#fff8f0' : 'white');

            return `
                <div class="version-row" style="padding: 10px 16px; border-bottom: 1px solid var(--gray-100); display: grid; grid-template-columns: 40px 40px 2fr 100px 140px 100px; gap: 12px; align-items: center; font-size: 13px; background: ${bg};">
                    <div>
                        <input type="radio" name="base-select" value="${entry.version}" ${isBase ? 'checked' : ''} style="cursor: pointer;">
                    </div>
                    <div>
                        <input type="radio" name="compare-select" value="${entry.version}" ${isComp ? 'checked' : ''} style="cursor: pointer;">
                    </div>
                    <div>
                        <div style="font-weight: 500; color: var(--gray-900);">${entry.name || 'Untitled'}</div>
                        <div style="font-size: 11px; color: var(--gray-500); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${description}</div>
                    </div>
                    <div style="font-family: monospace; font-weight: 600; color: var(--gray-700);">${score}</div>
                    <div style="color: var(--gray-600); font-size: 12px;">${date}</div>
                    <div>
                        ${isDeployed ? '<span style="background: #e0f2fe; color: #0284c7; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600;">ACTIVE</span>' : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Re-attach listeners based on new DOM
        versionsList.querySelectorAll('input[name="base-select"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                selectedBaseFn = e.target.value;
                loadContent(selectedBaseFn, 'base');
            });
        });

        versionsList.querySelectorAll('input[name="compare-select"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                selectedCompareFn = e.target.value;
                loadContent(selectedCompareFn, 'compare');
            });
        });
    }

    async function loadContent(version, target) {
        if (!version) return;

        const div = target === 'base' ? output1 : output2;
        div.textContent = 'Loading...';

        try {
            let content = '';
            // Check cache
            if (contentCache.has(version)) {
                content = contentCache.get(version);
            } else {
                // Fetch
                await new Promise((resolve) => {
                    let buffer = '';
                    executor.execute('prompts', { command: 'show', version },
                        (chunk) => buffer += chunk,
                        () => { } // ignore errors
                    ).then(() => {
                        content = buffer;
                        contentCache.set(version, buffer);
                        resolve();
                    });
                });
            }
            div.textContent = content;

            // Update Delta logic if both present
            updateScoreDelta();

        } catch (e) {
            div.textContent = 'Error: ' + e.message;
        }
    }

    function updateScoreDelta() {
        if (!selectedBaseFn || !selectedCompareFn) {
            scoreDelta.textContent = '';
            return;
        }

        const base = groupedPrompts[currentType].find(p => p.version === selectedBaseFn);
        const comp = groupedPrompts[currentType].find(p => p.version === selectedCompareFn);

        if (base && comp) {
            const diff = (comp.performance_score || 0) - (base.performance_score || 0);
            const color = diff > 0 ? 'var(--green-600)' : (diff < 0 ? 'var(--red-600)' : 'var(--gray-600)');
            const sign = diff > 0 ? '+' : '';
            scoreDelta.textContent = `${sign}${diff.toFixed(2)}`;
            scoreDelta.style.color = color;
        }
    }

    async function loadData() {
        try {
            const { prompts = [] } = await window.api.getPrompts(200);
            promptEntries = prompts;

            // Group
            groupedPrompts = {};
            prompts.forEach(p => {
                const type = getPromptType(p);
                if (!groupedPrompts[type]) groupedPrompts[type] = [];
                groupedPrompts[type].push(p);
            });

            // Populate Filter
            typeSelect.innerHTML = '';
            Object.keys(groupedPrompts).sort().forEach(type => {
                const opt = document.createElement('sl-option');
                opt.value = type;
                opt.textContent = `${type} (${groupedPrompts[type].length})`;
                typeSelect.appendChild(opt);
            });

            // Auto-select type if empty
            if (!currentType && Object.keys(groupedPrompts).length > 0) {
                // Prefer 'Unified Agent' if exists
                if (groupedPrompts['Unified Agent']) currentType = 'Unified Agent';
                else currentType = Object.keys(groupedPrompts)[0];
                typeSelect.value = currentType;
            } else {
                typeSelect.value = currentType; // Restore selection
            }

            renderVersionsTable(currentType);

            // Select active one as base by default if none selected
            if (currentType && !selectedBaseFn && groupedPrompts[currentType].length > 0) {
                const deployed = groupedPrompts[currentType].find(p => p.deployed_at);
                const base = deployed || groupedPrompts[currentType][0];
                selectedBaseFn = base.version;
                // Trigger UI update logic for radio
                renderVersionsTable(currentType);
                loadContent(selectedBaseFn, 'base');
            }

        } catch (e) {
            console.error(e);
            versionsList.innerHTML = `<div style="padding: 20px; color: red;">Error loading prompts: ${e.message}</div>`;
        }
    }

    typeSelect.addEventListener('sl-change', (e) => {
        currentType = e.target.value;
        // Reset selections on type change? User expectation: yes usually.
        selectedBaseFn = null;
        selectedCompareFn = null;
        output1.textContent = 'Select a base version...';
        output2.textContent = 'Select a comparison version...';
        scoreDelta.textContent = '';
        renderVersionsTable(currentType);

        // Auto-select active
        const deployed = groupedPrompts[currentType]?.find(p => p.deployed_at);
        if (deployed) {
            selectedBaseFn = deployed.version;
            renderVersionsTable(currentType); // update radios
            loadContent(selectedBaseFn, 'base');
        }
    });

    document.getElementById('prompts-refresh').addEventListener('click', loadData);

    // Initial Load
    loadData();

    // Learning signals (static) if needed
    // renderLearningSignalsPanel(); // kept from previous code if useful, or remove if clutter. User asked for specific "Why".
}

export default initPromptComparison;
