/**
 * @fileoverview Simulation Event Handler
 * Handles events emitted by the real system during simulation
 */

import { events } from '../../orchestrator.js';

export class SimulationEventHandler {
    constructor() {
        this.escalations = [];
        this.broadcasts = [];
        this.mediations = [];
    }

    /**
     * Initialize event listeners for simulation
     */
    initialize() {
        // Listen for escalation events
        events.on('escalate', (data) => {
            console.log(`🚨 [Simulation] ESCALATION: ${JSON.stringify(data)}`);
            this.escalations.push({
                timestamp: Date.now(),
                circleId: data.circleId,
                type: 'escalation'
            });
        });

        // Listen for broadcast events (notifications)
        events.on('broadcast', (data) => {
            console.log(`📢 [Simulation] BROADCAST: ${data.targetUsers?.length || 0} users notified`);
            this.broadcasts.push({
                timestamp: Date.now(),
                targetUsers: data.targetUsers,
                message: data.message,
                from: data.from,
                circleId: data.circleId
            });
        });

        // Listen for analysis progress
        events.on('analysis_progress', (data) => {
            // Just log, don't store
            console.log(`🔄 [Simulation] Analysis: ${data.description}`);
        });
    }

    /**
     * Get escalation events
     */
    getEscalations() {
        return this.escalations;
    }

    /**
     * Get broadcast events
     */
    getBroadcasts() {
        return this.broadcasts;
    }

    /**
     * Get mediation events
     */
    getMediations() {
        return this.mediations;
    }

    /**
     * Check if escalation occurred
     */
    hasEscalation() {
        return this.escalations.length > 0;
    }

    /**
     * Check if caregiver was notified
     */
    wasCaregiverNotified() {
        return this.broadcasts.some(broadcast => 
            broadcast.targetUsers.some(userId => userId.includes('caregiver'))
        );
    }

    /**
     * Clear all events
     */
    clear() {
        this.escalations = [];
        this.broadcasts = [];
        this.mediations = [];
    }

    /**
     * Remove event listeners
     */
    cleanup() {
        events.removeAllListeners('escalate');
        events.removeAllListeners('broadcast');
        events.removeAllListeners('analysis_progress');
    }
}
