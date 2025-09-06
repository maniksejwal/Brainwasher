import readline from 'readline';
import { EOL } from 'os';
import chalk from 'chalk';

const ORCHESTRATOR_URL = "http://127.0.0.1:5000";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let userId;

// FEATURE: Simplified display logic for new conversational style
function displayMessage(message) {
    if (message.startsWith('[Care Circle Update]')) {
        console.log(chalk.blue(message));
    } else if (message.startsWith('[Discrepancy Noted]')) {
        console.log(chalk.yellow.bold(message));
    }
    else {
        // AI agent's conversational replies will be green
        console.log(chalk.green(message)); 
    }
}

async function fetchMessages() {
    try {
        const response = await fetch(`${ORCHESTRATOR_URL}/fetch/${userId}`);
        if (response.ok) {
            const { messages } = await response.json();
            if (messages.length > 0) {
                messages.forEach(displayMessage);
                rl.prompt(true); // Redraw the prompt
            }
        }
    } catch (e) {
        // Fail silently if the server isn't ready
    }
}

async function sendMessage(line) {
    try {
        await fetch(`${ORCHESTRATOR_URL}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, message: line })
        });
    } catch (e) {
        console.log(chalk.red("Error: Could not connect to the orchestrator. Is it running?"));
    }
}

// --- Main Execution ---
rl.question('Enter your role (patient/caregiver): ', async (role) => {
    userId = role.trim().toLowerCase();
    if (userId !== 'patient' && userId !== 'caregiver') {
        console.log("Invalid role. Please enter 'patient' or 'caregiver'.");
        rl.close();
        return;
    }

    try {
        // Register the user
        await fetch(`${ORCHESTRATOR_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        console.log(chalk.cyan(`Welcome, ${userId}. You can start typing messages.`));
        rl.setPrompt(chalk.bold(`${userId}> `));
        rl.prompt();

        rl.on('line', async (line) => {
            if (line.trim()) {
                await sendMessage(line);
            }
            rl.prompt();
        });

        // Check for new messages every 3 seconds
        setInterval(fetchMessages, 3000);

    } catch (e) {
        console.log(chalk.red("Error: Could not connect to the orchestrator. Is it running?"));
        rl.close();
    }
});

