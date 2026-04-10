/**
 * @fileoverview GUI Application - Main Entry Point
 * Modularized: Uses separate files for UI, messages, configuration, and logic
 */

import config from './config.js';
import ApiClient from '../shared/apiClient.js';
import { MESSAGES } from './config/messages.js';
import { displayMessage, addUserMessage, addSystemMessage, displayEscalation, displayAnalysisProgress } from './ui/messages.js';
import { displaySimulationMessage } from './ui/simulationUI_new.js';
import { setupCommandSuggestions } from './ui/commandSuggestions.js';
import { setupFeedbackModal } from './ui/feedback.js';
import { setupBusinessEventListeners } from './ui/dataLoaders.js';
import { initializeSpeech } from './ui/speechManager.js';
import NotificationCenter from './ui/NotificationCenter.js';

// Logic Modules
import { setupLoginHandler } from './ui/loginLogic.js';
import { setupNavigationHandlers } from './ui/navigationHandlers.js';
import { setupModals } from './ui/modals.js';

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

// ====== LOGIC INITIALIZATION ======

// Login Logic
setupLoginHandler(api, state);

// Navigation Logic
setupNavigationHandlers(api, state);

// ====== SSE CONNECTION ======
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

// Listen for login success to trigger SSE
window.addEventListener('loginSuccess', () => {
    connectToEventSource();
    // Initialize Notification Center (commented out to fix duplicate bells)
    // new NotificationCenter(state.userId);
});

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

// Modals (Pass sendMessage callback)
setupModals(api, sendMessage);

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

// Setup business event listeners
setupBusinessEventListeners();

// Initialize speech functionality
initializeSpeech();
