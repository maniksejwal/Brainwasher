/**
 * @fileoverview client/network.js
 * Handles all network communication for the client. This includes logging in,
 * sending messages and commands via fetch, and managing the persistent
 * real-time connection using EventSource for receiving updates from the server.
 */

import EventSource from 'eventsource';
import chalk from 'chalk';
import config from '../config.js';
import { state, updateUserState } from './state.js';
import { showLoginMessage, updatePrompt, clearLine, displayMessage, displayEscalations, displayContextSwitch } from './ui.js';

export async function login() {
    try {
        const response = await fetch(`${config.ORCHESTRATOR_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: state.username }),
        });
        const data = await response.json();
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
    const es = new EventSource(`${config.ORCHESTRATOR_URL}/events/${state.userId}`);

    es.on('message', async (e) => {
        const data = JSON.parse(e.data);
        clearLine();

        if (data.type === 'message') {
            displayMessage(data);
        } else if (data.type === 'escalation') {
            try {
                const res = await fetch(`${config.ORCHESTRATOR_URL}/doctor/escalations/unread/${state.userId}`);
                const escalations = await res.json();
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
        await fetch(`${config.ORCHESTRATOR_URL}/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: state.userId, circleId: state.currentCircleId, message }),
        });
    } catch (error) {
        console.error(chalk.red('Error sending command:', error.message));
    }
}

export async function sendMessage(message) {
    if (!message) return;
    try {
        await fetch(`${config.ORCHESTRATOR_URL}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: state.userId, circleId: state.currentCircleId, message }),
        });
    } catch (error) {
        console.error(chalk.red('Error sending message:', error.message));
    }
}

