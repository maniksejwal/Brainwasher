/**
 * FRESH, SIMPLE Simulation UI
 * Uses CLI executor to run actual CLI commands
 * Supports both regular and world simulations with network visualization
 */

import CommandExecutor from '../utils/commandExecutor.js';
import NetworkVisualization from './networkVisualization.js';
import {
    resetState,
    getState,
    setNetworkInitialized,
    isNetworkInitialized,
    setParticipants,
    areParticipantsReady,
    registerParticipant,
    recordCircleMembership,
    resolveUsernameByPersona,
    setLastSpeaker,
    getLastSpeaker,
    enqueuePendingLine,
    flushPendingLines,
    normalize as normalizeKey,
    addProvisionalParticipant,
    getProvisionalRoster,
    hasProvisionalParticipants,
    clearProvisionalParticipants,
    incrementProvisionalFragmentCount,
    getProvisionalFragmentCount,
    getProvisionalTotals,
    resetRosterBuffer,
    updateRosterSection,
    markRosterSection,
    getRosterSnapshot,
    isRosterComplete,
    hasRosterSeed,
    consumeRosterBuffer
} from './simulationState.js';
import config from '../config.js';

let networkViz = null;
let currentExecutor = null;

// Track conversation messages for feedback
const conversationMessages = [];
let lastRoleSpoken = null;
let simulationInsightCounts = {};
let parsedMessages = [];
let currentCircleName = null;
let eventLogContainer = null;
let companionComponentsPromise = null;
let companionManifest = null;
let showNetworkToggle = null;
let networkContainerRef = null;
let updateNetworkVisibility = () => {};
let structureInfoContainer = null;
let userColorMap = {};
let scenarioLookupByName = {};
let activeScenarioKey = null;
let networkPlaceholder = null;
let networkPlaceholderText = null;
let networkPlaceholderTimer = null;
let networkPlaceholderStart = null;
let networkPlaceholderBaseMessage = 'Waiting for CLI participants…';
let provisionalBootstrapAttempted = false;
let lastProvisionalCount = 0;

function buildScenarioLookup(data) {
    const lookup = {};
    const scenarios = data?.scenarios || {};
    Object.entries(scenarios).forEach(([key, scenario]) => {
        if (!scenario) return;
        const name = scenario.name || key;
        lookup[key] = key;
        lookup[name] = key;
        lookup[normalizeName(name)] = key;
    });
    scenarioLookupByName = lookup;
}

export function initSimulationUI(api, state) {
    const runButton = document.getElementById('run-simulation');
    const stopButton = document.getElementById('stop-simulation');
    const restartButton = document.getElementById('restart-simulation');
    const scenarioSelect = document.getElementById('scenario-select');
    const turnsSelect = document.getElementById('turns-select');
    const resultsDiv = document.getElementById('simulation-results');
    const simulationTypeSelect = document.getElementById('simulation-type');
    const regularControls = document.getElementById('regular-simulation-controls');
    const worldControls = document.getElementById('world-simulation-controls');
    const worldScenarioSelect = document.getElementById('world-scenario-select');
    networkContainerRef = document.getElementById('network-visualization-container');
    showNetworkToggle = document.getElementById('show-network');
    structureInfoContainer = document.getElementById('network-structure-info');
    networkPlaceholder = document.getElementById('network-placeholder');
    networkPlaceholderText = networkPlaceholder?.querySelector('.network-placeholder-text') || null;
    
    if (!runButton || !scenarioSelect || !turnsSelect || !resultsDiv) {
        console.error('[SimUI] Required elements not found');
        return;
    }
    
    const executor = new CommandExecutor(api.baseUrl ?? config.ORCHESTRATOR_URL);
    currentExecutor = executor;
    
    // Initialize network visualization
    if (document.getElementById('network-canvas')) {
        networkViz = new NetworkVisualization('network-canvas');
        networkViz.init();
    }
    
    // Handle simulation type change
    updateNetworkVisibility = () => {
        if (!networkContainerRef) return;
        const shouldShow = showNetworkToggle?.checked;
        networkContainerRef.style.display = shouldShow ? 'block' : 'none';
        if (!shouldShow) {
            hideWaitingPlaceholder();
            return;
        }
        if (isNetworkInitialized()) {
            hideWaitingPlaceholder();
            if (structureInfoContainer) {
                structureInfoContainer.style.display = structureInfoContainer.innerHTML ? 'flex' : 'none';
            }
        } else {
            showWaitingPlaceholder();
            if (structureInfoContainer) {
                structureInfoContainer.style.display = 'none';
            }
        }
    };
    
    if (simulationTypeSelect) {
        simulationTypeSelect.addEventListener('change', (e) => {
            const isWorld = e.target.value === 'world';
            regularControls.style.display = isWorld ? 'none' : 'block';
            worldControls.style.display = isWorld ? 'block' : 'none';
            if (isWorld) {
                loadWorldScenarios(api);
                if (showNetworkToggle) showNetworkToggle.checked = true;
            }
            updateNetworkVisibility();
        });
    }
    
    // Handle network visibility toggle
    if (showNetworkToggle) {
        showNetworkToggle.addEventListener('change', () => {
            updateNetworkVisibility();
        });
    }
    
    // Handle network visualization toggles
    const toggleMessages = document.getElementById('toggle-messages');
    const toggleEventLog = document.getElementById('toggle-event-log');
    const togglePrompts = document.getElementById('toggle-prompts');
    const toggleHardware = document.getElementById('toggle-hardware');
    const eventLogPanel = document.getElementById('network-event-log');

    const applyMessageVisibility = (show) => {
        if (networkViz) {
            networkViz.toggleLogs(show);
        }
    };

    const applyEventLogVisibility = (show) => {
        if (eventLogPanel) {
            eventLogPanel.style.display = show ? 'flex' : 'none';
        }
    };

    if (toggleMessages) {
        applyMessageVisibility(Boolean(toggleMessages.checked));
        toggleMessages.addEventListener('change', (e) => {
            applyMessageVisibility(Boolean(e.target.checked));
        });
    }

    if (toggleEventLog) {
        applyEventLogVisibility(Boolean(toggleEventLog.checked));
        toggleEventLog.addEventListener('change', (e) => {
            applyEventLogVisibility(Boolean(e.target.checked));
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
        lastRoleSpoken = null;
        simulationInsightCounts = {};
        currentCircleName = null;
        resetState();
        provisionalBootstrapAttempted = false;
        lastProvisionalCount = 0;
        setNetworkInitialized(false);
        eventLogContainer = document.getElementById('network-event-log');
        if (eventLogContainer) {
            eventLogContainer.innerHTML = '';
        }
        if (structureInfoContainer) {
            structureInfoContainer.innerHTML = '';
            structureInfoContainer.style.display = 'none';
            structureInfoContainer.style.flexDirection = '';
            structureInfoContainer.style.gap = '';
        }
        applyMessageVisibility(Boolean(toggleMessages?.checked));
        applyEventLogVisibility(Boolean(toggleEventLog?.checked));
        showWaitingPlaceholder();
        updateNetworkVisibility();
        if (networkViz) {
            if (typeof networkViz.reset === 'function') {
                networkViz.reset();
            } else {
                networkViz.update({ nodes: [], edges: [], circles: [] });
            }
        }
        
        const startDiv = document.createElement('div');
        startDiv.style.cssText = 'padding: 16px; background: var(--blue-50); border-radius: 4px;';
        startDiv.innerHTML = `🔬 Starting ${simType === 'world' ? 'world' : ''} simulation...`;
        resultsDiv.appendChild(startDiv);
        
        // Update button states
        runButton.disabled = true;
        runButton.style.display = 'none';
        stopButton.style.display = 'inline-block';
        restartButton.style.display = 'none';
        
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
                    parseSimulationOutput(output, scenario, simType).catch(err => {
                        console.error('[SimUI] Failed to parse simulation output:', err);
                    });
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
                    parseSimulationOutput(output, scenario, simType).catch(err => {
                        console.error('[SimUI] Failed to parse simulation output:', err);
                    });
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
            // Reset button states
            runButton.disabled = false;
            runButton.style.display = 'inline-block';
            stopButton.style.display = 'none';
            restartButton.style.display = 'inline-block';
            currentExecutor = null;
        }
    });

    // Stop simulation
    stopButton.addEventListener('click', () => {
        if (currentExecutor) {
            currentExecutor.abort();
            resultsDiv.innerHTML += `<div style="color: orange; padding: 16px; margin-top: 8px;">⏹️ Simulation stopped by user</div>`;
        }
    });

    // Restart simulation  
    restartButton.addEventListener('click', () => {
        // Clear results and reset state
        resultsDiv.innerHTML = '';
        conversationMessages.length = 0;
        parsedMessages = [];
        resetState();
        
        // Reset button states
        runButton.style.display = 'inline-block';
        stopButton.style.display = 'none';
        restartButton.style.display = 'none';
        
        // Clear network if exists
        if (networkViz) {
            networkViz.clear();
        }
    });
}

