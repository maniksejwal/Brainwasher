/**
 * FRESH, SIMPLE Simulation UI
 * Uses CLI executor to run actual CLI commands
 * Supports both regular and world simulations with network visualization
 */

import CommandExecutor from '../utils/commandExecutor.js';
import NetworkVisualization from './networkVisualization.js';

let networkViz = null;

// Track conversation messages for feedback
const conversationMessages = [];
let personaNameToUserId = {};
let lastSpeakerByRole = {};
let lastRoleSpoken = null;
let simulationInsightCounts = {};

export function initSimulationUI(api, state) {
    const runButton = document.getElementById('run-simulation');
    const scenarioSelect = document.getElementById('scenario-select');
    const turnsSelect = document.getElementById('turns-select');
    const resultsDiv = document.getElementById('simulation-results');
    const simulationTypeSelect = document.getElementById('simulation-type');
    const regularControls = document.getElementById('regular-simulation-controls');
    const worldControls = document.getElementById('world-simulation-controls');
    const worldScenarioSelect = document.getElementById('world-scenario-select');
    const networkContainer = document.getElementById('network-visualization-container');
    const showNetworkCheckbox = document.getElementById('show-network');
    
    if (!runButton || !scenarioSelect || !turnsSelect || !resultsDiv) {
        console.error('[SimUI] Required elements not found');
        return;
    }
    
    const executor = new CommandExecutor('');
    
    // Initialize network visualization
    if (document.getElementById('network-canvas')) {
        networkViz = new NetworkVisualization('network-canvas');
        networkViz.init();
    }
    
    // Handle simulation type change
    if (simulationTypeSelect) {
        simulationTypeSelect.addEventListener('change', (e) => {
            if (e.target.value === 'world') {
                regularControls.style.display = 'none';
                worldControls.style.display = 'block';
                loadWorldScenarios(api);
            } else {
                regularControls.style.display = 'block';
                worldControls.style.display = 'none';
                if (networkContainer) networkContainer.style.display = 'none';
            }
        });
    }
    
    // Handle network visibility toggle
    if (showNetworkCheckbox) {
        showNetworkCheckbox.addEventListener('change', (e) => {
            if (e.target.checked && simulationTypeSelect?.value === 'world') {
                if (networkContainer) networkContainer.style.display = 'block';
            } else {
                if (networkContainer) networkContainer.style.display = 'none';
            }
        });
    }
    
    // Handle network visualization toggles
    const toggleLogs = document.getElementById('toggle-logs');
    const togglePrompts = document.getElementById('toggle-prompts');
    const toggleHardware = document.getElementById('toggle-hardware');
    
    if (toggleLogs && networkViz) {
        toggleLogs.addEventListener('change', (e) => {
            networkViz.toggleLogs(e.target.checked);
        });
    }
    if (togglePrompts && networkViz) {
        togglePrompts.addEventListener('change', (e) => {
            networkViz.togglePrompts(e.target.checked);
        });
    }
    if (toggleHardware && networkViz) {
        toggleHardware.addEventListener('change', (e) => {
            networkViz.toggleHardware(e.target.checked);
        });
    }
    
    // Load scenarios
    loadScenarios(api);
    // Also load world scenarios initially (they'll be hidden until world type is selected)
    loadWorldScenarios(api);
    
    // Run simulation
    runButton.addEventListener('click', async () => {
        const simType = simulationTypeSelect?.value || 'regular';
        const scenario = simType === 'world' ? (worldScenarioSelect?.value || '') : scenarioSelect.value;
        const turns = turnsSelect.value;
        const collectFeedback = document.getElementById('collect-feedback')?.checked || false;
        
        if (!scenario) {
            resultsDiv.innerHTML = '<div style="color: red;">Please select a scenario</div>';
            return;
        }
        
        // Clear previous results
        resultsDiv.innerHTML = '';
        conversationMessages.length = 0;
        parsedMessages = [];
        networkInitialized = false;
        personaNameToUserId = {};
        lastSpeakerByRole = {};
        lastRoleSpoken = null;
        simulationInsightCounts = {};
        
        const startDiv = document.createElement('div');
        startDiv.style.cssText = 'padding: 16px; background: var(--blue-50); border-radius: 4px;';
        startDiv.innerHTML = `🔬 Starting ${simType === 'world' ? 'world' : ''} simulation...`;
        resultsDiv.appendChild(startDiv);
        
        runButton.disabled = true;
        
        try {
            if (simType === 'world') {
                // Run world simulation
                await executor.execute('world-simulation', {
                    scenario,
                    skipFeedback: !collectFeedback
                }, (output) => {
                    const outputDiv = document.createElement('div');
                    outputDiv.style.cssText = 'padding: 8px; font-family: monospace; font-size: 12px; color: var(--gray-700);';
                    outputDiv.textContent = output;
                    resultsDiv.appendChild(outputDiv);
                    resultsDiv.scrollTop = resultsDiv.scrollHeight;
                    
                    // Parse and visualize messages in real-time
                    parseSimulationOutput(output, scenario, simType);
                }, (error) => {
                    const errorDiv = document.createElement('div');
                    errorDiv.style.cssText = 'padding: 8px; font-family: monospace; font-size: 12px; color: var(--red-600);';
                    errorDiv.textContent = error;
                    resultsDiv.appendChild(errorDiv);
                    resultsDiv.scrollTop = resultsDiv.scrollHeight;
                });
            } else {
                // Run regular simulation
                await executor.execute('run-simulation', {
                    scenario,
                    turns: turns === 'random' ? undefined : parseInt(turns),
                    skipFeedback: !collectFeedback
                }, (output) => {
                    const outputDiv = document.createElement('div');
                    outputDiv.style.cssText = 'padding: 8px; font-family: monospace; font-size: 12px; color: var(--gray-700);';
                    outputDiv.textContent = output;
                    resultsDiv.appendChild(outputDiv);
                    resultsDiv.scrollTop = resultsDiv.scrollHeight;
                    
                    // Parse and visualize messages in real-time
                    parseSimulationOutput(output, scenario, simType);
                }, (error) => {
                    const errorDiv = document.createElement('div');
                    errorDiv.style.cssText = 'padding: 8px; font-family: monospace; font-size: 12px; color: var(--red-600);';
                    errorDiv.textContent = error;
                    resultsDiv.appendChild(errorDiv);
                    resultsDiv.scrollTop = resultsDiv.scrollHeight;
                });
            }
            
            runButton.disabled = false;
            
            // Add completion message
            const completeDiv = document.createElement('div');
            completeDiv.style.cssText = 'padding: 12px; background: var(--green-50); border-radius: 4px; margin-top: 16px;';
            completeDiv.innerHTML = '<div style="font-weight: 500; color: var(--green-700);">✅ Simulation complete!</div>';
            resultsDiv.appendChild(completeDiv);

            renderSimulationInsights(resultsDiv);
            renderFeedbackPrompt(resultsDiv, collectFeedback, scenario, simType);

            if (simType === 'world' && showNetworkCheckbox?.checked) {
                initializeNetworkVisualization(scenario);
            }

        } catch (error) {
            runButton.disabled = false;
            resultsDiv.innerHTML += `<div style="color: red; padding: 16px; margin-top: 8px;">❌ Error: ${error.message}</div>`;
        }
    });
}

