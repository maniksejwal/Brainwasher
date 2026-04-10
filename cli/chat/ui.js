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

const generalCommands = `
${chalk.bold.cyan('General Commands (All Users):')}
  ${chalk.yellow('/circle')}                    - Show your current care circle members and roles
  ${chalk.yellow('/switch <username>')}         - Switch to another care circle
  ${chalk.yellow('/feedback +1/-1')}            - Quick rating OR detailed report
  ${chalk.yellow('/feedback bug "description"')} - Report specific issues (bug, privacy, tone, etc.)
  ${chalk.yellow('/yes')} or ${chalk.yellow('/no')}              - Respond to system questions

${chalk.italic.gray('Note: /score and /report still work, but /feedback is preferred (unified command)')}`;

const patientCommands = `
${chalk.bold.green('Patient Commands:')}
  ${chalk.yellow('/care <username> as <relationship>')} - Add a caregiver to YOUR circle
  ${chalk.yellow('/doc <username>')}                   - Add a doctor to YOUR circle
  ${chalk.yellow('/consent <username> <level>')}       - Set consent level (NONE/MEDIUM/FULL) for a member
  ${chalk.italic('Natural instructions:')}
     ${chalk.gray('- @username to directly reference someone (e.g. "@caregiver can you check on meds tonight?")')}
     ${chalk.gray('- Ask your agent to message someone by name/role; it will rephrase and send politely')}
`;

const caregiverCommands = `
${chalk.bold.blue('Caregiver Commands:')}
  ${chalk.yellow('/consent <username> <level>')} - Set your consent level in this circle
  ${chalk.italic('Natural interactions:')}
     ${chalk.gray('- Reference @patient or other caregivers; your agent relays appropriate questions')}
     ${chalk.gray('- Describe concerns naturally (e.g. "Can someone remind patient about the evening pill?")')}
`;

const doctorCommands = `
${chalk.bold.magenta('Doctor Commands:')}
  ${chalk.yellow('/spec <specialty>')}            - Set your clinical specialty (e.g., Cardiology)
  ${chalk.yellow('/log "note"')}                  - Log a confidential note in the patient's record
  ${chalk.yellow('/order "test/medication"')}     - Log a confidential order request
  ${chalk.yellow('/agent ask <username> "topic"')} - Have your agent ask a question on your behalf
  ${chalk.italic('Natural instructions:')}
     ${chalk.gray('- Mention @patient, @caregiver, or @username to target recipients')}
     ${chalk.gray('- State what you need asked (e.g. "Please ask @caregiver if the wound dressing was changed today")')}
     ${chalk.gray('- The system rephrases and delivers via the appropriate agent, tracking responses')}
     ${chalk.gray('- Want precision? Use /agent ask <username> "topic" to force a specific prompt')}
`;

const professionalCommands = `
${chalk.bold.cyan('Professional Commands:')}
  ${chalk.yellow('/target <username> as <role>')}    - Add target to professional circle (buyer, client, project owner)
  ${chalk.yellow('/support <username> as <role>')}   - Add support to professional circle (facilitator, project manager)  
  ${chalk.yellow('/expert <username> as <role>')}    - Add expert to professional circle (technical architect, legal counsel)
  ${chalk.yellow('/professional')}                   - Show professional circle members and roles
  ${chalk.italic('Professional interactions:')}
     ${chalk.gray('- Use business language naturally for negotiations, coordination, approvals')}
     ${chalk.gray('- Reference roles like @target, @support, @expert for structured communication')}
`;

function getWelcomeMessage(isNewUser, username, roles) {
    if (isNewUser) {
        return `
${chalk.bold.green('═'.repeat(60))}
${chalk.bold.green('🎉 Welcome to the Multi-Agent Care System, ' + username + '!')}
${chalk.bold.green('═'.repeat(60))}

${chalk.cyan('You\'re starting fresh! Here\'s what you can do:')}

${chalk.bold('1. Build Your Care Circle:')}
   ${chalk.yellow('/care alice as spouse')}  - Add a caregiver
   ${chalk.yellow('/doc dr_smith')}          - Add a doctor

${chalk.bold('2. Just Talk Naturally:')}
   Type anything to your personal AI agent
   Example: "I took my medication this morning"

${chalk.bold('3. Help Improve the System:')}
   After any interaction, rate it with ${chalk.yellow('/score +1')} or ${chalk.yellow('/score -1')}
`;
    } else {
        const roleList = roles.length > 0 ? roles.join(', ') : 'patient';
        return `
${chalk.bold.green('═'.repeat(60))}
${chalk.bold.green('👋 Welcome back, ' + username + '!')}
${chalk.bold.green('═'.repeat(60))}

${chalk.cyan('Your roles:')} ${chalk.bold(roleList)}
${chalk.cyan('Active circle:')} Your personal circle (you as patient)

${chalk.bold('Quick Actions:')}
  • ${chalk.yellow('/circle')} - See your care circle status
  • ${chalk.yellow('/switch <name>')} - Switch to another circle
  • Just type naturally to talk to your AI agent
  • ${chalk.yellow('/score +1')} after good interactions to help improve the system
`;
    }
}

function showCommandsByRoles(roles) {
    console.log(chalk.bold('\n📋 Available Commands:\n'));
    
    // Always show general commands
    console.log(generalCommands);
    
    // Show role-specific commands
    if (roles.includes('patient') || roles.length === 0) {
        console.log(patientCommands);
    }
    
    if (roles.includes('caregiver')) {
        console.log(caregiverCommands);
    }
    
    if (roles.includes('doctor')) {
        console.log(doctorCommands);
    }
    
    // Show professional commands for all users (since anyone can have professional context)
    console.log(professionalCommands);
    
    console.log(chalk.bold.green('═'.repeat(60)));
    console.log(chalk.italic.gray('Tip: Just type naturally - your AI agent understands conversation!\n'));
}

export function showLoginMessage(message, isNewUser = false) {
    const roles = state.allRoles || [];
    console.log(getWelcomeMessage(isNewUser, state.username, roles));
    showCommandsByRoles(roles);
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
    
    // Use cleaner display for system messages and different colors for agent types
    let prefix;
    if (data.from === 'system') {
        prefix = chalk.bold.red(`[system]:`);
    } else if (data.from === 'PersonalAgent') {
        prefix = chalk.bold.green(`[PersonalAgent@${patientName}]:`);
    } else if (data.from === 'CareAgent') {
        prefix = chalk.bold.cyan(`[CareAgent@${patientName}]:`);
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
    console.log(chalk.green.bold('\n' + '═'.repeat(60)));
    console.log(chalk.green(`✓ Switched to circle for patient: ${chalk.bold(data.patientUsername)}`));
    console.log(chalk.green(`  Your role in this circle: ${chalk.bold(data.newRole)}`));
    console.log(chalk.green.bold('═'.repeat(60) + '\n'));
    
    // Show role-specific reminder
    if (data.newRole === 'doctor') {
        console.log(chalk.italic.gray('💡 Remember: Use /log for private notes, /order for prescriptions, and type natural instructions to have agents follow up for you.\n'));
    } else if (data.newRole === 'caregiver') {
        console.log(chalk.italic.gray('💡 Remember: Talk naturally - your agent coordinates with the patient\'s agent\n'));
    } else if (data.newRole === 'patient') {
        console.log(chalk.italic.gray('💡 Remember: Use /care to add caregivers, /doc to add doctors\n'));
    }
}

