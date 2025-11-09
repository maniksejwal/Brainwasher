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
let circleMembersMap = {};
let companionComponentsPromise = null;
let companionManifest = null;
let showNetworkToggle = null;
let networkContainerRef = null;
let updateNetworkVisibility = () => {};
let structureInfoContainer = null;
let userColorMap = {};
let scenarioLookupByName = {};
let activeScenarioKey = null;

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
    updateNetworkVisibility = () => {
        if (!networkContainerRef) return;
        const shouldShow = showNetworkToggle?.checked && networkInitialized;
        networkContainerRef.style.display = shouldShow ? 'block' : 'none';
        if (structureInfoContainer) {
            structureInfoContainer.style.display = shouldShow && structureInfoContainer.innerHTML ? 'flex' : 'none';
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
        if (structureInfoContainer) {
            structureInfoContainer.innerHTML = '';
            structureInfoContainer.style.display = 'none';
            structureInfoContainer.style.flexDirection = '';
            structureInfoContainer.style.gap = '';
        }
        applyMessageVisibility(Boolean(toggleMessages?.checked));
        applyEventLogVisibility(Boolean(toggleEventLog?.checked));
        if (networkContainerRef) {
            networkContainerRef.style.display = 'none';
        }
        if (networkViz) {
            networkViz.update({ nodes: [], edges: [], circles: [] });
        }
        
        const startDiv = document.createElement('div');
        startDiv.style.cssText = 'padding: 16px; background: var(--blue-50); border-radius: 4px;';
        startDiv.innerHTML = `🔬 Starting ${simType === 'world' ? 'world' : ''} simulation...`;
        resultsDiv.appendChild(startDiv);
        
        if (showNetworkToggle?.checked && scenario && scenario !== 'random') {
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
function tryInitializeNetworkByName(scenarioName) {
    if (networkInitialized) return;
    const key = scenarioLookupByName[scenarioName] || scenarioLookupByName[normalizeName(scenarioName || '')];
    if (key && showNetworkToggle?.checked) {
        initializeNetworkVisualization(key);
    }
}

function parseSimulationOutput(output, scenarioKey, simType) {
    if (!output) return;

    // Initialize network visualization for both regular and world simulations
    if (!networkInitialized && scenarioKey && scenarioKey !== 'random' && showNetworkToggle?.checked) {
        initializeNetworkVisualization(scenarioKey);
    }

    const lines = output.split('\n');

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (!networkInitialized && showNetworkToggle?.checked) {
            if (line.startsWith('🧪 SIMULATION:')) {
                const scenarioName = line.replace('🧪 SIMULATION:', '').trim();
                tryInitializeNetworkByName(scenarioName);
                continue;
            }
            if (line.startsWith('📋 Scenario:')) {
                const scenarioName = line.replace('📋 Scenario:', '').trim();
                tryInitializeNetworkByName(scenarioName);
                continue;
            }
            if (/^Random scenario selected:/i.test(line)) {
                const scenarioName = line.replace(/^Random scenario selected:/i, '').trim();
                tryInitializeNetworkByName(scenarioName);
                continue;
            }
        }

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
            const messageText = line.replace('[Orchestrator] ', '');
            const orchestratorColor = '#5f6368';
            logSimulationEvent('orchestrator', {
                circle: currentCircleName,
                actor: 'Future plan',
                message: messageText,
                color: orchestratorColor
            });
            const circleKey = normalizeName(currentCircleName || '');
            const targets = circleMembersMap[circleKey] || [];
            networkViz?.animateOrchestratorAction({
                targetUsers: targets,
                message: messageText,
                actionType: 'future_plan',
                circleName: currentCircleName || circleKey
            });
            const circleId = circleNameToId[currentCircleName?.toLowerCase?.()] || null;
            if (circleId) {
                networkViz?.highlightCircle(circleId, '#ea4335');
            }
            continue;
        }
        else if (line.startsWith('[Orchestrator]')) {
            const messageText = line.replace('[Orchestrator] ', '');
            const orchestratorColor = '#5f6368';
            logSimulationEvent('orchestrator', {
                circle: currentCircleName,
                actor: 'Orchestrator',
                message: messageText,
                color: orchestratorColor
            });
            const circleKey = normalizeName(currentCircleName || '');
            const targets = circleMembersMap[circleKey] || [];
            networkViz?.animateOrchestratorAction({
                targetUsers: targets,
                message: messageText,
                actionType: messageText.toLowerCase().includes('escalat') ? 'escalation' : 'info',
                circleName: currentCircleName || circleKey
            });
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
                animateMessageFlow('agent', userId, message, { componentId: `${baseRole}_agent` });
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

        personaNameToUserId = {};
        lastSpeakerByRole = {};
        lastRoleSpoken = null;
        circleNameToId = {};
        userCircleMap = {};
        circleMembersMap = {};
        
        // Determine care circles
        const availableCircles = Array.isArray(scenario.circles) && scenario.circles.length
            ? scenario.circles
            : [{
                name: scenario.name || scenarioKey,
                primaryPatientId: scenario.users?.find(u => u.role === 'patient')?.username || scenario.users?.[0]?.username || scenarioKey,
                members: scenario.users?.map(user => user.username) || []
            }];

        // Assign colors to users
        const colors = ['#4285F4', '#34A853', '#FBBC04', '#EA4335', '#9C27B0', '#FF6D00', '#00ACC1', '#7CB342'];
        scenario.users?.forEach((user, idx) => {
            userColors[user.username] = colors[idx % colors.length];
        });

        // Build care circles
        availableCircles.forEach((circle, idx) => {
            const circleId = circle.circleId || circle.id || (circle.name ? circle.name.toLowerCase().replace(/\s+/g, '_') : `circle_${idx}`);
            if (circleId) {
                circleNameToId[circleId.toLowerCase()] = circleId;
            }
            circleNameToId[(circle.name || circleId || '').toLowerCase()] = circleId;
            const circleMembers = (circle.members || []).map(member => typeof member === 'string' ? member : member.username).filter(Boolean);
            const normalizedName = normalizeName(circle.name || circleId || `circle_${idx}`);
            circleMembersMap[circleId?.toLowerCase?.() || normalizedName] = circleMembers;
            circleMembersMap[normalizedName] = circleMembers;
            
            careCircles.push({
                id: circleId,
                name: circle.name || `Circle ${idx + 1}`,
                patientId: circle.primaryPatientId,
                members: circle.members || [],
                color: colors[idx % colors.length]
            });
        });

        // Create nodes for each user (privacy circle = user + agentic framework)
        scenario.users?.forEach((user) => {
            const userColor = userColors[user.username];
            const username = user.username;

            // Map user to circles
            const defaultCircleIds = careCircles.map(circle => circle.id);
            const userCircles = Array.isArray(user.circles) && user.circles.length
                ? user.circles.map(c => {
                    const base = typeof c === 'string' ? c : (c.circleId || c.circleName || c.name);
                    return circleNameToId[base?.toLowerCase?.()] || base;
                }).filter(Boolean)
                : (defaultCircleIds.length ? [defaultCircleIds[0]] : []);

            userCircleMap[username] = userCircles;

            // User node
            nodes.push({
                id: `user_${username}`,
                type: 'user',
                label: username,
                username,
                color: userColor,
                circleIds: userCircleMap[username]
            });

            if (user.role) {
                lastSpeakerByRole[user.role.toLowerCase()] = username;
            }

            const personaKey = user.persona || user.personaKey;
            const personaData = personaKey ? personas[personaKey] : null;
            const personaName = personaData?.name;
            const displayNames = [username, personaName];

            if (personaName) {
                const firstName = personaName.split(' ')[0];
                displayNames.push(firstName);
            }

            displayNames
                .filter(Boolean)
                .forEach(name => {
                    personaNameToUserId[normalizeName(name)] = username;
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
        networkInitialized = true;
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
        const circlesForUser = userCircleMap[baseId];
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

function encodeSegment(value = '') {
    return encodeURIComponent(value);
}

function makeCompanionNodeId(kind, componentId, username) {
    return `companion_${kind}_${encodeSegment(componentId)}__${encodeSegment(username)}`;
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

    if (!Array.isArray(nodes) || !nodes.length) {
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

    const perUser = new Map();
    nodes.forEach(node => {
        const username = node.username || (node.id?.startsWith('user_') ? node.id.replace(/^user_/, '') : null);
        if (!username) return;
        if (!perUser.has(username)) {
            perUser.set(username, {
                color: userColors[username] || node.color || '#4285F4',
                coordinator: null,
                handlers: [],
                agents: []
            });
        }
        const entry = perUser.get(username);
        if (node.type === 'companion_coordinator') {
            entry.coordinator = node.label || 'Coordinator';
        } else if (node.type === 'companion_handler') {
            entry.handlers.push(node.label || node.id);
        } else if (node.type === 'companion_agent') {
            entry.agents.push(node.label || node.id);
        }
    });

    const renderUserSummary = (username) => {
        const entry = perUser.get(username);
        if (!entry) return '';
        const color = entry.color || '#4285F4';
        const userLabel = username.replace(/_/g, ' ');
        const coordinatorRow = `
            <div style="font-size:11px; color:var(--gray-700);">
                <strong>Coordinator:</strong> ${entry.coordinator ? pill(entry.coordinator, color) : '<span style="color:var(--gray-500);">None detected</span>'}
            </div>
        `;
        const handlerRow = `
            <div style="font-size:11px; color:var(--gray-700);">
                <strong>Handlers:</strong> ${entry.handlers.length ? entry.handlers.map(name => pill(name, color)).join(' ') : '<span style="color:var(--gray-500);">None detected</span>'}
            </div>
        `;
        const agentRow = `
            <div style="font-size:11px; color:var(--gray-700);">
                <strong>Agents:</strong> ${entry.agents.length ? entry.agents.map(name => pill(name, color)).join(' ') : '<span style="color:var(--gray-500);">None detected</span>'}
            </div>
        `;

        return `
            <div style="display:flex; flex-direction:column; gap:4px; padding:6px 8px; border-radius:6px; background:var(--gray-50);">
                <div style="font-weight:600; font-size:12px; color:${color};">${pill(userLabel, color)}</div>
                ${coordinatorRow}
                ${handlerRow}
                ${agentRow}
            </div>
        `;
    };

    const circleSections = Array.isArray(careCircles) && careCircles.length
        ? careCircles.map(circle => {
            const members = (circle.members || []).map(member => typeof member === 'string' ? member : member.username).filter(Boolean);
            const memberRows = members.map(renderUserSummary).filter(Boolean).join('') ||
                `<div style="font-size:11px; color:var(--gray-600);">No companion components yet.</div>`;
            return `
                <div style="display:flex; flex-direction:column; gap:6px;">
                    <div style="font-weight:600; color:var(--gray-800);">${escapeHtml(circle.name || circle.id)}</div>
                    <div style="display:flex; flex-direction:column; gap:6px; padding-left:8px;">
                        ${memberRows}
                    </div>
                </div>
            `;
        }).join('')
        : Array.from(perUser.keys()).map(renderUserSummary).filter(Boolean).join('');

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