// Track parsed messages for visualization
let parsedMessages = [];
let networkInitialized = false;

/**
 * Parse simulation output to extract messages and update visualization
 */
function parseSimulationOutput(output, scenarioKey, simType) {
    if (!output) return;

    const lines = output.split('\n');

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        // Initialize network once when world simulation begins producing output
        if (simType === 'world' && !networkInitialized && (
            line.includes('Starting conversation for circle') ||
            line.includes('WORLD SIMULATION CLI') ||
            line.includes('WORLD SIMULATION COMPLETE')
        )) {
            initializeNetworkVisualization(scenarioKey);
        }

        // ROLE (Persona Name): message
        const personaMatch = line.match(/^(PATIENT|CAREGIVER|DOCTOR|USER)\s*\(([^)]+)\):\s*(.+)$/i);
        if (personaMatch) {
            const roleRaw = personaMatch[1].toLowerCase();
            const personaName = personaMatch[2].trim();
            const message = personaMatch[3].trim();
            const userId = resolveUserId(personaName, roleRaw);

            if (userId && message) {
                lastSpeakerByRole[roleRaw] = userId;
                lastRoleSpoken = roleRaw;
                parsedMessages.push({ role: roleRaw, userId, message, timestamp: Date.now() });
                animateMessageFlow(roleRaw, userId, message);
            }
            continue;
        }

        // ROLE_AGENT: message (agent responses)
        const agentMatch = line.match(/^(PATIENT_AGENT|CAREGIVER_AGENT|DOCTOR_AGENT|COMPANION_AGENT|AGENT):\s*(.+)$/i);
        if (agentMatch) {
            const agentRoleRaw = agentMatch[1].toLowerCase();
            const message = agentMatch[2].trim();
            let baseRole = agentRoleRaw.replace('_agent', '');

            if (!baseRole || baseRole === 'agent' || baseRole === 'companion') {
                baseRole = lastRoleSpoken || 'patient';
            }

            const userId = lastSpeakerByRole[baseRole];
            if (userId && message) {
                parsedMessages.push({ role: `${baseRole}_agent`, userId, message, timestamp: Date.now() });
                animateMessageFlow('agent', userId, message);
            }
            continue;
        }

        // ROLE: message (fallback without persona name)
        const simpleMatch = line.match(/^(PATIENT|CAREGIVER|DOCTOR|USER|COMPANION):\s*(.+)$/i);
        if (simpleMatch) {
            const roleRaw = simpleMatch[1].toLowerCase();
            const message = simpleMatch[2].trim();
            const userId = lastSpeakerByRole[roleRaw] || (lastRoleSpoken ? lastSpeakerByRole[lastRoleSpoken] : null);

            if (userId && message) {
                parsedMessages.push({ role: roleRaw, userId, message, timestamp: Date.now() });
                animateMessageFlow(roleRaw, userId, message);
            }
            continue;
        }

        const flaggedMatch = line.match(/\[SimulationReporter\]\[Message Flagged\]\s+([^:]+):/);
        if (flaggedMatch) {
            const key = normalizeName(flaggedMatch[1] || 'flagged');
            simulationInsightCounts[key] = (simulationInsightCounts[key] || 0) + 1;
        }
    }
}

