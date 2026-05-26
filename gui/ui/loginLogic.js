import { MESSAGES } from '../config/messages.js';
import { addSystemMessage } from './messages.js';
import { initSimulationUI } from './simulationUI_new.js';
import initTrainingDashboard from './trainingDashboard.js';
import initPromptComparison from './promptComparison.js';
import { initAnalysisUI } from './analysisUI.js';
import { initReportUI } from './reportUI.js';
import initBenchmarksDashboard from './benchmarksDashboard.js';

export function setupLoginHandler(api, state) {
    const loginBtn = document.getElementById('login-btn');
    
    if (!loginBtn) {
        console.error('[LoginLogic] Login button not found!');
        return;
    }
    
    loginBtn.addEventListener('click', async () => {
        const username = document.getElementById('username').value.trim();
        const role = document.getElementById('role-select').value;
        const password = document.getElementById('password').value;

        if (!username) return;

        try {
            const data = await api.login(username, role, password);

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
            const roleStr = state.allRoles.join(', ') || 'patient';
            document.title = `${username} (${roleStr}) - Care Circles`;

            // Trigger connection in main app (callback or event?)
            // We can dispatch a custom event
            window.dispatchEvent(new CustomEvent('loginSuccess'));

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
            initBenchmarksDashboard();
        } catch (error) {
            alert(MESSAGES.LOGIN_FAILED(error.message));
        }
    });
}
