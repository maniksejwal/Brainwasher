/**
 * @fileoverview The command-line interface for interacting with the multi-agent system.
 * This client allows a user to log in, send messages and commands, and receive
 * real-time updates from their personal agent and care circles.
 */

import readline from 'readline';
import chalk from 'chalk';
import EventSource from 'eventsource';
import config from './config.js';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let userId = '';
let username = '';
let currentCircleId = '';

async function main() {
    username = await new Promise(resolve => {
        rl.question(chalk.bold('Enter your username: '), (answer) => {
            resolve(answer.toLowerCase().trim());
        });
    });

    try {
        const response = await fetch(`${config.ORCHESTRATOR_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username }),
        });
        const data = await response.json();
        userId = data.userId;
        currentCircleId = data.activeCircleId;
        console.log(chalk.green(data.message));
        console.log(chalk.gray("Try '/add <username> as <role> with relationship <relationship>' to build your circle."));
        rl.setPrompt(chalk.bold(`${username}@${currentCircleId}> `));
        rl.prompt();

    } catch (error) {
        console.error(chalk.red('Error logging in:', error.message));
        rl.close();
        return;
    }

    const es = new EventSource(`${config.ORCHESTRATOR_URL}/events/${userId}`);

    es.on('message', async (e) => {
        const data = JSON.parse(e.data);
        process.stdout.write(`\r${' '.repeat(rl.line.length)}\r`);
        if (data.type === 'message') {
            const prefix = chalk.bold.blue(`[${data.from}@${data.circleId}]:`);
            console.log(`${prefix} ${data.reply || data.message}`);
        } else if (data.type === 'escalation') {
            // FIX: Doctor client now fetches its specific escalations
            if (username.startsWith('dr_')) { // Simple check for doctor role
                try {
                    const response = await fetch(`${config.ORCHESTRATOR_URL}/doctor/escalations/unread/${userId}`);
                    const escalations = await response.json();
                    if (escalations && escalations.length > 0) {
                        console.log(chalk.red.bold(`\n--- NEW ESCALATIONS RECEIVED ---`));
                        escalations.forEach(item => {
                            const message = `[${new Date(item.timestamp).toLocaleString()}] ${item.type} in circle for ${item.patient_username}: ${item.details}`;
                            console.log(chalk.yellow(message));
                        });
                        console.log(chalk.red.bold(`------------------------------`));
                    }
                } catch (error) {
                     console.error(chalk.red('Error fetching escalations:', error.message));
                }
            }
        } else if (data.type === 'context_switched') {
            currentCircleId = data.newCircleId;
            const patientUsername = data.newCircleId === userId ? username : data.newCircleId;
            console.log(chalk.yellow(`Switched context to circle for patient: ${patientUsername}`));
            rl.setPrompt(chalk.bold(`${username}@${patientUsername}> `));
        }
        rl.prompt();
    });

    es.on('error', (err) => {
        process.stdout.write(`\r${' '.repeat(rl.line.length)}\r`);
        console.log(chalk.red('Connection error. Attempting to reconnect...'));
        rl.prompt();
    });

    rl.on('line', (line) => {
        if (line.trim().startsWith('/')) {
            sendCommand(line.trim());
        } else {
            sendMessage(line.trim());
        }
        rl.prompt();
    });
}

async function sendCommand(message) {
     try {
        await fetch(`${config.ORCHESTRATOR_URL}/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, circleId: currentCircleId, message }),
        });
    } catch (error) {
        console.error(chalk.red('Error sending command:', error.message));
    }
}

async function sendMessage(message) {
    if (!message) return;
    try {
        await fetch(`${config.ORCHESTRATOR_URL}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, circleId: currentCircleId, message }),
        });
    } catch (error) {
        console.error(chalk.red('Error sending message:', error.message));
    }
}

main();

