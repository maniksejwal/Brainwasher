import readline from 'readline';
import chalk from 'chalk';
import EventSource from 'eventsource';
import config from './config.js';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let userId = '';
let userRole = '';

async function main() {
    userRole = await new Promise(resolve => {
        rl.question(chalk.bold('Enter your role (patient/caregiver/doctor): '), (answer) => {
            // Use the role as the user ID for this simple prototype
            userId = answer.toLowerCase();
            resolve(answer.toLowerCase());
        });
    });

    try {
        await fetch(`${config.ORCHESTRATOR_URL}/user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, role: userRole }),
        });
        console.log(chalk.green(`Welcome, ${userId}. You are the ${userRole}.`));
        console.log(chalk.gray('You can start typing now.'));
        rl.prompt();
    } catch (error) {
        console.error(chalk.red('Error registering user:', error.message));
        rl.close();
        return;
    }

    const es = new EventSource(`${config.ORCHESTRATOR_URL}/events`);

    es.on('message', async (e) => {
        const data = JSON.parse(e.data);

        if (data.type === 'message') {
            const { targetUsers, reply, from, message } = data;
            if (targetUsers.includes(userId)) {
                const prefix = chalk.bold.blue(`[${from}]:`);
                const content = reply || message;
                process.stdout.write(`\r${' '.repeat(rl.line.length)}\r`); // Clear current line
                console.log(`${prefix} ${content}`);
                rl.prompt();
            }
        } else if (data.type === 'escalation' && userRole === 'doctor') {
            // ** FIX: Doctor client now fetches details after getting the ping **
            try {
                const response = await fetch(`${config.ORCHESTRATOR_URL}/doctor/escalations/unread`);
                const escalations = await response.json();
                if (escalations && escalations.length > 0) {
                    process.stdout.write(`\r${' '.repeat(rl.line.length)}\r`);
                    console.log(chalk.red.bold(`\n--- NEW ESCALATIONS RECEIVED ---`));
                    escalations.forEach(item => {
                        const message = `[${new Date(item.timestamp).toLocaleString()}] ${item.type}: ${item.details}`;
                        console.log(chalk.yellow(message));
                    });
                    console.log(chalk.red.bold(`------------------------------`));
                    rl.prompt();
                }
            } catch (error) {
                 console.error(chalk.red('Error fetching escalations:', error.message));
            }
        }
    });

    es.on('error', (err) => {
        process.stdout.write(`\r${' '.repeat(rl.line.length)}\r`);
        console.log(chalk.red('Connection error. Attempting to reconnect...'));
        rl.prompt();
    });

    rl.on('line', (line) => {
        sendMessage(line);
        rl.prompt();
    });
}

async function sendMessage(message) {
    try {
        await fetch(`${config.ORCHESTRATOR_URL}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, role: userRole, message }),
        });
    } catch (error) {
        console.error(chalk.red('Error sending message:', error.message));
    }
}

main();

