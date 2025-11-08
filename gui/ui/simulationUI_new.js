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
let parsedMessages = [];
let networkInitialized = false;
let circleNameToId = {};
let userCircleMap = {};
let currentCircleName = null;
let eventLogContainer = null;

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
    const updateNetworkVisibility = () => {
        if (!networkContainer) return;
        if (showNetworkCheckbox?.checked && networkViz?.nodes?.length) {
            networkContainer.style.display = 'block';
        } else {
            networkContainer.style.display = 'none';
        }
    };
    
    if (simulationTypeSelect) {
        simulationTypeSelect.addEventListener('change', (e) => {
            const isWorld = e.target.value === 'world';
            regularControls.style.display = isWorld ? 'none' : 'block';
            worldControls.style.display = isWorld ? 'block' : 'none';
            if (isWorld) {
                loadWorldScenarios(api);
                if (showNetworkCheckbox) showNetworkCheckbox.checked = true;
            }
            updateNetworkVisibility();
        });
    }
    
    // Handle network visibility toggle
    if (showNetworkCheckbox) {
        showNetworkCheckbox.addEventListener('change', () => {
            updateNetworkVisibility();
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
        circleNameToId = {};
        userCircleMap = {};
        currentCircleName = null;
        eventLogContainer = document.getElementById('network-event-log');
        if (eventLogContainer) {
            eventLogContainer.innerHTML = '';
        }
        if (networkContainer) {
            networkContainer.style.display = 'none';
        }
        if (networkViz) {
            networkViz.update({ nodes: [], edges: [], circles: [] });
        }
        
        const startDiv = document.createElement('div');
        startDiv.style.cssText = 'padding: 16px; background: var(--blue-50); border-radius: 4px;';
        startDiv.innerHTML = `🔬 Starting ${simType === 'world' ? 'world' : ''} simulation...`;
        resultsDiv.appendChild(startDiv);
        
        if (showNetworkCheckbox?.checked && scenario && scenario !== 'random') {
            initializeNetworkVisualization(scenario);
        }

        runButton.disabled = true;
        const originalButtonLabel = runButton.textContent;
        runButton.textContent = '⏳ Running...';
        
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

            // Add completion message
            const completeDiv = document.createElement('div');
            completeDiv.style.cssText = 'padding: 12px; background: var(--green-50); border-radius: 4px; margin-top: 16px;';
            completeDiv.innerHTML = '<div style="font-weight: 500; color: var(--green-700);">✅ Simulation complete!</div>';
            resultsDiv.appendChild(completeDiv);

            renderSimulationInsights(resultsDiv);
            renderFeedbackPrompt(resultsDiv, collectFeedback, scenario, simType);

        } catch (error) {
            resultsDiv.innerHTML += `<div style="color: red; padding: 16px; margin-top: 8px;">❌ Error: ${error.message}</div>`;
        } finally {
            runButton.disabled = false;
            runButton.textContent = originalButtonLabel;
        }
    });
}

/**
 * Parse simulation output to extract messages and update visualization
 */
