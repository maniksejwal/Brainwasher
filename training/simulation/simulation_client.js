/**
 * @fileoverview Simulation Client
 * Mimics the behavior of real clients (doctor_client.js, caregiver_client.js) for simulations
 * This provides better code reuse by using the same event system as the real system
 */

import { events } from '../../orchestrator.js';
import { getCircleMembers, findUserById } from '../../db/index.js';
import chalk from 'chalk';

export class SimulationClient {
    constructor(userId, role) {
        this.userId = userId;
        this.role = role;
        this.isInitialized = false;
        this.notifications = [];
        this.lastResponseTime = 0; // Debounce responses
        this.responseCooldown = 5000; // 5 seconds between responses
        this.hasRecentNotificationResponse = false; // Track if user recently responded to notification
    }

    /**
     * Initialize client to listen for broadcasts and escalations
     */
    initialize() {
        if (this.isInitialized) return;
        
        // Listen for broadcasts targeted to this user
        events.on('broadcast', (data) => {
            if (data.targetUsers && data.targetUsers.includes(this.userId)) {
                this.handleNotification(data);
            }
        });
        
        this.isInitialized = true;
        // Suppress initialization logs unless in debug mode
        if (process.env.SIMULATION_DEBUG === 'true') {
            console.log(`[SimulationClient] ${this.role} client initialized for user ${this.userId}`);
        }
    }

    /**
     * Handle incoming notifications/broadcasts
     */
    handleNotification(data) {
        const message = data.message || data.reply || '';
        
        // Simple rule: Only show notifications from 'system' (escalation notifications)
        // Skip agent replies (they're already shown as AGENT: messages)
        if (data.from !== 'system') {
            return; // Skip non-system notifications
        }
        
        // Only show escalation notifications (contain urgent/critical keywords)
        const messageLower = message.toLowerCase();
        if (!messageLower.includes('urgent') && 
            !messageLower.includes('critical') &&
            !messageLower.includes('escalated') &&
            !messageLower.includes('🚨')) {
            return; // Skip non-escalation messages
        }
        
        const notification = {
            timestamp: Date.now(),
            from: data.from,
            message: message,
            circleId: data.circleId,
            type: this._detectNotificationType(message)
        };
        
        this.notifications.push(notification);
        
        console.log(`📱 ${this.role.toUpperCase()}: ${notification.message}`);
        
        // For simulations, trigger automatic responses to notifications
        this._generateNotificationResponse(notification);
    }

    /**
     * Detect notification type based on message content
     */
    _detectNotificationType(message) {
        const messageLower = message.toLowerCase();
        
        // Only treat escalation-related messages as notifications
        if (messageLower.includes('escalated') || 
            messageLower.includes('urgent') || 
            messageLower.includes('critical') ||
            messageLower.includes('emergency') ||
            messageLower.includes('immediate attention')) {
            return 'escalation_notification';
        }
        
        if (messageLower.includes('conflict') || messageLower.includes('disagreement')) {
            return 'conflict_notification';
        }
        
        if (messageLower.includes('mediation') || messageLower.includes('clarification')) {
            return 'mediation_notification';
        }
        
        // Regular agent responses are NOT notifications
        return 'conversation';
    }

    /**
     * Get all notifications received by this client
     */
    getNotifications() {
        return this.notifications;
    }

    /**
     * Clear notifications
     */
    clearNotifications() {
        this.notifications = [];
    }

    /**
     * Generate automatic response to notification
     */
    async _generateNotificationResponse(notification) {
        // Debounce responses to prevent duplicates
        const now = Date.now();
        if (now - this.lastResponseTime < this.responseCooldown) {
            return; // Skip if too soon after last response
        }
        
        try {
            // Import makeApiCall for generating responses
            const { makeApiCall } = await import('../../agents/api_client.js');
            
            // Create response based on notification type and role
            const responsePrompt = this._createResponsePrompt(notification);
            
            if (responsePrompt) {
                const response = await makeApiCall(responsePrompt, [], false, 0.7, 50);
                
                if (response && response.reply) {
                    // Don't emit broadcast - just display the response directly
                    // This prevents duplicate responses in the conversation flow
                    
                    this.lastResponseTime = now; // Update last response time
                    this.hasRecentNotificationResponse = true; // Mark as having recent notification response
                    
                    // Clear the flag after a short delay to allow regular conversation to resume
                    setTimeout(() => {
                        this.hasRecentNotificationResponse = false;
                    }, 10000); // 10 seconds
                    
                    console.log(`    ${chalk.bold(`${this.role.toUpperCase()} [${this.persona?.name || 'User'}]`)}: ${response.reply}`);
                }
            }
        } catch (error) {
            console.warn(`[SimulationClient] Failed to generate notification response: ${error.message}`);
        }
    }

    /**
     * Create response prompt based on notification type and role
     */
    _createResponsePrompt(notification) {
        const { type, message } = notification;
        
        if (this.role === 'caregiver') {
            if (type === 'escalation_notification') {
                return `You are a caregiver who just received an escalation notification: "${message}". Respond appropriately as a concerned caregiver. Keep response brief (1-2 sentences).`;
            } else if (type === 'conflict_notification') {
                return `You are a caregiver who just received a conflict notification: "${message}". Respond to help resolve the conflict. Keep response brief (1-2 sentences).`;
            }
        } else if (this.role === 'doctor') {
            if (type === 'escalation_notification') {
                return `You are a doctor who just received an escalation notification: "${message}". Respond with medical guidance. Keep response brief (1-2 sentences).`;
            }
        }
        
        return null; // No response needed
    }

    /**
     * Cleanup event listeners
     */
    cleanup() {
        if (this.isInitialized) {
            events.removeAllListeners('broadcast');
            this.isInitialized = false;
            // Suppress cleanup logs unless in debug mode
            if (process.env.SIMULATION_DEBUG === 'true') {
                console.log(`[SimulationClient] ${this.role} client cleaned up`);
            }
        }
    }
}

/**
 * Simulation Client Manager
 * Manages multiple simulation clients for different users
 */
export class SimulationClientManager {
    constructor() {
        this.clients = new Map();
    }

    /**
     * Create and initialize a client for a user
     */
    createClient(userId, role) {
        if (this.clients.has(userId)) {
            return this.clients.get(userId);
        }
        
        const client = new SimulationClient(userId, role);
        client.initialize();
        this.clients.set(userId, client);
        
        return client;
    }

    /**
     * Get client for a user
     */
    getClient(userId) {
        return this.clients.get(userId);
    }

    /**
     * Get all clients
     */
    getAllClients() {
        return Array.from(this.clients.values());
    }

    /**
     * Cleanup all clients
     */
    cleanup() {
        for (const client of this.clients.values()) {
            client.cleanup();
        }
        this.clients.clear();
        // Suppress cleanup logs unless in debug mode
        if (process.env.SIMULATION_DEBUG === 'true') {
            console.log('[SimulationClientManager] All clients cleaned up');
        }
    }
}

// Export singleton instance
export const simulationClientManager = new SimulationClientManager();