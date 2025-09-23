/**
 * @fileoverview client/ui.js
 * Handles all user interface logic for the command-line client.
 * This includes managing the readline prompt, displaying formatted messages,
 * and showing context-specific command lists.
 */

import readline from 'readline';
import chalk from 'chalk';
import { state } from './state.js';

export const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const doctorCommands = `
${chalk.bold('Doctor Commands:')}
  /spec <specialty>            - Set your clinical specialty (e.g., Cardiology).
  /switch <patient_username>   - Switch to a patient's care circle.
  /log "note"                  - Log a confidential note.
  /order "test/medication"     - Log a confidential order request.
  /agent ask <username> "topic"    - Have your agent ask a question on your behalf.
`;

const patientCommands = `
${chalk.bold('Patient Commands:')}
  /care <username> as <relationship> - Add a caregiver to your circle.
  /doc <username>                  - Add a doctor to your circle.
  /consent <username> <level>      - Set consent for a member.
`;

export function showLoginMessage(message) {
    console.log(chalk.green(message));
    if (state.allRoles.includes('doctor')) {
        console.log(doctorCommands);
    } else {
        console.log(patientCommands);
    }
}

export function updatePrompt() {
    // FIX: Fallback logic to ensure the prompt never shows 'undefined'.
    const patientName = state.currentPatientUsername || state.currentCircleId;
    rl.setPrompt(chalk.bold(`${state.username}@${patientName}> `));
    rl.prompt();
}

export function clearLine() {
    process.stdout.write(`\r${' '.repeat(rl.line.length)}\r`);
}

export function displayMessage(data) {
    const patientName = data.patientUsername || data.circleId;
    
    // Use cleaner display for system messages
    let prefix;
    if (data.from === 'system') {
        prefix = chalk.bold.red(`[system]:`);
    } else {
        prefix = chalk.bold.blue(`[${data.from}@${patientName}]:`);
    }
    
    console.log(`${prefix} ${data.reply || data.message}`);
}

export function displayEscalations(escalations) {
    console.log(chalk.red.bold(`\n--- NEW ESCALATIONS RECEIVED ---`));
    escalations.forEach(item => {
        const message = `[${new Date(item.timestamp).toLocaleString()}] ${item.type} in circle for ${item.patient_username}: ${item.details}`;
        console.log(chalk.red(message));
    });
    console.log(chalk.red.bold(`------------------------------`));
}

export function displayContextSwitch(data) {
    console.log(chalk.green(`Switched context to circle for patient: ${data.patientUsername} (Your role: ${data.newRole})`));
    // FIX: Check all roles to see if the user is a doctor.
    if (state.allRoles.includes('doctor')) {
        console.log(doctorCommands);
    }
}

