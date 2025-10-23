/**
 * @fileoverview Escalation Notification System
 * Automatically notifies caregivers and doctors when escalations occur
 */

import { events } from '../../orchestrator.js';
import { getCircleMembers, findUserById } from '../../db/index.js';

export class EscalationNotificationSystem {
    constructor() {
        this.isInitialized = false;
    }

    /**
     * Initialize escalation notification system
     */
    initialize() {
        if (this.isInitialized) return;
        
        // Listen for escalation events and automatically notify caregivers/doctors
        events.on('escalate', async (data) => {
            await this.handleEscalation(data.circleId);
        });
        
        this.isInitialized = true;
        // Suppress initialization logs unless in debug mode
        if (process.env.SIMULATION_DEBUG === 'true') {
            console.log('[EscalationNotificationSystem] Initialized - will auto-notify caregivers/doctors on escalations');
        }
    }

    /**
     * Handle escalation by notifying all caregivers and doctors in the circle
     */
    async handleEscalation(circleId) {
        try {
            const members = await getCircleMembers(circleId);
            if (!members || members.length === 0) {
                console.warn(`[EscalationNotificationSystem] No members found for circle ${circleId}`);
                return;
            }

            // Find caregivers and doctors to notify
            const caregivers = members.filter(m => m.role === 'caregiver');
            const doctors = members.filter(m => m.role === 'doctor');
            
            const usersToNotify = [...caregivers, ...doctors];
            
            if (usersToNotify.length === 0) {
                console.log(`[EscalationNotificationSystem] No caregivers or doctors to notify in circle ${circleId}`);
                return;
            }

            // Get patient info for context
            const patient = members.find(m => m.role === 'patient');
            const patientInfo = patient ? await findUserById(patient.user_id) : null;
            const patientName = patientInfo ? patientInfo.username : 'Patient';

            // Create notification message
            const notificationMessage = `🚨 URGENT: ${patientName} has reported symptoms that require immediate attention. Please check the escalation details and respond accordingly.`;

            // Broadcast to all caregivers and doctors
            events.emit('broadcast', {
                targetUsers: usersToNotify.map(u => u.user_id),
                message: notificationMessage,
                from: 'system',
                circleId,
                type: 'escalation_notification'
            });

            // Suppress notification count logs unless in debug mode
            if (process.env.SIMULATION_DEBUG === 'true') {
                console.log(`📢 [EscalationNotificationSystem] Notified ${usersToNotify.length} users (${caregivers.length} caregivers, ${doctors.length} doctors) about escalation in circle ${circleId}`);
            }

        } catch (error) {
            console.error('[EscalationNotificationSystem] Error handling escalation:', error.message);
        }
    }

    /**
     * Cleanup event listeners
     */
    cleanup() {
        if (this.isInitialized) {
            events.removeAllListeners('escalate');
            this.isInitialized = false;
            console.log('[EscalationNotificationSystem] Cleaned up event listeners');
        }
    }
}

// Export singleton instance
export const escalationNotificationSystem = new EscalationNotificationSystem();
