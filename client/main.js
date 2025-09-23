/**
 * @fileoverview client/main.js
 * The main entry point for the command-line client application.
 */

import chalk from 'chalk';
import { state, updateUserState } from './state.js';
import { rl, updatePrompt, showLoginMessage } from './ui.js';
import { login, connectToEventSource, sendCommand, sendMessage } from './network.js';

async function main() {
    const username = await new Promise(resolve => {
        rl.question(chalk.bold('Enter your username: '), (answer) => {
            resolve(answer.toLowerCase().trim());
        });
    });
    updateUserState({ username });

    const loggedIn = await login();
    if (!loggedIn) {
        rl.close();
        return;
    }

    connectToEventSource();
    updatePrompt();

    rl.on('line', (line) => {
        const trimmedLine = line.trim();
        // FIX: Route both natural language and command-based consent to the command endpoint
        // to be handled by the state manager.
        if (trimmedLine.startsWith('/') || ['yes', 'no', 'go', 'proceed'].includes(trimmedLine.toLowerCase())) {
            let messageToSend = trimmedLine;
            if (['yes', 'go', 'proceed'].includes(trimmedLine.toLowerCase())) {
                messageToSend = '/yes';
            } else if (trimmedLine.toLowerCase() === 'no') {
                messageToSend = '/no';
            }
            sendCommand(messageToSend);
        } else {
            sendMessage(trimmedLine);
        }
        rl.prompt();
    });
}

main();

