/**
 * @fileoverview GUI Application - Main Entry Point
 * Modularized: Uses separate files for UI, messages, and configuration
 */

import config from './config.js';
import ApiClient from '../shared/apiClient.js';
import { MESSAGES } from './config/messages.js';
import { displayMessage, addUserMessage, addSystemMessage, displayEscalation, displayAnalysisProgress } from './ui/messages.js';
import { initSimulationUI, displaySimulationMessage } from './ui/simulationUI_new.js';
import { setupCommandSuggestions } from './ui/commandSuggestions.js';
import { setupFeedbackModal } from './ui/feedback.js';
import { switchView, loadCircleInfo, loadMyCirclesData, loadPatientsData, loadFeedbackData, loadConversationsData, loadServerLogs } from './ui/dataLoaders.js';
// Old simulationUI.js removed - using simulationUI_new.js instead
import { initAnalysisUI } from './ui/analysisUI.js';
import { initReportUI } from './ui/reportUI.js';
import initTrainingDashboard from './ui/trainingDashboard.js';
import initPromptComparison from './ui/promptComparison.js';

// Create shared API client
const api = new ApiClient(config.ORCHESTRATOR_URL);
window.api = api; // Make globally accessible for UI modules

// Application state
const state = {
    username: null,
    userId: null,
    currentCircleId: null,
    currentPatientUsername: null,
    allRoles: [],
    messages: [],
    eventSource: null
};
window.state = state; // Make globally accessible for UI modules

// ====== LOGIN ======
document.getElementById('login-btn').addEventListener('click', async () => {
    const username = document.getElementById('username').value.trim();
    if (!username) return;

    try {
        const data = await api.login(username);

        state.username = username;
        state.userId = data.userId;
        state.currentCircleId = data.activeCircleId;
        state.currentPatientUsername = data.patientUsername;
        state.allRoles = data.allRoles || [];

        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('app-screen').classList.add('active');

        document.getElementById('current-context').textContent = `@${data.patientUsername}`;
        document.getElementById('username-display').textContent = username;

        // Update browser tab title
        const role = data.allRoles.join(', ') || 'patient';
        document.title = `${username} (${role}) - Care Circles`;

        connectToEventSource();

        if (data.isNewUser) {
            addSystemMessage(MESSAGES.WELCOME_NEW(username));
            addSystemMessage(MESSAGES.HELP_HINT);
            addSystemMessage(MESSAGES.QUICK_START);
        } else {
            addSystemMessage(MESSAGES.WELCOME_BACK(username));
        }

        // Load scenarios for simulation tab
        // Initialize new fresh simulation UI
        initSimulationUI(api, state);

        // Initialize training and prompt comparison dashboards
        initTrainingDashboard();
        initPromptComparison();
        initAnalysisUI();
        initReportUI();
    } catch (error) {
        alert(MESSAGES.LOGIN_FAILED(error.message));
    }
});

// ====== LOAD SCENARIOS ======
// loadScenarios moved to simulationUI_new.js

// ====== SERVER-SENT EVENTS ======
function connectToEventSource() {
    state.eventSource = new EventSource(api.getEventSourceUrl(state.userId));

    state.eventSource.onmessage = (e) => {
        const data = JSON.parse(e.data);

        if (data.type === 'message') {
            displayMessage(data);
        } else if (data.type === 'escalation') {
            displayEscalation(data);
        } else if (data.type === 'context_switched') {
            state.currentCircleId = data.newCircleId;
            state.currentPatientUsername = data.patientUsername;
            window.currentCircleId = data.newCircleId; // Make available globally for consent dropdown
            document.getElementById('current-context').textContent = `@${data.patientUsername}`;
            document.title = `${state.username} (${data.newRole}) - Care Circles`;
            addSystemMessage(MESSAGES.CONTEXT_SWITCHED(data.patientUsername, data.newRole));
        } else if (data.type === 'analysis_progress') {
            displayAnalysisProgress(data);
        } else if (data.type === 'simulation_progress') {
            displaySimulationMessage(data);
        }
    };

    state.eventSource.onerror = () => {
        addSystemMessage(MESSAGES.CONNECTION_LOST);
    };
}

// ====== SEND MESSAGE ======
async function sendMessage(message) {
    if (!message.trim()) return;

    addUserMessage(message);

    try {
        if (message.startsWith('/')) {
            await api.sendCommand(state.userId, state.currentCircleId, message);
        } else {
            await api.sendMessage(state.userId, state.currentCircleId, message);
        }
    } catch (error) {
        addSystemMessage(MESSAGES.SEND_ERROR(error.message));
    }
}

// Message input handlers
document.getElementById('send-btn').addEventListener('click', () => {
    const input = document.getElementById('message-input');
    sendMessage(input.value);
    input.value = '';
});

document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage(e.target.value);
        e.target.value = '';
    }
});

// Setup command suggestions
setupCommandSuggestions(document.getElementById('message-input'));

// Setup feedback modal
setupFeedbackModal(sendMessage);

