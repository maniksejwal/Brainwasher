import chalk from 'chalk';
import config from '../../config.js';

// A helper class to manage the state of a simulated user
class TestUser {
    constructor(username, userId, activeCircleId, runner) {
        this.username = username;
        this.userId = userId;
        this.activeCircleId = activeCircleId;
        this.runner = runner;
    }

    async sendMessage(message) {
        return this.runner.send('send', {
            userId: this.userId,
            circleId: this.activeCircleId,
            message
        });
    }

    async sendCommand(command) {
        // The server returns the response via the event stream, so we need to listen for it.
        return new Promise(async (resolve) => {
            const listener = (event) => {
                if (event.type === 'message' || event.type === 'context_switched') {
                    this.runner.removeListener(listener);
                    if (event.type === 'context_switched') {
                        this.activeCircleId = event.newCircleId;
                    }
                    resolve(event.reply || event.message || `Switched context to circle for patient: ${event.newCircleId}`);
                }
            };
            this.runner.addListener(listener);
            await this.runner.send('command', {
                userId: this.userId,
                circleId: this.activeCircleId,
                message: command
            });
        });
    }
}


export class TestRunner {
    constructor() {
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
        this.eventListeners = [];
    }

    addListener(listener) {
        this.eventListeners.push(listener);
    }

    removeListener(listener) {
        this.eventListeners = this.eventListeners.filter(l => l !== listener);
    }

    async clearDb() {
        await this.send('command', { userId: 'test-runner', circleId: 'test-runner', message: '/clear' });
    }

    async loginAs(username) {
        const res = await fetch(`${config.ORCHESTRATOR_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username }),
        });
        const data = await res.json();
        const user = new TestUser(username, data.userId, data.activeCircleId, this);
        // We don't need a persistent event source for the test runner itself,
        // but we'll simulate receiving events via the `sendCommand` promise listener.
        return user;
    }

    async send(endpoint, body) {
        try {
            await fetch(`${config.ORCHESTRATOR_URL}/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            // We need a small delay to allow the server to process and broadcast the event.
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (e) {
            console.error(chalk.red(`[TestRunner] Failed to send request to ${endpoint}`), e);
        }
    }

    async runTest(name, testFn) {
        const assert = {
            ok: (value, message) => {
                if (!value) throw new Error(message || 'Assertion failed: value is not truthy');
            },
            equal: (actual, expected, message) => {
                if (actual !== expected) throw new Error(message || `Assertion failed: expected ${expected} but got ${actual}`);
            },
        };

        try {
            await testFn(assert);
            console.log(chalk.green(`� ${name}`));
            this.passed++;
        } catch (error) {
            console.error(chalk.red(`� ${name}`));
            console.error(chalk.gray(`  ${error.message}`));
            this.failed++;
        }
    }

    reportResults() {
        console.log('\n--- Test Results ---');
        console.log(chalk.green(`Passed: ${this.passed}`));
        console.log(chalk.red(`Failed: ${this.failed}`));
        if (this.failed > 0) {
            process.exit(1); // Exit with error code if any tests failed
        }
    }
}

