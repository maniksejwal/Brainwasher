/**
 * @fileoverview Shared API Client
 * Works in BOTH Node.js (CLI) and Browser (GUI)
 * 
 * ELIMINATES code duplication between client/network.js and gui/app.js
 */

/**
 * Universal API Client for Care Circle System
 */
export class ApiClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    /**
     * Login user
     */
    async login(username) {
        try {
            const response = await fetch(`${this.baseUrl}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            if (!response.ok) {
                throw new Error(`Login failed: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('[ApiClient] Login error:', error.message);
            throw error;
        }
    }

    /**
     * Send regular message
     */
    async sendMessage(userId, circleId, message) {
        try {
            const response = await fetch(`${this.baseUrl}/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, circleId, message })
            });

            if (!response.ok) {
                throw new Error(`Send failed: ${response.status}`);
            }

            return { success: true };
        } catch (error) {
            console.error('[ApiClient] Send error:', error.message);
            throw error;
        }
    }

    /**
     * Send command
     */
    async sendCommand(userId, circleId, message) {
        try {
            const response = await fetch(`${this.baseUrl}/command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, circleId, message })
            });

            if (!response.ok) {
                throw new Error(`Command failed: ${response.status}`);
            }

            return { success: true };
        } catch (error) {
            console.error('[ApiClient] Command error:', error.message);
            throw error;
        }
    }

    /**
     * Get unread escalations (doctors)
     */
    async getUnreadEscalations(userId) {
        try {
            const response = await fetch(`${this.baseUrl}/doctor/escalations/unread/${userId}`);
            
            if (!response.ok) {
                throw new Error(`Fetch escalations failed: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('[ApiClient] Escalations error:', error.message);
            return [];
        }
    }

    /**
     * Get user's feedback history (GUI-specific, but works for CLI too)
     */
    async getFeedback(userId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/feedback/${userId}`);
            
            if (!response.ok) {
                throw new Error(`Fetch feedback failed: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('[ApiClient] Feedback fetch error:', error.message);
            return [];
        }
    }

    /**
     * Get detailed issue reports
     */
    async getDetailedFeedback(userId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/feedback/${userId}`);
            
            if (!response.ok) {
                throw new Error(`Fetch feedback failed: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('[ApiClient] Feedback error:', error.message);
            return [];
        }
    }

    /**
     * Get available scenarios
     */
    async getScenarios() {
        try {
            const response = await fetch(`${this.baseUrl}/api/scenarios`);
            
            if (!response.ok) {
                throw new Error(`Failed to load scenarios: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('[ApiClient] Scenarios error:', error.message);
            return { personas: {}, scenarios: {} };
        }
    }

    /**
     * Run simulation
     */
    async runSimulation(runs = 5, scenarioKey = 'random_single', turns = 3) {
        try {
            const response = await fetch(`${this.baseUrl}/api/simulate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ runs, scenario: scenarioKey, turns })
            });

            if (!response.ok) {
                throw new Error(`Simulation failed: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('[ApiClient] Simulation error:', error.message);
            throw error;
        }
    }

    /**
     * Generate analysis report
     */
    async generateAnalysis() {
        try {
            const response = await fetch(`${this.baseUrl}/api/analyze`, {
                method: 'POST'
            });

            if (!response.ok) {
                throw new Error(`Analysis failed: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('[ApiClient] Analysis error:', error.message);
            throw error;
        }
    }

    /**
     * Get conversation history
     */
    async getConversations(userId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/conversations/${userId}`);

            if (!response.ok) {
                throw new Error(`Failed to get conversations: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('[ApiClient] Conversations error:', error.message);
            throw error;
        }
    }

    /**
     * Get server logs
     */
    async getLogs(limit = 100) {
        try {
            const response = await fetch(`${this.baseUrl}/api/logs?limit=${limit}`);

            if (!response.ok) {
                throw new Error(`Failed to get logs: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('[ApiClient] Logs error:', error.message);
            throw error;
        }
    }

    /**
     * Get circle members
     */
    async getCircleMembers(userId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/circle/${userId}`);

            if (!response.ok) {
                throw new Error(`Failed to get circle: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('[ApiClient] Circle error:', error.message);
            throw error;
        }
    }

    /**
     * Create EventSource connection (works in both Node & Browser)
     * Note: In Node.js, requires 'eventsource' package
     * In browser, uses native EventSource
     */
    createEventSource(userId) {
        // Check environment
        if (typeof window === 'undefined') {
            // Node.js environment
            // Note: Caller should import EventSource from 'eventsource' package
            throw new Error('EventSource must be created by caller in Node.js environment');
        } else {
            // Browser environment - native EventSource
            return new EventSource(`${this.baseUrl}/events/${userId}`);
        }
    }

    /**
     * Helper: Get event source URL
     */
    getEventSourceUrl(userId) {
        return `${this.baseUrl}/events/${userId}`;
    }
}

export default ApiClient;