/**
 * Initialize network visualization from scenario
 */
function initializeNetworkVisualization(scenarioKey) {
    if (!networkViz || !document.getElementById('show-network')?.checked) return;
    
    window.api.getScenarios().then(data => {
        const scenario = data.scenarios[scenarioKey];
        if (!scenario || !scenario.circles) return;
        
        const nodes = [];
        const edges = [];
        const circles = [];
        const personas = data.personas || {};

        personaNameToUserId = {};
        lastSpeakerByRole = {};
        lastRoleSpoken = null;
        
        // Create user nodes
        scenario.users?.forEach((user, idx) => {
            nodes.push({
                id: `user_${user.username}`,
                type: 'user',
                label: user.username,
                circleIds: user.circles?.map(c => c.circleId) || []
            });

            const personaKey = user.persona || user.personaKey;
            const personaData = personaKey ? personas[personaKey] : null;
            const personaName = personaData?.name;
            const displayNames = [user.username, personaName];

            if (personaName) {
                const firstName = personaName.split(' ')[0];
                displayNames.push(firstName);
            }

            displayNames
                .filter(Boolean)
                .forEach(name => {
                    personaNameToUserId[normalizeName(name)] = user.username;
                });
            
            // Create companion for each user
            nodes.push({
                id: `companion_${user.username}`,
                type: 'companion',
                userId: `user_${user.username}`,
                label: `${user.username} Companion`,
                hardware: { model: 'gpt-3.5-turbo', apiStatus: 'active', latency: Math.floor(Math.random() * 200) }
            });
            
            edges.push({
                from: `user_${user.username}`,
                to: `companion_${user.username}`,
                type: 'has'
            });
            
            // Create companion components
            const companionId = `companion_${user.username}`;
            nodes.push({
                id: `handler_input_${user.username}`,
                type: 'handler',
                companionId,
                label: 'Input Handler'
            });
            nodes.push({
                id: `coordinator_${user.username}`,
                type: 'coordinator',
                companionId,
                label: 'Coordinator'
            });
            nodes.push({
                id: `agent_clinical_${user.username}`,
                type: 'agent',
                companionId,
                label: 'Clinical Agent'
            });
            
            edges.push({ from: companionId, to: `handler_input_${user.username}`, type: 'contains' });
            edges.push({ from: companionId, to: `coordinator_${user.username}`, type: 'contains' });
            edges.push({ from: `coordinator_${user.username}`, to: `agent_clinical_${user.username}`, type: 'contains' });
        });
        
        // Create circle backgrounds
        scenario.circles.forEach((circle, idx) => {
            const angle = (idx * 2 * Math.PI) / scenario.circles.length;
            const radius = 200;
            circles.push({
                id: circle.name?.toLowerCase().replace(/\s+/g, '_') || `circle_${idx}`,
                name: circle.name || `Circle ${idx + 1}`,
                patientId: circle.primaryPatientId,
                members: circle.members || [],
                color: ['#4285F4', '#34A853', '#FBBC04', '#EA4335'][idx % 4],
                x: 400 + radius * Math.cos(angle),
                y: 300 + radius * Math.sin(angle),
                radius: 150
            });
        });
        
        networkViz.update({ nodes, edges, circles });
        const container = document.getElementById('network-visualization-container');
        if (container) container.style.display = 'block';
        networkInitialized = true;
    }).catch(err => {
        console.error('[SimUI] Failed to load scenario for network:', err);
    });
}

