/**
 * @fileoverview client/network.js
 * Handles all network communication for the client.
 * NOW USES SHARED API CLIENT - zero duplication!
 */

import EventSource from 'eventsource';
import chalk from 'chalk';
import config from '../config.js';
import { state, updateUserState } from './state.js';
import { showLoginMessage, updatePrompt, clearLine, displayMessage, displayEscalations, displayContextSwitch } from './ui.js';
import ApiClient from '../shared/apiClient.js';

// Create shared API client instance
const api = new ApiClient(config.ORCHESTRATOR_URL);

export async function login() {
    try {
        const data = await api.login(state.username);
        
        updateUserState({
            userId: data.userId,
            currentCircleId: data.activeCircleId,
            currentPatientUsername: data.patientUsername,
            userRoleInCurrentCircle: 'patient',
            allRoles: data.allRoles || []
        });
        showLoginMessage(data.message, data.isNewUser);
        return true;
    } catch (error) {
        console.error(chalk.red('Error logging in:', error.message));
        return false;
    }
}

export function connectToEventSource() {
    // Use EventSource package for Node.js (browser uses native)
    const es = new EventSource(api.getEventSourceUrl(state.userId));

    es.on('message', async (e) => {
        const data = JSON.parse(e.data);
        clearLine();

        if (data.type === 'message') {
            displayMessage(data);
        } else if (data.type === 'escalation') {
            try {
                const escalations = await api.getUnreadEscalations(state.userId);
                if (escalations && escalations.length > 0) {
                    displayEscalations(escalations);
                }
            } catch (error) {
                console.error(chalk.red('Error fetching escalations:', error.message));
            }
        } else if (data.type === 'context_switched') {
            // FIX: Ensure all state variables are correctly updated from the complete payload.
            updateUserState({
                currentCircleId: data.newCircleId,
                userRoleInCurrentCircle: data.newRole,
                currentPatientUsername: data.patientUsername
            });
            displayContextSwitch(data);
        }
        updatePrompt();
    });

    es.on('error', (err) => {
        clearLine();
        console.log(chalk.red('Connection error. Attempting to reconnect...'));
        updatePrompt();
    });
}

export async function sendCommand(message) {
    try {
        await api.sendCommand(state.userId, state.currentCircleId, message);
    } catch (error) {
        console.error(chalk.red('Error sending command:', error.message));
    }
}

export async function sendMessage(message) {
    if (!message) return;
    try {
        await api.sendMessage(state.userId, state.currentCircleId, message);
    } catch (error) {
        console.error(chalk.red('Error sending message:', error.message));
    }
}

