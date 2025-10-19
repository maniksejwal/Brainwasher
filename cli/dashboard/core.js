/**
 * @fileoverview Dashboard Core Module
 * Core functionality for the simulation dashboard
 */

import { getDb } from '../../db/connection.js';
import readline from 'readline';

export class DashboardCore {
    constructor() {
        this.db = null;
        this.rl = null;
    }

    async initialize() {
        // Set simulation mode for dashboard operations
        process.env.SIMULATION_MODE = 'true';
        
        this.db = await getDb();
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
            historySize: 0
        });
    }

    cleanup() {
        if (this.rl) {
            this.rl.close();
        }
    }

    async askQuestion(question) {
        return new Promise((resolve) => {
            this.rl.question(question, resolve);
        });
    }

    getDb() {
        return this.db;
    }

    getReadline() {
        return this.rl;
    }
}