function parseParticipantLine(line) {
    if (!line) return null;
    const trimmedLine = line.trim();
    if (!trimmedLine) return null;

    const labelRegex = /(Patient(?:s)?|Caregivers?|Doctors?):/ig;
    const segments = [];
    let match;

    while ((match = labelRegex.exec(trimmedLine)) !== null) {
        segments.push({
            label: match[1].toLowerCase(),
            index: match.index,
            length: match[0].length
        });
    }

    if (!segments.length) {
        return null;
    }

    const result = {
        patients: [],
        caregivers: [],
        doctors: []
    };

    const parseList = (raw) => {
        const cleaned = sanitizeRosterChunk(raw);
        if (!cleaned) return [];
        return cleaned
            .replace(/\band\b/gi, ',')
            .replace(/\bwith\b/gi, ',')
            .split(',')
            .map(entry => entry.trim())
            .map(entry => entry.replace(/\s+/g, ' ').trim())
            .map(entry => entry.replace(/[.]+$/g, '').trim())
            .filter(entry => entry && !/^none$/i.test(entry) && !/^\(.*\)$/.test(entry));
    };

    for (let i = 0; i < segments.length; i += 1) {
        const current = segments[i];
        const next = segments[i + 1];
        const start = current.index + current.length;
        const end = next ? next.index : trimmedLine.length;
        const value = trimmedLine.slice(start, end);
        const entries = parseList(value);
        if (!entries.length) continue;

        if (current.label.startsWith('patient')) {
            result.patients.push(...entries);
        } else if (current.label.startsWith('caregiver')) {
            result.caregivers.push(...entries);
        } else if (current.label.startsWith('doctor')) {
            result.doctors.push(...entries);
        }
    }

    if (!result.patients.length && !result.caregivers.length && !result.doctors.length) {
        return null;
    }
    return {
        patients: Array.from(new Set(result.patients)),
        caregivers: Array.from(new Set(result.caregivers)),
        doctors: Array.from(new Set(result.doctors))
    };
}

function sanitizeRosterChunk(raw = '') {
    let chunk = raw.trim();
    if (!chunk) return '';

    const turnIndex = chunk.search(/\bTurn\s+\d+\/\d+/i);
    if (turnIndex >= 0) {
        chunk = chunk.slice(0, turnIndex);
    }
    const bracketIndex = chunk.indexOf('[');
    if (bracketIndex >= 0) {
        chunk = chunk.slice(0, bracketIndex);
    }
    return chunk.replace(/\s+/g, ' ').trim();
}

function mergeRosterIntoProvisional(roster) {
    if (!roster) return false;
    let added = false;
    (roster.patients || []).forEach(name => {
        if (addProvisionalParticipant('patient', name)) {
            added = true;
        }
    });
    (roster.caregivers || []).forEach(name => {
        if (addProvisionalParticipant('caregiver', name)) {
            added = true;
        }
    });
    (roster.doctors || []).forEach(name => {
        if (addProvisionalParticipant('doctor', name)) {
            added = true;
        }
    });
    return added;
}

function recordProvisionalUpdate(added) {
    if (!added) return;
    const rosterSnapshot = getProvisionalRoster();
    lastProvisionalCount = rosterSnapshot.patients.length + rosterSnapshot.caregivers.length + rosterSnapshot.doctors.length;
    provisionalBootstrapAttempted = false;
}

