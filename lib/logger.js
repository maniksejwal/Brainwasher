/**
 * @fileoverview Logger Utility
 * Captures console logs for display in the GUI.
 */

const logBuffer = [];
const MAX_LOGS = 200;

const ANSI_ESCAPE_REGEX = /\u001b\[[0-9;]*m/g;

function sanitizeCLIOutput(text = '') {
    return text
        .replace(ANSI_ESCAPE_REGEX, '')
        .replace(/\r/g, '')
        .replace(/\u0007/g, '');
}

const originalLog = console.log;
const originalError = console.error;

export function setupLogger() {
    console.log = (...args) => {
        const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
        logBuffer.push({ timestamp: Date.now(), level: 'info', message });
        if (logBuffer.length > MAX_LOGS) logBuffer.shift();
        originalLog(...args);
    };

    console.error = (...args) => {
        const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
        logBuffer.push({ timestamp: Date.now(), level: 'error', message });
        if (logBuffer.length > MAX_LOGS) logBuffer.shift();
        originalError(...args);
    };

    // Initial log
    console.log('[Logger] Logger initialized');
}

export function getLogs(limit = 100) {
    const safeLimit = Math.min(limit, MAX_LOGS);
    return logBuffer.slice(-safeLimit);
}

// Export for CLI usage if needed
export { sanitizeCLIOutput };
