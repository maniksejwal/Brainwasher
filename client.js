import readline from 'readline';
import chalk from 'chalk';
import EventSource from 'eventsource';
import config from './config.js'; // Import the centralized config

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let userId = '';
let userRole = '';

async function registerUser(role) {
    try {
        const response = await fetch(`${config.ORCHESTRATOR_URL}/user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: role, role: role }) // Using role as userId for simplicity
        });
        if (!response.ok) throw new Error('Failed to register user');
        const data = await response.json();
        console.log(chalk.green(data.message));
        userId = role;
        userRole = role;
        return true;
    } catch (error) {
        console.error(chalk.red('Error registering user:', error.message));
        return false;
    }
}

function listenForMessages() {
    const es = new EventSource(`${config.ORCHESTRATOR_URL}/events`);

    es.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerEvent(data);
    };

    es.onerror = () => {
        console.log(chalk.yellow('Connection error. Attempting to reconnect...'));
        // The eventsource library handles reconnection automatically
    };
}

function handleServerEvent(data) {
    if (data.type === 'message' && data.targetUsers.includes(userId)) {
        const from = data.from === 'personal-agent' ? 'Personal Agent' : 'System';
        const color = data.from === 'personal-agent' ? chalk.cyan : chalk.magenta;
        readline.cursorTo(process.stdout, 0);
        console.log(color(`[${from}]`), data.reply || data.message);
        rl.prompt(true);
    } else if (data.type === 'escalation' && userRole === 'doctor') {
        // This is now handled by the unified client logic
        const escalations = data.payload;
         if (escalations && escalations.length > 0) {
            readline.cursorTo(process.stdout, 0);
            console.log(chalk.red.bold('\n--- NEW ESCALATIONS ---'));
            escalations.forEach(e => {
                 console.log(chalk.yellow(`[${new Date(e.timestamp).toLocaleTimeString()}] ${e.type}: ${e.details}`));
            });
            console.log(chalk.red.bold('-----------------------'));
            rl.prompt(true);
        }
    }
}

async function sendMessage(message) {
    try {
        await fetch(`${config.ORCHESTRATOR_URL}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, role: userRole, message })
        });
    } catch (error) {
        console.error(chalk.red('Error sending message:', error.message));
    }
}

function startChat() {
    rl.on('line', (line) => {
        sendMessage(line);
        rl.prompt(true);
    });
    rl.prompt(true);
}

// Main execution
rl.question('Enter your role (patient/caregiver/doctor): ', async (role) => {
    const normalizedRole = role.toLowerCase();
    if (['patient', 'caregiver', 'doctor'].includes(normalizedRole)) {
        const registered = await registerUser(normalizedRole);
        if (registered) {
            listenForMessages();
             rl.setPrompt(chalk.bold(`${userId} > `));
             startChat();
        } else {
            rl.close();
        }
    } else {
        console.log(chalk.red('Invalid role. Please restart.'));
        rl.close();
    }
});