function updatePlaceholderWithRosterSummary() {
    const totals = getProvisionalTotals();
    const parts = [];
    if (totals.patients) {
        parts.push(`${totals.patients} patient${totals.patients === 1 ? '' : 's'}`);
    }
    if (totals.caregivers) {
        parts.push(`${totals.caregivers} caregiver${totals.caregivers === 1 ? '' : 's'}`);
    }
    if (totals.doctors) {
        parts.push(`${totals.doctors} doctor${totals.doctors === 1 ? '' : 's'}`);
    }
    const summary = parts.length ? parts.join(' • ') : 'collecting roster…';
    setWaitingPlaceholderMessage(`Waiting for CLI participants… ${summary}`);
}

function captureProvisionalParticipants(line) {
    if (!line) return false;
    let updated = false;
    let touched = false;

    const roster = parseParticipantLine(line);
    if (roster) {
        touched = true;
        updated = mergeRosterIntoProvisional(roster) || updated;
    }

    const roleLineMatch = line.match(/^(PATIENT|CAREGIVER|DOCTOR)\s*\(([^)]+)\)/i);
    if (roleLineMatch) {
        const role = roleLineMatch[1].toLowerCase();
        const name = roleLineMatch[2].trim();
        if (addProvisionalParticipant(role, name)) {
            updated = true;
        }
        touched = true;
    }

    const simpleRoleMatch = line.match(/^(PATIENT|CAREGIVER|DOCTOR):\s*([^:[\]]+)/i);
    if (simpleRoleMatch) {
        const role = simpleRoleMatch[1].toLowerCase();
        const name = simpleRoleMatch[2].trim();
        if (addProvisionalParticipant(role, name)) {
            updated = true;
        }
        touched = true;
    }

    const handlerBroadcastMatch = line.match(/\bDoctor\s+'([^']+)'/i);
    if (handlerBroadcastMatch) {
        if (addProvisionalParticipant('doctor', handlerBroadcastMatch[1].trim())) {
            updated = true;
        }
        touched = true;
    }

    if (!areParticipantsReady() && touched) {
        incrementProvisionalFragmentCount();
    }

    if (updated) {
        recordProvisionalUpdate(true);
    }

    if (!areParticipantsReady() && touched) {
        updatePlaceholderWithRosterSummary();
    }
    return updated;
}

async function maybeBootstrapNetworkFromProvisional(simType) {
    if (provisionalBootstrapAttempted) {
        return false;
    }
    const roster = getProvisionalRoster();
    const totals = getProvisionalTotals();
    const totalNew = totals.patients + totals.caregivers + totals.doctors;
    const participantsReady = areParticipantsReady();
    const existingParticipants = getState().participants.length;
    if (!totalNew && !existingParticipants) {
        return false;
    }
    if (!Array.isArray(roster.patients) || roster.patients.length === 0) {
        return false;
    }
    const fragments = getProvisionalFragmentCount();
    const hasNewNonPatient = totals.caregivers > 0 || totals.doctors > 0;
    if (!participantsReady) {
        if (!hasNewNonPatient && totalNew <= 1 && fragments < 3) {
            return false;
        }
    } else if (!hasNewNonPatient) {
        return false;
    }

    const message = hasNewNonPatient || totalNew > 1
        ? 'Building visualization from active CLI dialogue…'
        : 'Preparing visualization from first CLI participant…';
    if (!isNetworkInitialized()) {
        showWaitingPlaceholder(message);
    }

    provisionalBootstrapAttempted = true;
    try {
        await buildNetworkFromParticipants(roster, simType, { force: true });
        console.info('[SimUI] Bootstrapped network from provisional participants:', roster);
        return true;
    } catch (error) {
        console.warn('[SimUI] Failed to bootstrap network from provisional participants:', error);
        provisionalBootstrapAttempted = false;
        return false;
    }
}