function parseSimulationOutput(output, scenarioKey, simType) {
    if (!output) return;

    if (!networkInitialized && scenarioKey && scenarioKey !== 'random') {
        initializeNetworkVisualization(scenarioKey);
    }

    const lines = output.split('\n');

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line.includes('Starting conversation for circle')) {
            const circleName = line.split(':').slice(1).join(':').trim();
            currentCircleName = circleName;
            logSimulationEvent('circle', {
                circle: currentCircleName,
                actor: 'Conversation start',
                message: 'Conversation flow initialized'
            });
            const circleId = circleNameToId[currentCircleName?.toLowerCase?.()] || null;
            if (circleId) {
                networkViz?.highlightCircle(circleId);
            }
            continue;
        }

        if (line.startsWith('[Orchestrator] Future plan executed')) {
            logSimulationEvent('orchestrator', {
                circle: currentCircleName,
                actor: 'Future plan',
                message: line.replace('[Orchestrator] ', '')
            });
            const circleId = circleNameToId[currentCircleName?.toLowerCase?.()] || null;
            if (circleId) {
                networkViz?.highlightCircle(circleId, '#ea4335');
            }
            continue;
        }

        if (line.startsWith('[RescheduleHandler]')) {
            logSimulationEvent('reschedule', {
                circle: currentCircleName,
                actor: 'Schedule update',
                message: line.replace('[RescheduleHandler] ', '')
            });
            continue;
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
                parsedMessages.push({
                    role: `${baseRole}_agent`,
                    userId, message, timestamp: Date.now()
                });
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
    if (!networkViz || !scenarioKey) return;
    
    window.api.getScenarios().then(data => {
        const scenario = data.scenarios[scenarioKey];
        if (!scenario) return;
        
        const nodes = [];
        const edges = [];
        const circles = [];
        const personas = data.personas || {};

        personaNameToUserId = {};
        lastSpeakerByRole = {};
        lastRoleSpoken = null;
        circleNameToId = {};
        userCircleMap = {};
        
        const availableCircles = Array.isArray(scenario.circles) && scenario.circles.length
            ? scenario.circles
            : [{
                name: scenario.name || scenarioKey,
                primaryPatientId: scenario.users?.find(u => u.role === 'patient')?.username || scenario.users?.[0]?.username || scenarioKey,
                members: scenario.users?.map(user => user.username) || []
            }];

        const resolvedCircles = availableCircles.map((circle, idx) => {
            const circleId = circle.circleId || circle.id || (circle.name ? circle.name.toLowerCase().replace(/\s+/g, '_') : `circle_${idx}`);
            const angle = (idx * 2 * Math.PI) / Math.max(availableCircles.length, 1);
            const radius = 200;
            if (circleId) {
                circleNameToId[circleId.toLowerCase()] = circleId;
            }
            circleNameToId[(circle.name || circleId || '').toLowerCase()] = circleId;
            return {
                id: circleId,
                name: circle.name || `Circle ${idx + 1}`,
                patientId: circle.primaryPatientId,
                members: circle.members || [],
                color: ['#4285F4', '#34A853', '#FBBC04', '#EA4335'][idx % 4],
                x: 400 + radius * Math.cos(angle),
                y: 300 + radius * Math.sin(angle),
                radius: 150
            };
        });

        // Create user nodes
        scenario.users?.forEach((user) => {
            const defaultCircleIds = resolvedCircles.map(circle => circle.id);
            const userCircles = Array.isArray(user.circles) && user.circles.length
                ? user.circles.map(c => {
                    const base = typeof c === 'string' ? c : (c.circleId || c.circleName || c.name);
                    return circleNameToId[base?.toLowerCase?.()] || base;
                }).filter(Boolean)
                : (defaultCircleIds.length ? [defaultCircleIds[0]] : []);

            userCircleMap[user.username] = userCircles;

            nodes.push({
                id: `user_${user.username}`,
                type: 'user',
                label: user.username,
                circleIds: userCircleMap[user.username]
            });

            if (user.role) {
                lastSpeakerByRole[user.role.toLowerCase()] = user.username;
            }

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
                source: `user_${user.username}`,
                target: `companion_${user.username}`,
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
            
            edges.push({ source: companionId, target: `handler_input_${user.username}`, type: 'contains' });
            edges.push({ source: companionId, target: `coordinator_${user.username}`, type: 'contains' });
            edges.push({ source: `coordinator_${user.username}`, target: `agent_clinical_${user.username}`, type: 'contains' });
        });
        
        resolvedCircles.forEach(circle => circles.push(circle));
        
        networkViz.update({ nodes, edges, circles });
        const container = document.getElementById('network-visualization-container');
        const showNetworkEl = document.getElementById('show-network');
        if (container && showNetworkEl?.checked) {
            container.style.display = 'block';
        }
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
    if (isAgent) {
        networkViz.highlightAgent(baseId);
        logSimulationEvent('agent', {
            circle: currentCircleName,
            actor: `${baseId} Agent`,
            message
        });
    } else {
        networkViz.highlightUser(baseId);
        const circlesForUser = userCircleMap[baseId];
        if (Array.isArray(circlesForUser)) {
            circlesForUser.forEach(circleId => networkViz.highlightCircle(circleId));
        }
        logSimulationEvent('user', {
            circle: currentCircleName,
            actor: baseId,
            message
        });
    }
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

function logSimulationEvent(type, payload) {
    if (!eventLogContainer) return;
    const escapeHtml = (value) => {
        if (!value) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    const entry = document.createElement('div');
    entry.style.cssText = 'background: white; border-radius: 6px; padding: 10px 12px; border-left: 3px solid var(--gray-200); box-shadow: 0 1px 2px rgba(0,0,0,0.04);';

    const iconMap = {
        user: '🧑',
        agent: '🤖',
        orchestrator: '🛠️',
        reschedule: '♻️',
        circle: '🟢'
    };

    const badgeColor = {
        user: '#1a73e8',
        agent: '#9c27b0',
        orchestrator: '#ea4335',
        reschedule: '#fbbc04',
        circle: '#34a853'
    };

    const icon = iconMap[type] || 'ℹ️';
    const accent = badgeColor[type] || '#5f6368';

    const circleLabel = payload?.circle ? `<span style="color:${accent}; font-weight:600;">[${escapeHtml(payload.circle)}]</span>` : '';
    const actor = payload?.actor ? `<strong>${escapeHtml(payload.actor)}</strong>` : '';
    const message = payload?.message ? `<div style="margin-top:4px; color: var(--gray-700);">${escapeHtml(payload.message)}</div>` : '';

    entry.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:16px;">${icon}</span>
            <div style="flex:1; min-width:0;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <span style="color:${accent}; font-weight:600; text-transform:uppercase; font-size:11px; letter-spacing:0.05em;">${type}</span>
                    <span style="font-size:11px; color: var(--gray-500);">${escapeHtml(new Date().toLocaleTimeString())}</span>
                </div>
                <div style="margin-top:4px; display:flex; flex-direction:column; gap:2px;">
                    <div style="font-size:12px; color: var(--gray-800);">${circleLabel} ${actor}</div>
                    ${message}
                </div>
            </div>
        </div>
    `;

    eventLogContainer.appendChild(entry);
    eventLogContainer.scrollTop = eventLogContainer.scrollHeight;
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
