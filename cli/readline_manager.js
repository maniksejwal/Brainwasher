#!/usr/bin/env node

/**
 * @fileoverview Centralized Readline Manager
 * Single readline interface for all CLI tools to prevent conflicts
 */

import readline from 'readline';
import chalk from 'chalk';

class ReadlineManager {
    constructor() {
        this.rl = null;
        this.isInitialized = false;
    }

    /**
     * Initialize readline interface (only once)
     */
    initialize() {
        if (this.isInitialized) return;
        
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
            historySize: 0
        });
        
        this.isInitialized = true;
        console.log('[ReadlineManager] Initialized');
    }

    /**
     * Ask a question and return the answer
     */
    async askQuestion(question, options = {}) {
        if (!this.isInitialized) {
            this.initialize();
        }

        const { color = 'yellow', required = false } = options;
        
        return new Promise((resolve) => {
            const coloredQuestion = color ? chalk[color](question) : question;
            this.rl.question(coloredQuestion, (answer) => {
                if (required && (!answer || answer.trim() === '')) {
                    console.log(chalk.red('❌ This field is required. Please try again.'));
                    this.askQuestion(question, options).then(resolve);
                } else {
                    resolve(answer);
                }
            });
        });
    }

    /**
     * Ask multiple questions in sequence
     */
    async askQuestions(questions) {
        const answers = {};
        
        for (const [key, question] of Object.entries(questions)) {
            answers[key] = await this.askQuestion(question.question, question.options || {});
        }
        
        return answers;
    }

    /**
     * Show a menu and get selection
     */
    async showMenu(title, options) {
        console.log(chalk.cyan.bold(`\n${title}`));
        console.log('-'.repeat(40));
        
        options.forEach((option, index) => {
            console.log(`${(index + 1).toString().padStart(2)}. ${option}`);
        });
        console.log('-'.repeat(40));

        const choice = await this.askQuestion(`\nSelect an option (1-${options.length}): `);
        const choiceNum = parseInt(choice);
        
        if (isNaN(choiceNum) || choiceNum < 1 || choiceNum > options.length) {
            console.log(chalk.red('❌ Invalid choice. Please try again.'));
            return await this.showMenu(title, options);
        }
        
        return choiceNum - 1; // Return 0-based index
    }

    /**
     * Confirm an action
     */
    async confirm(message, defaultYes = false) {
        const defaultText = defaultYes ? 'Y/n' : 'y/N';
        const answer = await this.askQuestion(`${message} (${defaultText}): `);
        
        if (!answer || answer.trim() === '') {
            return defaultYes;
        }
        
        return answer.toLowerCase().startsWith('y');
    }

    /**
     * Cleanup readline interface
     */
    cleanup() {
        if (this.rl && this.isInitialized) {
            this.rl.close();
            this.isInitialized = false;
            console.log('[ReadlineManager] Cleaned up');
        }
    }

    /**
     * Check if readline is available
     */
    isAvailable() {
        return this.isInitialized && this.rl && !this.rl.closed;
    }
}

// Export singleton instance
export const readlineManager = new ReadlineManager();

// Auto-cleanup on process exit
process.on('SIGINT', () => {
    readlineManager.cleanup();
    process.exit(0);
});

process.on('exit', () => {
    readlineManager.cleanup();
});