async function buildNetworkFromParticipants(roster, simType, { force = false } = {}) {
    if (!roster) return;
    if (areParticipantsReady() && !force && !hasProvisionalParticipants()) {
        return;
    }
    await ensureComponentManifest(!companionManifest && !companionComponentsPromise);

    if (!networkViz) {
        networkViz = new NetworkVisualization('network-canvas');
    }
    if (!networkViz.svg) {
        networkViz.init();
    }

    const participants = [];
    const usedUsernames = new Set();
    const colors = ['#1a73e8', '#ea4335', '#34a853', '#fbbc04', '#9c27b0', '#ff6d01', '#00acc1', '#7cb342'];

    const createParticipant = (displayName, role) => {
        const base = displayName || `${role}_${participants.length + 1}`;
        let candidate = normalizeName(base) || `${role}_${participants.length + 1}`;
        if (!candidate) candidate = `${role}_${participants.length + 1}`;
        let finalUsername = candidate;
        let suffix = 2;
        while (usedUsernames.has(finalUsername)) {
            finalUsername = `${candidate}_${suffix++}`;
        }
        usedUsernames.add(finalUsername);
        return {
            username: finalUsername,
            displayName: displayName || finalUsername,
            persona: displayName || '',
            role,
            aliases: [displayName, finalUsername].filter(Boolean)
        };
    };

    roster.patients.forEach(name => participants.push(createParticipant(name, 'patient')));
    roster.caregivers.forEach(name => participants.push(createParticipant(name, 'caregiver')));
    roster.doctors.forEach(name => participants.push(createParticipant(name, 'doctor')));

    if (!participants.length) return;

    setParticipants(participants.map(p => ({
        username: p.username,
        persona: p.persona,
        role: p.role,
        displayName: p.displayName,
        aliases: p.aliases
    })));
    participants.forEach(registerParticipant);
    clearProvisionalParticipants();

    const nodes = [];
    const edges = [];
    const privacyCircles = [];
    const careCircles = [];
    const edgeSet = new Set();
    const addEdge = (source, target, kind) => {
        if (!source || !target) return;
        const key = `${source}__${target}`;
        if (edgeSet.has(key)) return;
        edgeSet.add(key);
        edges.push({ source, target, kind });
    };

    const userColors = {};
    participants.forEach((participant, index) => {
        const color = colors[index % colors.length];
        userColors[participant.username] = color;
        userColorMap[participant.username] = color;
    });

    const companionHandlers = (companionManifest?.companion?.handlers || []).map(item => ({ ...item }));
    const companionAgents = (companionManifest?.companion?.agents || []).map(item => ({ ...item }));

    participants.forEach((participant) => {
        const username = participant.username;
        const color = userColorMap[username];

        nodes.push({
            id: `user_${username}`,
            type: 'user',
            label: participant.displayName || username,
            username,
            color,
            circleIds: []
        });

        const coordinatorId = makeCompanionNodeId('coordinator', 'companionCoordinator', username);
        nodes.push({
            id: coordinatorId,
            type: 'companion_coordinator',
            label: 'Companion Coordinator',
            username,
            color
        });
        addEdge(`user_${username}`, coordinatorId, 'user_to_coordinator');
        addEdge(coordinatorId, `user_${username}`, 'coordinator_to_user');

        const handlerIds = companionHandlers.map(component => {
            const nodeId = makeCompanionNodeId('handler', component.id, username);
            nodes.push({
                id: nodeId,
                type: 'companion_handler',
                label: component.label,
                username,
                color,
                componentId: component.id
            });
            addEdge(coordinatorId, nodeId, 'coordinator_to_handler');
            addEdge(nodeId, coordinatorId, 'handler_to_coordinator');
            return nodeId;
        });

        const agentIds = companionAgents.map(component => {
            const nodeId = makeCompanionNodeId('agent', component.id, username);
            nodes.push({
                id: nodeId,
                type: 'companion_agent',
                label: component.label,
                username,
                color,
                componentId: component.id
            });
            addEdge(coordinatorId, nodeId, 'coordinator_to_agent');
            addEdge(nodeId, coordinatorId, 'agent_to_coordinator');
            return nodeId;
        });

        privacyCircles.push({
            id: `privacy_${username}`,
            username,
            nodeIds: [`user_${username}`, coordinatorId, ...handlerIds, ...agentIds],
            color
        });

        setLastSpeaker(participant.role, username);
    });

    if (!nodes.find(node => node.id === 'orchestrator')) {
        nodes.push({
            id: 'orchestrator',
            type: 'orchestrator',
            label: 'Orchestrator',
            color: '#5f6368'
        });
    }

    participants.forEach(participant => {
        const coordinatorId = makeCompanionNodeId('coordinator', 'companionCoordinator', participant.username);
        addEdge('orchestrator', coordinatorId, 'orchestrator_to_coordinator');
        addEdge(coordinatorId, 'orchestrator', 'coordinator_to_orchestrator');
    });

    const circleName = currentCircleName || (simType === 'world' ? 'Simulation Circle' : 'Simulation Circle');
    const circleId = normalizeName(circleName || 'simulation_circle');
    const memberUsernames = participants.map(p => p.username);
    recordCircleMembership(circleId, circleName, memberUsernames);

    careCircles.push({
        id: circleId,
        name: circleName,
        patientId: participants.find(p => p.role === 'patient')?.username || memberUsernames[0],
        members: participants.map(p => ({
            username: p.username,
            role: p.role,
            persona: p.persona
        })),
        color: userColorMap[memberUsernames[0]] || '#1a73e8'
    });

    if (networkViz) {
        networkViz.update({ nodes, edges, careCircles, privacyCircles, userColors: userColorMap });
    }
    renderCareCircleLegend(careCircles, userColorMap);
    renderNetworkStructureInfo(careCircles, nodes, userColorMap);
    hideWaitingPlaceholder();
    setNetworkInitialized(true);
    updateNetworkVisibility();

    const bufferedLines = flushPendingLines();
    if (bufferedLines.length) {
        await parseSimulationOutput(bufferedLines.join('\n'), activeScenarioKey, simType);
    }
}

async function parseSimulationOutput(output, scenarioKey, simType) {
    if (!output) return;

    const lines = output.split('\n');

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        captureProvisionalParticipants(line);

        if (await handleParticipantLine(line, simType)) {
            continue;
        }
        if (handleMetadataLine(line)) {
            continue;
        }
        if (handleConversationStart(line)) {
            continue;
        }

        if (!areParticipantsReady()) {
            enqueuePendingLine(line);
            showWaitingPlaceholder();
            const compactLine = line.replace(/\s+/g, ' ').trim();
            const snippet = compactLine.length > 80 ? `${compactLine.slice(0, 77)}…` : compactLine;
            setWaitingPlaceholderMessage(`Waiting for CLI participants… buffering CLI output (latest): "${snippet}"`);
            await maybeBootstrapNetworkFromProvisional(simType);
            continue;
        }

        if (hasProvisionalParticipants()) {
            await maybeBootstrapNetworkFromProvisional(simType);
        }

        if (handleOrchestratorLine(line)) {
            continue;
        }
        if (handleRescheduleLine(line)) {
            continue;
        }
        if (handleRoleMessage(line)) {
            continue;
        }
        if (handleAgentMessage(line)) {
            continue;
        }
        if (handleSimpleRoleMessage(line)) {
            continue;
        }
        handleReporterFlag(line);
    }
}

async function handleParticipantLine(line, simType) {
    const rosterFragment = parseParticipantLine(line);
    if (!rosterFragment) return false;

    if (!areParticipantsReady()) {
        incrementProvisionalFragmentCount();
    }

    const added = mergeRosterIntoProvisional(rosterFragment);
    recordProvisionalUpdate(added);

    const aggregatedRoster = getProvisionalRoster();
    const totals = getProvisionalTotals();
    const totalParticipants = totals.patients + totals.caregivers + totals.doctors;
    const fragments = getProvisionalFragmentCount();
    const hasDiversity = totals.patients > 0 && (totals.caregivers > 0 || totals.doctors > 0);

    if (!hasDiversity && totalParticipants <= 1 && fragments < 3) {
        updatePlaceholderWithRosterSummary();
        return true;
    }

    console.info('[SimUI] Participants detected from CLI roster (aggregated):', aggregatedRoster);
    updatePlaceholderWithRosterSummary();
    showWaitingPlaceholder('Received CLI participants… building visualization');
    await buildNetworkFromParticipants(aggregatedRoster, simType, { force: true });
    return true;
}

function handleMetadataLine(line) {
    if (line.startsWith('🧪 SIMULATION:')) return true;
    if (line.startsWith('📋 Scenario:')) return true;
    if (/^Random scenario selected:/i.test(line)) return true;
    return false;
}

function handleConversationStart(line) {
    if (!line.includes('Starting conversation for circle')) return false;
    const circleName = line.split(':').slice(1).join(':').trim();
    currentCircleName = circleName;
    logSimulationEvent('circle', {
        circle: currentCircleName,
        actor: 'Conversation start',
        message: line
    });
    const circleId = resolveCircleId(currentCircleName) || null;
    if (circleId) {
        networkViz?.highlightCircle(circleId);
    }
    return true;
}

