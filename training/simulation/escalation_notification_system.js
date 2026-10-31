/**
 * @fileoverview Escalation Notification System
 * Automatically notifies caregivers and doctors when escalations occur
 */

import { events } from '../../orchestrator.js';
import { findUserById, getEscalationById } from '../../db/index.js';
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
        
        // Listen for escalation events and notify the escalation's recipients
        events.on('escalate', async (data) => {
            await this.handleEscalation(data);
        });
        
        this.isInitialized = true;
        // Suppress initialization logs unless in debug mode
        if (process.env.SIMULATION_DEBUG === 'true') {
            console.log('[EscalationNotificationSystem] Initialized - will notify escalation recipients');
        }
    }

    /**
     * Send a readable notice about one escalation to the users it was sent to.
     * The event lists the recipients; nobody else in the circle is told.
     * @param {{circleId: string, escalationId: number, recipients: string[]}} data
     */
    async handleEscalation({ circleId, escalationId, recipients = [] }) {
        try {
            if (recipients.length === 0) {
                console.error(`[EscalationNotificationSystem] Escalation ${escalationId} has no recipients; not notifying anyone`);
                return;
            }

            const escalation = await getEscalationById(escalationId);
            if (!escalation) {
                console.warn(`[EscalationNotificationSystem] Escalation ${escalationId} not found`);
                return;
            }

            const patient = escalation.patient_id ? await findUserById(escalation.patient_id) : null;
            // Anonymous consultations name no patient
            const anonymous = ['ANONYMOUS_CONSULTATION', 'CONSULT'].includes(escalation.type);
            const patientName = patient && !anonymous ? patient.username : 'A patient';
            const notificationMessage = await this.generateContextualNotification(patientName, escalation);

            events.emit('broadcast', {
                targetUsers: recipients,
                message: notificationMessage,
                from: 'system',
                circleId,
                type: 'escalation_notification'
            });

            // Suppress notification count logs unless in debug mode
            if (process.env.SIMULATION_DEBUG === 'true') {
                console.log(`📢 [EscalationNotificationSystem] Notified ${recipients.length} recipients about escalation ${escalationId} in circle ${circleId}`);
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
