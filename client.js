import readline from 'readline';
import chalk from 'chalk';
import EventSource from 'eventsource';
import config from './config.js';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let userId = '';

async function sendMessage(message) {
    try {
        await fetch(`${config.ORCHESTRATOR_URL}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, message })
        });
    } catch (error) {
        console.log(chalk.red('Error: Could not send message to the orchestrator.'));
    }
}

function connectToServer() {
    const eventsUrl = `${config.ORCHESTRATOR_URL}/events/${userId}`;
    const es = new EventSource(eventsUrl);

    es.on('open', () => {
        console.log(chalk.green('Connection to orchestrator established.'));
    });

    es.on('message', (e) => {
        try {
            const data = JSON.parse(e.data);
            const msg = data.message;
            if (msg) {
                 if (msg.startsWith('[System]') || msg.startsWith('[Escalation]')) {
                    console.log(chalk.red.italic(msg));
                } else if (msg.startsWith('[Care Circle Update]')) {
                    console.log(chalk.blue.italic(msg));
                } else {
                    console.log(chalk.green(msg));
                }
                rl.prompt(true);
            }
        } catch (error) {
             console.error(chalk.red('Error parsing message from server:'), error);
        }
    });

    es.on('error', (err) => {
        console.error(chalk.red('Connection error. Attempting to reconnect...'));
        es.close();
        setTimeout(connectToServer, 5000); // Reconnect after 5 seconds
    });
}

function startChat() {
    rl.setPrompt(chalk.yellow(`${userId} > `));
    rl.prompt();

    rl.on('line', (line) => {
        const message = line.trim();
        if (message) {
            sendMessage(message);
        }
        rl.prompt();
    }).on('close', () => {
        console.log(chalk.bold('\nHave a great day!'));
        process.exit(0);
    });

    connectToServer();
}

rl.question('Enter your role (patient/caregiver/doctor): ', (role) => {
    userId = role.trim().toLowerCase();
    if (['patient', 'caregiver', 'doctor'].includes(userId)) {
        console.log(chalk.bold.green(`\nWelcome, ${userId}. You can start typing now.`));
        startChat();
    } else {
        console.log(chalk.red('Invalid role. Please restart and enter "patient", "caregiver", or "doctor".'));
        rl.close();
    }
});

