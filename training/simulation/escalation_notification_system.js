/**
 * @fileoverview Escalation Notification System
 * Automatically notifies caregivers and doctors when escalations occur
 */

import { events } from '../../orchestrator.js';
import { getCircleMembers, findUserById, getUnreadEscalationsForCircle } from '../../db/index.js';
import { makeApiCall } from '../../agents/api_client.js';

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
            // Prevent duplicate notifications for the same circle
            const notificationKey = `escalation_${circleId}`;
            if (this.recentNotifications && this.recentNotifications.has(notificationKey)) {
                return; // Skip if we already notified for this circle recently
            }
            
            // Initialize recent notifications tracking if not exists
            if (!this.recentNotifications) {
                this.recentNotifications = new Set();
            }
            
            // Mark this circle as notified
            this.recentNotifications.add(notificationKey);
            
            // Clear the notification after 5 seconds to allow future notifications
            setTimeout(() => {
                this.recentNotifications.delete(notificationKey);
            }, 5000);

            const members = await getCircleMembers(circleId);
            if (!members || members.length === 0) {
                console.warn(`[EscalationNotificationSystem] No members found for circle ${circleId}`);
                return;
            }

            // Find caregivers and doctors to notify for escalations
            const caregivers = members.filter(m => m.role === 'caregiver');
            const doctors = members.filter(m => m.role === 'doctor');
            
            const usersToNotify = [...caregivers, ...doctors];
            
            // Patient notifications will be handled separately for cross-communication
            
            if (usersToNotify.length === 0) {
                console.log(`[EscalationNotificationSystem] No caregivers or doctors to notify in circle ${circleId}`);
                return;
            }

            // Get patient info for context
            const patient = members.find(m => m.role === 'patient');
            const patientInfo = patient ? await findUserById(patient.user_id) : null;
            const patientName = patientInfo ? patientInfo.username : 'Patient';

            // Get escalation details for context-aware notification
            const escalations = await getUnreadEscalationsForCircle(circleId);
            const latestEscalation = escalations.length > 0 ? escalations[0] : null;

            // Generate context-aware notification message using LLM
            let notificationMessage;
            if (latestEscalation) {
                notificationMessage = await this.generateContextualNotification(patientName, latestEscalation);
            } else {
                notificationMessage = `📋 ${patientName} has requested assistance. Please check for updates.`;
            }

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
     * Generate context-aware notification message using LLM
     */
    async generateContextualNotification(patientName, escalation) {
        try {
            const prompt = `Generate a brief, professional notification message for caregivers/doctors about a patient escalation.

Patient: ${patientName}
Escalation Type: ${escalation.type}
Details: ${escalation.details}

Guidelines:
- Use appropriate urgency level based on escalation type (CRITICAL = urgent, INFO = routine)
- Be specific about what happened without revealing sensitive details
- Use professional, caring tone
- Keep it concise (1-2 sentences)
- Use appropriate emoji (🚨 for urgent, 📋 for routine)

Examples:
- CRITICAL: "🚨 ${patientName} has reported chest pain and needs immediate medical attention."
- INFO: "📋 ${patientName} has requested to schedule a doctor consultation."
- CONFLICT: "⚠️ There's conflicting information about ${patientName}'s condition that needs clarification."

Generate notification:`;

            const response = await makeApiCall(prompt, [], false, 0.3);
            return response.reply || `📋 ${patientName} has requested assistance. Please check for updates.`;
        } catch (error) {
            console.warn('[EscalationNotificationSystem] Failed to generate contextual notification:', error.message);
            // Fallback to basic notification
            const urgencyEmoji = escalation.type === 'CRITICAL' ? '🚨' : '📋';
            return `${urgencyEmoji} ${patientName} has requested assistance. Please check for updates.`;
        }
    }

    /**
     * Cleanup event listeners
     */
    cleanup() {
        if (this.isInitialized) {
            events.removeAllListeners('escalate');
            this.isInitialized = false;
            // Suppress cleanup logs unless in debug mode
            if (process.env.SIMULATION_DEBUG === 'true') {
                console.log('[EscalationNotificationSystem] Cleaned up event listeners');
            }
        }
    }
}

// Export singleton instance
export const escalationNotificationSystem = new EscalationNotificationSystem();
