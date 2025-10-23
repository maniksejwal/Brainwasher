/**
 * @fileoverview Simulation Client
 * Mimics the behavior of real clients (doctor_client.js, caregiver_client.js) for simulations
 * This provides better code reuse by using the same event system as the real system
 */

import { events } from '../../orchestrator.js';
import { getCircleMembers, findUserById } from '../../db/index.js';

export class SimulationClient {
    constructor(userId, role) {
        this.userId = userId;
        this.role = role;
        this.isInitialized = false;
        this.notifications = [];
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
        console.log(`[SimulationClient] ${this.role} client initialized for user ${this.userId}`);
    }

    /**
     * Handle incoming notifications/broadcasts
     */
    handleNotification(data) {
        const notification = {
            timestamp: Date.now(),
            from: data.from,
            message: data.message || data.reply,
            circleId: data.circleId,
            type: data.type || 'general'
        };
        
        this.notifications.push(notification);
        
        // Log the notification
        console.log(`📱 [SimulationClient] ${this.role.toUpperCase()} ${this.userId} received notification: ${notification.message.substring(0, 50)}...`);
        
        // For simulations, we could trigger automatic responses here
        // For now, we just log and store the notification
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
     * Cleanup event listeners
     */
    cleanup() {
        if (this.isInitialized) {
            events.removeAllListeners('broadcast');
            this.isInitialized = false;
            console.log(`[SimulationClient] ${this.role} client cleaned up`);
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
        console.log('[SimulationClientManager] All clients cleaned up');
    }
}

// Export singleton instance
export const simulationClientManager = new SimulationClientManager();