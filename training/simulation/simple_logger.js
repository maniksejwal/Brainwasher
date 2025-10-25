/**
 * Simple logging utility for simulations
 * Reduces log noise while keeping important information
 */

class SimpleLogger {
    constructor() {
        this.enabled = process.env.SIMULATION_DEBUG !== 'true'; // Enable by default unless debug mode
        this.suppressedPrefixes = [
            '[Agent] OpenAI request successful',
            '[Agent] Gemini request successful',
            '[SimulationClient]',
            '[EscalationNotificationSystem]',
            '[ReadlineManager]',
            '[Simulator] Cleanup complete'
        ];
    }

    log(message, level = 'info') {
        if (!this.enabled) return;
        
        // Suppress verbose logs
        if (this.suppressedPrefixes.some(prefix => message.includes(prefix))) {
            return;
        }
        
        // Format based on level
        const timestamp = new Date().toISOString().substr(11, 8);
        const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
        
        console.log(`${prefix} [${timestamp}] ${message}`);
    }

    error(message) {
        this.log(message, 'error');
    }

    warn(message) {
        this.log(message, 'warn');
    }

    info(message) {
        this.log(message, 'info');
    }

    // Enable/disable logging
    enable() {
        this.enabled = true;
    }

    disable() {
        this.enabled = false;
    }
}

export const logger = new SimpleLogger();
