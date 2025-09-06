import readline from 'readline';
import chalk from 'chalk';
import config from './config.js'; // Correctly import the default config object

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let userId = '';

async function sendMessage(message) {
    try {
        await fetch(`${config.ORCHESTRATOR_URL}/send`, { // Access URL from the object
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, message })
        });
    } catch (error) {
        console.log(chalk.red('Error: Could not send message to the orchestrator.'));
    }
}

async function fetchMessages() {
    try {
        const response = await fetch(`${config.ORCHESTRATOR_URL}/fetch/${userId}`); // Access URL from the object
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

            for (const line of lines) {
                const data = line.replace(/^data: /, '');
                try {
                    const json = JSON.parse(data);
                    if (json.messages && Array.isArray(json.messages)) {
                        json.messages.forEach(msg => {
                            if (msg.startsWith('[System]')) {
                                console.log(chalk.gray(msg));
                            } else if (msg.startsWith('[Care Circle Update]')) {
                                console.log(chalk.blue(msg));
                            } else {
                                console.log(chalk.green(msg));
                            }
                            rl.prompt(true);
                        });
                    }
                } catch (e) {
                    // Ignore parsing errors for incomplete streams
                }
            }
        }
    } catch (error) {
        // This will happen on close, it's okay.
    }
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

    fetchMessages();
}

rl.question('Enter your role (patient/caregiver): ', (role) => {
    userId = role.trim().toLowerCase();
    if (userId === 'patient' || userId === 'caregiver') {
        console.log(chalk.bold.green(`\nWelcome, ${userId}. You can start typing now.`));
        startChat();
    } else {
        console.log(chalk.red('Invalid role. Please restart and enter "patient" or "caregiver".'));
        rl.close();
    }
});


