/**
 * @fileoverview CLI Command Executor
 * Executes CLI commands via child_process and streams output
 * Designed to avoid code duplication - runs actual CLI scripts
 */

function sanitizeOutput(text = '') {
    if (!text) return '';

    // Remove ANSI escape codes (colors, cursor moves, etc.)
    let sanitized = text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');

    // Remove OSC sequences (Operating System Command)
    sanitized = sanitized.replace(/\u001b\][0-9;]*.*?(\u0007|\u001b\\)/g, '');

    // Remove carriage returns and bell characters
    sanitized = sanitized.replace(/[\r\u0007]/g, '');

    return sanitized;
}

export class CommandExecutor {
    constructor(baseUrl = '') {
        this.baseUrl = baseUrl;
    }

    /**
     * Execute a CLI command via server proxy
     * @param {string} command - CLI command name (e.g., 'run-simulation', 'train', 'analyze')
     * @param {object} args - Command arguments
     * @param {function} onOutput - Callback for stdout chunks
     * @param {function} onError - Callback for stderr chunks
     * @returns {Promise<object>} Final result
     */
    async execute(command, args = {}, onOutput = null, onError = null) {
        try {
            const response = await fetch(`${this.baseUrl}/api/cli/${command}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args)
            });

            if (!response.ok) {
                throw new Error(`Command failed: ${response.status}`);
            }

            // Handle streaming response
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const data = JSON.parse(line);
                            if (data.type === 'stdout' && onOutput) {
                                const clean = sanitizeOutput(data.data);
                                if (clean) onOutput(clean);
                            } else if (data.type === 'stderr' && onError) {
                                const cleanErr = sanitizeOutput(data.data);
                                if (cleanErr) onError(cleanErr);
                            } else if (data.type === 'result') {
                                return data.data;
                            }
                        } catch (e) {
                            // Not JSON, treat as plain text
                            if (onOutput) {
                                const cleanLine = sanitizeOutput(line);
                                if (cleanLine) onOutput(cleanLine);
                            }
                        }
                    }
                }
            }

            // Try to parse final buffer as result
            if (buffer.trim()) {
                try {
                    const data = JSON.parse(buffer);
                    if (data.type === 'result') return data.data;
                } catch (e) {
                    // Not JSON
                }
            }

            return { success: true };
        } catch (error) {
            console.error(`[CommandExecutor] Error executing ${command}:`, error);
            throw error;
        }
    }

    /**
     * Execute command and return EventSource for real-time updates
     * @param {string} command - CLI command name
     * @param {object} args - Command arguments
     * @returns {EventSource} SSE connection
     */
    executeStream(command, args = {}) {
        const params = new URLSearchParams();
        Object.entries(args).forEach(([key, value]) => {
            params.append(key, String(value));
        });
        
        return new EventSource(`${this.baseUrl}/api/cli/${command}/stream?${params.toString()}`);
    }
}

export default CommandExecutor;