/**
 * Animate message flow between nodes
 */
function animateMessageFlow(role, userId, message) {
    if (!networkViz || !userId) return;

    const normalizedRole = role.toLowerCase();
    const baseId = userId;
    const isAgent = normalizedRole.includes('agent') || normalizedRole === 'companion';
    const fromNodeId = isAgent ? `companion_${baseId}` : `user_${baseId}`;
    const toNodeId = isAgent ? `user_${baseId}` : `companion_${baseId}`;

    networkViz.animateMessage(fromNodeId, toNodeId, message.substring(0, 80));
}

function resolveUserId(name, role = '') {
    if (!name) return role ? lastSpeakerByRole[role] || null : null;
    const normalizedKey = normalizeName(name);

    if (personaNameToUserId[normalizedKey]) {
        return personaNameToUserId[normalizedKey];
    }

    return role ? lastSpeakerByRole[role] || null : null;
}

function normalizeName(value = '') {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function renderFeedbackPrompt(resultsDiv, shouldShow, scenarioKey, simType) {
    const existing = document.getElementById('simulation-feedback-form');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'simulation-feedback-form';
    container.style.cssText = 'margin-top: 16px; padding: 16px; background: var(--gray-50); border-radius: 8px;';
    container.innerHTML = `
        <h4 style="margin-top: 0;">💬 Share quick feedback</h4>
        <p style="font-size: 13px; color: var(--gray-600); margin-bottom: 12px;">
            Rate this simulation run to help tuning. Feedback is stored immediately and does not block future runs.
        </p>
        <div style="display: flex; gap: 8px; margin-bottom: 12px;">
            <label><input type="radio" name="sim-feedback-score" value="1"> 👍 Helpful</label>
            <label><input type="radio" name="sim-feedback-score" value="0"> 😐 Neutral</label>
            <label><input type="radio" name="sim-feedback-score" value="-1"> 👎 Needs work</label>
        </div>
        <textarea id="sim-feedback-comment" placeholder="Optional comment (max 280 chars)" style="width: 100%; min-height: 80px; padding: 8px; border: 1px solid var(--gray-300); border-radius: 4px;"></textarea>
        <div style="margin-top: 12px; display: flex; gap: 8px; align-items: center;">
            <button id="submit-sim-feedback" class="secondary">Submit feedback</button>
            <span id="sim-feedback-status" style="font-size: 12px; color: var(--gray-600);"></span>
        </div>
    `;

    resultsDiv.appendChild(container);

    if (!shouldShow) {
        container.style.display = 'none';
        return;
    }

    const submitBtn = container.querySelector('#submit-sim-feedback');
    const statusEl = container.querySelector('#sim-feedback-status');

    submitBtn.addEventListener('click', async () => {
        const score = Array.from(container.querySelectorAll('input[name="sim-feedback-score"]'))
            .find(input => input.checked)?.value;
        if (typeof score === 'undefined') {
            statusEl.textContent = 'Select a rating before submitting.';
            statusEl.style.color = 'var(--red-600)';
            return;
        }

        const comment = container.querySelector('#sim-feedback-comment').value.slice(0, 280);
        const conversationId = `${simType === 'world' ? 'world' : 'sim'}_${scenarioKey || 'custom'}_${Date.now()}`;

        statusEl.textContent = 'Saving...';
        statusEl.style.color = 'var(--gray-600)';

        try {
            await window.api.provideFeedback('simulation_gui', conversationId, Number(score), comment);
            statusEl.textContent = 'Thanks! Feedback saved.';
            statusEl.style.color = 'var(--green-600)';
        } catch (error) {
            statusEl.textContent = `Save failed: ${error.message}`;
            statusEl.style.color = 'var(--red-600)';
        }
    });
}

function renderSimulationInsights(resultsDiv) {
    const existing = document.getElementById('simulation-insights-summary');
    if (existing) existing.remove();

    const entries = Object.entries(simulationInsightCounts)
        .sort((a, b) => b[1] - a[1]);

    const container = document.createElement('div');
    container.id = 'simulation-insights-summary';
    container.style.cssText = 'margin-top: 16px; padding: 16px; background: var(--gray-50); border-radius: 8px;';
    container.innerHTML = '<h4 style="margin: 0 0 12px 0;">🔍 Simulation Insights</h4>';

    if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size: 12px; color: var(--gray-600);';
        empty.textContent = 'No reporter insights flagged during this run.';
        container.appendChild(empty);
        resultsDiv.appendChild(container);
        return;
    }

    const list = document.createElement('div');
    list.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

    entries.forEach(([key, count]) => {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; font-size: 13px;';
        row.innerHTML = `
            <span>${label}</span>
            <span style="font-weight: 600;">${count}</span>
        `;
        list.appendChild(row);
    });

    container.appendChild(list);
    resultsDiv.appendChild(container);
}