function handleOrchestratorLine(line) {
    if (!line.startsWith('[Orchestrator]')) return false;
    const messageText = line.replace('[Orchestrator] ', '');
    const orchestratorColor = '#5f6368';
    const isFuturePlan = messageText.startsWith('Future plan executed');
    const actionType = isFuturePlan
        ? 'future_plan'
        : messageText.toLowerCase().includes('escalat') ? 'escalation' : 'info';

    logSimulationEvent('orchestrator', {
        circle: currentCircleName,
        actor: isFuturePlan ? 'Future plan' : 'Orchestrator',
        message: messageText,
        color: orchestratorColor
    });
    const circleKey = normalizeName(currentCircleName || '');
    const circleId = resolveCircleId(currentCircleName) || resolveCircleId(circleKey);
    const members = circleId ? getState().circleMembers.get(circleId) : null;
    const targets = members || [];
    networkViz?.animateOrchestratorAction({
        targetUsers: targets,
        message: messageText,
        actionType,
        circleName: currentCircleName || circleKey
    });
    if (circleId && isFuturePlan) {
        networkViz?.highlightCircle(circleId, '#ea4335');
    }
    return true;
}

function handleRescheduleLine(line) {
    if (!line.startsWith('[RescheduleHandler]')) return false;
    logSimulationEvent('reschedule', {
        circle: currentCircleName,
        actor: 'Schedule update',
        message: line.replace('[RescheduleHandler] ', '')
    });
    return true;
}

function handleRoleMessage(line) {
    const personaMatch = line.match(/^(PATIENT|CAREGIVER|DOCTOR|USER)\s*\(([^)]+)\):\s*(.+)$/i);
    if (!personaMatch) return false;
    
    // Don't process messages if participants aren't ready
    if (!areParticipantsReady()) return false;
    
    const roleRaw = personaMatch[1].toLowerCase();
    const personaName = personaMatch[2].trim();
    const message = personaMatch[3].trim();
    const userId = resolveUserId(personaName, roleRaw);

    if (userId && message) {
        setLastSpeaker(roleRaw, userId);
        lastRoleSpoken = roleRaw;
        parsedMessages.push({ role: roleRaw, userId, message, timestamp: Date.now() });
        animateMessageFlow(roleRaw, userId, message);
    }
    return true;
}

function handleAgentMessage(line) {
    const agentMatch = line.match(/^(PATIENT_AGENT|CAREGIVER_AGENT|DOCTOR_AGENT|COMPANION_AGENT|AGENT):\s*(.+)$/i);
    if (!agentMatch) return false;
    
    // Don't process messages if participants aren't ready
    if (!areParticipantsReady()) return false;
    
    const agentRoleRaw = agentMatch[1].toLowerCase();
    const message = agentMatch[2].trim();
    let baseRole = agentRoleRaw.replace('_agent', '');

    if (!baseRole || baseRole === 'agent' || baseRole === 'companion') {
        baseRole = lastRoleSpoken || 'patient';
    }

    const userId = getLastSpeaker(baseRole);
    if (userId && message) {
        parsedMessages.push({
            role: `${baseRole}_agent`,
            userId,
            message,
            timestamp: Date.now()
        });
        animateMessageFlow('agent', userId, message, { componentId: `${baseRole}_agent` });
    }
    return true;
}

function handleSimpleRoleMessage(line) {
    const simpleMatch = line.match(/^(PATIENT|CAREGIVER|DOCTOR|USER|COMPANION):\s*(.+)$/i);
    if (!simpleMatch) return false;
    
    // Don't process messages if participants aren't ready
    if (!areParticipantsReady()) return false;
    
    const roleRaw = simpleMatch[1].toLowerCase();
    const message = simpleMatch[2].trim();
    const userId = getLastSpeaker(roleRaw) || (lastRoleSpoken ? getLastSpeaker(lastRoleSpoken) : null);

    if (userId && message) {
        parsedMessages.push({ role: roleRaw, userId, message, timestamp: Date.now() });
        animateMessageFlow(roleRaw, userId, message);
    }
    return true;
}

function handleReporterFlag(line) {
    const flaggedMatch = line.match(/\[SimulationReporter\]\[Message Flagged\]\s+([^:]+):/);
    if (!flaggedMatch) return false;
    const key = normalizeName(flaggedMatch[1] || 'flagged');
    simulationInsightCounts[key] = (simulationInsightCounts[key] || 0) + 1;
    return true;
}

/**
 * Initialize network visualization from scenario
 * Builds privacy circles (user + agentic framework) and care circles
 */