// Listen for circle view refresh events
window.addEventListener('refreshCircleView', () => {
    loadCircleInfo(api, state.userId);
});

// ====== VIEW SWITCHING ======
document.getElementById('circle-btn').addEventListener('click', () => {
    switchView('circle');
    loadCircleInfo(api, state.userId);
});

document.getElementById('mycircles-btn').addEventListener('click', () => {
    switchView('mycircles');
    loadMyCirclesData(api, state.userId);
});

document.getElementById('patients-btn').addEventListener('click', () => {
    switchView('patients');
    loadPatientsData(api, state.userId);
});

document.getElementById('feedback-btn').addEventListener('click', () => {
    switchView('feedback');
    loadFeedbackData(api, state.userId);
    loadConversationsData(api, state.userId);
});

document.getElementById('view-selector').addEventListener('click', () => {
    switchView('chat');
});

document.getElementById('back-to-chat').addEventListener('click', () => {
    switchView('chat');
});

document.getElementById('back-to-chat-mycircles').addEventListener('click', () => {
    switchView('chat');
});

document.getElementById('back-to-chat-patients').addEventListener('click', () => {
    switchView('chat');
});

// ====== HELP MODAL ======
document.getElementById('help-btn').addEventListener('click', () => {
    document.getElementById('help-modal').classList.add('active');
});

document.getElementById('close-help').addEventListener('click', () => {
    document.getElementById('help-modal').classList.remove('active');
});

// ====== FEEDBACK TAB SWITCHING ======
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;

        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));

        tab.classList.add('active');
        document.getElementById(tabName).classList.add('active');

        // Load data when switching tabs
        if (tabName === 'my-feedback' && state.userId) {
            loadFeedbackData(api, state.userId);
        } else if (tabName === 'conversations' && state.userId) {
            loadConversationsData(api, state.userId);
        } else if (tabName === 'logs') {
            loadServerLogs(api);
        } else if (tabName === 'training') {
            // Training dashboard is already initialized
        } else if (tabName === 'prompts') {
            // Prompt comparison is already initialized
        }
    });
});

// ====== SIMULATION ======
// Simulation handler moved to simulationUI_new.js - initSimulationUI()

// Feedback button removed - use inline feedback in simulation tab

// Feedback button removed - use inline feedback in simulation tab

// Analysis event listeners handled in initAnalysisUI()

document.getElementById('refresh-logs').addEventListener('click', () => {
    loadServerLogs(api);
});

// ====== ADD MEMBER MODAL ======
let currentMemberType = null;

// Watch for add member button (dynamically added in circle view)
document.addEventListener('click', (e) => {
    if (e.target.id === 'add-member-btn') {
        document.getElementById('add-member-modal').classList.add('active');
    }
});

document.getElementById('add-caregiver-btn').addEventListener('click', () => {
    currentMemberType = 'caregiver';
    document.getElementById('caregiver-form').style.display = 'block';
    document.getElementById('doctor-form').style.display = 'none';
});

document.getElementById('add-doctor-btn').addEventListener('click', () => {
    currentMemberType = 'doctor';
    document.getElementById('doctor-form').style.display = 'block';
    document.getElementById('caregiver-form').style.display = 'none';
});

document.getElementById('submit-add-member').addEventListener('click', async () => {
    let command = '';

    if (currentMemberType === 'caregiver') {
        const username = document.getElementById('caregiver-username').value.trim();
        const relationship = document.getElementById('caregiver-relationship').value.trim();

        if (!username || !relationship) {
            alert('Please fill in both username and relationship');
            return;
        }

        command = `/care ${username} as ${relationship}`;
    } else if (currentMemberType === 'doctor') {
        const username = document.getElementById('doctor-username').value.trim();
        const specialty = document.getElementById('doctor-specialty').value.trim();

        if (!username) {
            alert('Please enter doctor username');
            return;
        }

        command = specialty
            ? `/doc ${username} as ${specialty}`
            : `/doc ${username}`;
    } else {
        alert('Please select member type first');
        return;
    }

    await sendMessage(command);

    // Close modal and reset
    document.getElementById('add-member-modal').classList.remove('active');
    document.getElementById('caregiver-form').style.display = 'none';
    document.getElementById('doctor-form').style.display = 'none';
    document.getElementById('caregiver-username').value = '';
    document.getElementById('caregiver-relationship').value = '';
    document.getElementById('doctor-username').value = '';
    currentMemberType = null;

    // Reload circle view after adding member
    setTimeout(() => {
        loadCircleInfo(api, state.userId);
    }, 1000); // Wait 1 second for command to process
});

document.getElementById('cancel-add-member').addEventListener('click', () => {
    document.getElementById('add-member-modal').classList.remove('active');
    document.getElementById('caregiver-form').style.display = 'none';
    document.getElementById('doctor-form').style.display = 'none';
    document.getElementById('caregiver-username').value = '';
    document.getElementById('caregiver-relationship').value = '';
    document.getElementById('doctor-username').value = '';
    document.getElementById('doctor-specialty').value = '';
    currentMemberType = null;
});