async function loadWorldScenarios(api) {
    const select = document.getElementById('world-scenario-select');
    if (!select) return;
    
    try {
        const data = await api.getScenarios();
        select.innerHTML = '';
        
        // Filter for world scenarios (those with circles property)
        const worldScenarios = Object.entries(data.scenarios || {})
            .filter(([key, scenario]) => scenario.circles && Array.isArray(scenario.circles));
        
        if (worldScenarios.length === 0) {
            select.innerHTML = '<option value="">No world scenarios available</option>';
            return;
        }
        
        worldScenarios.forEach(([key, scenario]) => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = scenario.name || key;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('[SimUI] Failed to load world scenarios:', error);
        select.innerHTML = '<option value="">Error loading scenarios</option>';
    }
}

async function loadScenarios(api) {
    const select = document.getElementById('scenario-select');
    if (!select) return;
    
    try {
        const data = await api.getScenarios();
        select.innerHTML = '';
        
        // Add truly random as first and default option
        const randomOption = document.createElement('option');
        randomOption.value = 'random';
        randomOption.textContent = '🎲 Random (Default)';
        randomOption.selected = true;
        select.appendChild(randomOption);
        
        // Add all scenarios including random_single
        Object.keys(data.scenarios).forEach(key => {
            const scenario = data.scenarios[key];
            const option = document.createElement('option');
            option.value = key;
            option.textContent = scenario.name;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('[SimUI] Failed to load scenarios:', error);
        select.innerHTML = '<option value="random_single">🎲 Random (Fallback)</option>';
    }
}

// Handle SSE simulation messages (for backward compatibility)
export function displaySimulationMessage(data) {
    // This function is kept for backward compatibility but CLI-executed simulations
    // don't use SSE - they stream output directly
    console.log('[SimUI] SSE message received (may be from old API):', data);
}