function initializeNetworkVisualization(scenarioKey) {
    if (!networkViz || !scenarioKey) return;

    ensureComponentManifest(!companionManifest).then(() => {
        return window.api.getScenarios();
    }).then(data => {
        const scenario = data.scenarios[scenarioKey];
        if (!scenario) return;
        activeScenarioKey = scenarioKey;
        buildScenarioLookup(data);
        
        const nodes = [];
        const edges = [];
        const careCircles = [];
        const privacyCircles = [];
        const userColors = {};
        const personas = data.personas || {};
        const companionHandlers = (companionManifest?.companion?.handlers || []).map(item => ({ ...item }));
        const companionAgents = (companionManifest?.companion?.agents || []).map(item => ({ ...item }));
        const edgeSet = new Set();
        const addEdge = (source, target, kind) => {
            if (!source || !target) return;
            const key = `${source}__${target}`;
            if (edgeSet.has(key)) return;
            edgeSet.add(key);
            edges.push({ source, target, kind });
        };

        const rawUsers = Array.isArray(scenario.users) ? scenario.users.filter(Boolean) : [];
        const usedUsernames = new Set();
        const processedUsers = rawUsers.map((user, idx) => {
            const baseName = user.username || user.userId || user.name || user.personaKey || `${user.role || 'participant'}_${idx + 1}`;
            const normalizedBase = normalizeName(String(baseName || 'participant')) || `participant_${idx + 1}`;
            let candidate = (baseName || `participant_${idx + 1}`).toString().trim() || `participant_${idx + 1}`;
            if (!candidate) {
                candidate = `participant_${idx + 1}`;
            }
            let finalName = candidate;
            let suffix = 2;
            while (usedUsernames.has(finalName)) {
                finalName = `${candidate}_${suffix++}`;
            }
            usedUsernames.add(finalName);
            return {
                ...user,
                username: finalName,
                role: (user.role || '').toLowerCase(),
                personaKey: user.persona || user.personaKey || null,
                displayName: user.name || user.displayName || null,
                _normalizedUsername: normalizedBase
            };
        });

        const userLookup = new Map();
        const registerLookup = (key, user) => {
            if (!key || !user) return;
            userLookup.set(String(key), user);
            userLookup.set(normalizeName(String(key)), user);
        };
        processedUsers.forEach(user => {
            registerLookup(user.username, user);
            registerLookup(user._normalizedUsername, user);
            registerLookup(user.userId, user);
            registerLookup(user.persona || user.personaKey, user);
            if (user.role) {
                registerLookup(`${user.role}_${user.persona || user.personaKey || ''}`, user);
            }
        });

        const resolveMemberUser = (member) => {
            if (!member) return null;
            if (typeof member === 'string') {
                return userLookup.get(member) || userLookup.get(normalizeName(member));
            }
            if (typeof member === 'object') {
                const candidates = [member.username, member.userId, member.persona, member.personaKey, member.name, member.id];
                for (const key of candidates) {
                    if (!key) continue;
                    const found = userLookup.get(key) || userLookup.get(normalizeName(String(key)));
                    if (found) return found;
                }
            }
            return null;
        };

        lastRoleSpoken = null;
        setParticipants(processedUsers.map(user => ({
            username: user.username,
            persona: user.personaKey || '',
            role: user.role,
            displayName: user.displayName || '',
            aliases: [user.displayName, user.personaKey, user.username].filter(Boolean)
        })));
        
        // Determine care circles
        const availableCircles = Array.isArray(scenario.circles) && scenario.circles.length
            ? scenario.circles
            : [];

        // Assign colors to users
        const colors = ['#4285F4', '#34A853', '#FBBC04', '#EA4335', '#9C27B0', '#FF6D00', '#00ACC1', '#7CB342'];
        const circleIdLookup = new Map();
        processedUsers.forEach((user, idx) => {
            userColors[user.username] = colors[idx % colors.length];
        });

        // Build care circles
        availableCircles.forEach((circle, idx) => {
            const circleId = circle.circleId || circle.id || (circle.name ? circle.name.toLowerCase().replace(/\s+/g, '_') : `circle_${idx}`);
            if (circleId) {
                circleIdLookup.set(circleId.toLowerCase(), circleId);
                circleIdLookup.set(normalizeName(circle.name || circleId || ''), circleId);
            }

            const circleMembersRaw = Array.isArray(circle.members) ? circle.members : [];
            const resolvedMemberUsers = [];
            const unresolvedMembers = [];
            circleMembersRaw.forEach(member => {
                let resolved = null;
                if (typeof member === 'string') {
                    resolved = resolveMemberUser(member);
                } else if (member && typeof member === 'object') {
                    const candidateKeys = [member.username, member.userId, member.persona, member.personaKey, member.name, member.id];
                    for (const key of candidateKeys) {
                        if (!key) continue;
                        resolved = resolveMemberUser(key);
                        if (resolved) break;
                    }
                    if (!resolved) {
                        resolved = resolveMemberUser(member);
                    }
                }
                if (resolved) {
                    resolvedMemberUsers.push(resolved);
                } else if (member) {
                    unresolvedMembers.push(member);
                }
            });

            if (unresolvedMembers.length) {
                console.warn('[SimUI] Circle members unresolved', circle.name || circleId, unresolvedMembers);
            }

            const circleMembers = resolvedMemberUsers.map(user => user.username);
            recordCircleMembership(circleId, circle.name, circleMembers);
            
            careCircles.push({
                id: circleId,
                name: circle.name || `Circle ${idx + 1}`,
                patientId: circle.primaryPatientId,
                members: resolvedMemberUsers.map(user => ({
                    username: user.username,
                    role: user.role,
                    persona: user.persona || user.personaKey
                })),
                color: colors[idx % colors.length]
            });
        });

        if (!careCircles.length && processedUsers.length) {
            const fallbackCircleId = normalizeName(scenario.name || scenarioKey || 'circle');
            const fallbackMembers = processedUsers.map(user => user.username);
            circleIdLookup.set(fallbackCircleId, fallbackCircleId);
            recordCircleMembership(fallbackCircleId, scenario.name || 'Scenario Circle', fallbackMembers);
            careCircles.push({
                id: fallbackCircleId,
                name: scenario.name || 'Scenario Circle',
                patientId: processedUsers.find(u => u.role === 'patient')?.username || fallbackMembers[0],
                members: processedUsers.map(user => ({
                    username: user.username,
                    role: user.role,
                    persona: user.persona || user.personaKey
                })),
                color: colors[0]
            });
        }

        // Create nodes for each user (privacy circle = user + agentic framework)
        processedUsers.forEach((user) => {
            const userColor = userColors[user.username];
            const username = user.username;

            // Map user to circles
            const defaultCircleIds = careCircles.map(circle => circle.id);
            const userCircles = Array.isArray(user.circles) && user.circles.length
                ? user.circles.map(c => {
                    const base = typeof c === 'string' ? c : (c.circleId || c.circleName || c.name);
                    const key = (base || '').toString();
                    const normalized = normalizeName(key);
                    return circleIdLookup.get(key.toLowerCase()) || circleIdLookup.get(normalized) || base;
                }).filter(Boolean)
                : (defaultCircleIds.length ? [defaultCircleIds[0]] : []);

            // User node
            nodes.push({
                id: `user_${username}`,
                type: 'user',
                label: username,
                username,
                color: userColor,
                circleIds: userCircles
            });

            if (user.role) {
                setLastSpeaker(user.role.toLowerCase(), username);
            }

            const personaKey = user.persona || user.personaKey;
            const personaData = personaKey ? personas[personaKey] : null;
            const personaName = personaData?.name;
            const displayNames = [username, personaName];

            if (personaName) {
                const firstName = personaName.split(' ')[0];
                displayNames.push(firstName);
            }

            registerParticipant({
                username,
                persona: personaName || user.personaKey || '',
                displayName: personaName || user.displayName || username,
                role: user.role,
                aliases: displayNames.filter(Boolean)
            });
            
            const coordinatorId = makeCompanionNodeId('coordinator', 'companionCoordinator', username);
            nodes.push({
                id: coordinatorId,
                type: 'companion_coordinator',
                label: 'Companion Coordinator',
                username,
                color: userColor
            });

            addEdge(`user_${username}`, coordinatorId, 'user_to_coordinator');
            addEdge(coordinatorId, `user_${username}`, 'coordinator_to_user');

            const handlerNodeIds = companionHandlers.map((component) => {
                const nodeId = makeCompanionNodeId('handler', component.id, username);
                nodes.push({
                    id: nodeId,
                    type: 'companion_handler',
                    label: component.label,
                    username,
                    color: userColor,
                    componentId: component.id
                });
                addEdge(coordinatorId, nodeId, 'coordinator_to_handler');
                addEdge(nodeId, coordinatorId, 'handler_to_coordinator');
                addEdge(`user_${username}`, nodeId, 'user_to_handler');
                return nodeId;
            });

            const agentNodeIds = companionAgents.map((component) => {
                const nodeId = makeCompanionNodeId('agent', component.id, username);
                nodes.push({
                    id: nodeId,
                    type: 'companion_agent',
                    label: component.label,
                    username,
                    color: userColor,
                    componentId: component.id
                });
                addEdge(coordinatorId, nodeId, 'coordinator_to_agent');
                addEdge(nodeId, coordinatorId, 'agent_to_coordinator');
                return nodeId;
            });

            const companionNodes = [coordinatorId, ...handlerNodeIds, ...agentNodeIds];

            privacyCircles.push({
                id: `privacy_${username}`,
                username,
                nodeIds: [
                    `user_${username}`,
                    ...companionNodes
                ],
                color: userColor
            });
            addEdge('orchestrator', coordinatorId, 'orchestrator_to_coordinator');
            addEdge(coordinatorId, 'orchestrator', 'coordinator_to_orchestrator');
        });

        // Add orchestrator node (sits between privacy circles)
        nodes.push({
            id: 'orchestrator',
            type: 'orchestrator',
            label: 'Orchestrator',
            color: '#666'
        });

        // Orchestrator sits outside privacy circles; shading not applied
        userColorMap = { ...userColors };
        
        networkViz.update({ nodes, edges, careCircles, privacyCircles, userColors });
        renderCareCircleLegend(careCircles, userColors);
        renderNetworkStructureInfo(careCircles, nodes, userColors);
        setNetworkInitialized(true);
        updateNetworkVisibility();
    }).catch(err => {
        console.error('[SimUI] Failed to load scenario for network:', err);
    });
}

/**
 * Animate message flow between nodes
 */
function animateMessageFlow(role, userId, message, options = {}) {
    if (!networkViz || !userId) return;

    const normalizedRole = role.toLowerCase();
    const baseId = userId;
    const isAgent = normalizedRole.includes('agent') || normalizedRole === 'companion';
    const coordinatorId = networkViz.getCoordinatorNodeId?.(baseId);
    const defaultAgentTarget = coordinatorId || `agent_${baseId}`;
    const fromNodeId = isAgent ? (coordinatorId || `agent_${baseId}`) : `user_${baseId}`;
    const toNodeId = isAgent ? `user_${baseId}` : defaultAgentTarget;
    const color = networkViz.getUserColor?.(baseId) || '#1a73e8';
    const actorLabel = baseId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const eventType = isAgent
        ? 'agent'
        : normalizedRole.includes('doctor')
            ? 'doctor'
            : normalizedRole.includes('caregiver')
                ? 'caregiver'
                : normalizedRole.includes('patient')
                    ? 'patient'
                    : 'user';
    const componentId = options?.componentId || null;
    const direction = isAgent ? 'agent_to_user' : options?.direction || 'user_to_agent';

    networkViz.animateMessage(fromNodeId, toNodeId, message.substring(0, 280), {
        role: normalizedRole,
        userId: baseId,
        username: baseId,
        componentId: isAgent ? (componentId || 'companionCoordinator') : componentId,
        direction,
        counterpart: isAgent ? `user_${baseId}` : networkViz.getCoordinatorNodeId?.(baseId)
    });
    if (isAgent) {
        networkViz.highlightAgent(baseId);
        logSimulationEvent('agent', {
            circle: currentCircleName,
            actor: `${actorLabel} Companion`,
            message,
            color
        });
    } else {
        networkViz.highlightUser(baseId);
        const circlesForUser = getState().userCircleMap.get(baseId);
        if (Array.isArray(circlesForUser)) {
            circlesForUser.forEach(circleId => networkViz.highlightCircle(circleId));
        }
        logSimulationEvent(eventType, {
            circle: currentCircleName,
            actor: actorLabel,
            message,
            color
        });
    }
}

function resolveUserId(name, role = '') {
    if (!name) {
        return role ? getLastSpeaker(role) || null : null;
    }
    const username = resolveUsernameByPersona(name);
    if (username) {
        return username;
    }
    const normalized = normalizeKey(name);
    if (normalized) {
        const resolved = resolveUsernameByPersona(normalized);
        if (resolved) return resolved;
    }
    return role ? getLastSpeaker(role) || null : null;
}

function normalizeName(value = '') {
    return normalizeKey(value);
}

function encodeSegment(value = '') {
    return encodeURIComponent(value);
}

function makeCompanionNodeId(kind, componentId, username) {
    return `companion_${kind}_${encodeSegment(componentId)}__${encodeSegment(username)}`;
}

function showWaitingPlaceholder(message = 'Waiting for CLI participants…') {
    if (!networkPlaceholder) return;
    networkPlaceholderBaseMessage = message;
    if (!networkPlaceholder.classList.contains('visible')) {
        networkPlaceholder.classList.add('visible');
        networkPlaceholderStart = Date.now();
        if (networkPlaceholderTimer) {
            clearInterval(networkPlaceholderTimer);
        }
        networkPlaceholderTimer = setInterval(updateWaitingPlaceholderElapsed, 1000);
    }
    updateWaitingPlaceholderElapsed();
}

function setWaitingPlaceholderMessage(message) {
    networkPlaceholderBaseMessage = message;
    updateWaitingPlaceholderElapsed();
}

function updateWaitingPlaceholderElapsed() {
    if (!networkPlaceholder || !networkPlaceholder.classList.contains('visible')) return;
    if (!networkPlaceholderText) return;
    if (!networkPlaceholderStart) {
        networkPlaceholderText.textContent = networkPlaceholderBaseMessage;
        return;
    }
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - networkPlaceholderStart) / 1000));
    const elapsedText = elapsedSeconds > 0 ? ` (${formatElapsed(elapsedSeconds)})` : '';
    networkPlaceholderText.textContent = `${networkPlaceholderBaseMessage}${elapsedText}`;
}

function hideWaitingPlaceholder() {
    if (!networkPlaceholder) return;
    if (networkPlaceholderTimer) {
        clearInterval(networkPlaceholderTimer);
        networkPlaceholderTimer = null;
    }
    networkPlaceholderStart = null;
    networkPlaceholder.classList.remove('visible');
    networkPlaceholderBaseMessage = 'Waiting for CLI participants…';
    if (networkPlaceholderText) {
        networkPlaceholderText.textContent = networkPlaceholderBaseMessage;
    }
}

function formatElapsed(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
        return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
}

function renderCareCircleLegend(careCircles = [], userColors = {}) {
    const legend = document.getElementById('care-circle-legend');
    if (!legend) return;

    const escape = (value = '') => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    if (!Array.isArray(careCircles) || careCircles.length === 0) {
        legend.style.display = 'none';
        legend.innerHTML = '';
        return;
    }

    const cards = careCircles.map((circle) => {
        const members = Array.isArray(circle.members) ? circle.members : [];
        const uniqueUsernames = [...new Set(members.map(member => {
            if (typeof member === 'string') return member;
            if (member && typeof member === 'object') {
                return member.username || member.name || member.id || '';
            }
            return '';
        }).filter(Boolean))];

        const chips = uniqueUsernames.map((username) => {
            const chipColor = userColors[username] || '#5f6368';
            return `<span style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; background:${chipColor}1a; color:${chipColor}; font-size:12px; font-weight:500;">● <span>${escape(username)}</span></span>`;
        }).join(' ');

        const title = escape(circle.name || circle.id || 'Care Circle');
        return `
            <div style="flex:1 1 220px; min-width:200px; border:1px solid #e0e0e0; border-radius:10px; padding:12px 14px; background:#fafafa; display:flex; flex-direction:column; gap:8px;">
                <div style="font-weight:600; color:#202124; font-size:13px;">${title}</div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">${chips || '<span style="font-size:12px; color:#5f6368;">No members</span>'}</div>
            </div>
        `;
    }).join('');

    legend.style.display = 'flex';
    legend.style.flexWrap = 'wrap';
    legend.innerHTML = cards;
}

function renderNetworkStructureInfo(careCircles = [], nodes = [], userColors = {}) {
    if (!structureInfoContainer) return;
 
    const escapeHtml = (value = '') => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
 
    if (!Array.isArray(careCircles) || !careCircles.length) {
        structureInfoContainer.innerHTML = '';
        structureInfoContainer.style.display = 'none';
        structureInfoContainer.style.flexDirection = '';
        structureInfoContainer.style.gap = '';
        return;
    }
 
    structureInfoContainer.style.display = 'flex';
    structureInfoContainer.style.flexDirection = 'column';
    structureInfoContainer.style.gap = '12px';
 
    const pill = (label, color = '#4285F4') => `
        <span style="
            display:inline-flex;
            align-items:center;
            padding:2px 8px;
            border-radius:999px;
            background:${color}1a;
            color:${color};
            font-size:11px;
            font-weight:600;
        ">${escapeHtml(label)}</span>
    `;
 
    const renderMember = (member) => {
        if (!member) return '';
        const username = member.username || 'participant';
        const color = userColors[username] || '#5f6368';
        const roleLabel = member.role ? member.role.replace(/_/g, ' ') : 'participant';
        const personaLabel = member.persona ? ` · ${member.persona.replace(/_/g, ' ')}` : '';
        return `
            <div style="display:flex; align-items:center; gap:6px; font-size:11px; color:var(--gray-700);">
                ${pill(username, color)}
                <span>${escapeHtml(roleLabel)}${escapeHtml(personaLabel)}</span>
            </div>
        `;
    };
 
    const circleSections = careCircles.map(circle => {
        const members = Array.isArray(circle.members) ? circle.members : [];
        const memberRows = members.map(renderMember).filter(Boolean).join('') ||
            `<div style="font-size:11px; color:var(--gray-600);">No members listed.</div>`;
        return `
            <div style="display:flex; flex-direction:column; gap:6px;">
                <div style="font-weight:600; color:var(--gray-800);">${escapeHtml(circle.name || circle.id)}</div>
                <div style="display:flex; flex-direction:column; gap:4px; padding-left:8px;">
                    ${memberRows}
                </div>
            </div>
        `;
    }).join('');
 
    structureInfoContainer.innerHTML = `
        <div style="font-weight:600; color:var(--gray-700);">Care circle membership</div>
        <div style="display:flex; flex-direction:column; gap:12px;">
            ${circleSections}
        </div>
    `;
}

function ensureComponentManifest(forceRefresh = false) {
    if (forceRefresh) {
        companionManifest = null;
        companionComponentsPromise = null;
    }
    if (companionManifest) {
        return Promise.resolve(companionManifest);
    }
    if (companionComponentsPromise) {
        return companionComponentsPromise;
    }
    companionComponentsPromise = window.api.getCompanionComponents({ refresh: forceRefresh }).then((data) => {
        companionManifest = data || { companion: { handlers: [], agents: [], prompts: [] } };
        return companionManifest;
    }).catch((error) => {
        console.error('[SimUI] Failed to load companion components:', error);
        companionManifest = { companion: { handlers: [], agents: [], prompts: [] } };
        return companionManifest;
    });
    return companionComponentsPromise;
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
        patient: '🧑',
        caregiver: '🧑‍🤝‍🧑',
        doctor: '🩺',
        agent: '🤖',
        orchestrator: '🛠️',
        reschedule: '♻️',
        circle: '🟢'
    };

    const badgeColor = {
        user: '#1a73e8',
        patient: '#1a73e8',
        caregiver: '#34a853',
        doctor: '#fbbc04',
        agent: '#9c27b0',
        orchestrator: '#ea4335',
        reschedule: '#fbbc04',
        circle: '#34a853'
    };

    const icon = iconMap[type] || 'ℹ️';
    const accent = payload?.color || badgeColor[type] || '#5f6368';

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
        buildScenarioLookup(data);
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
        buildScenarioLookup(data);
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
