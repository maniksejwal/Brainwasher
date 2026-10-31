/**
 * @fileoverview services/escalationService.js
 * The one place patient-safety escalations are created: HIGH emergencies, doctor
 * requests and the escalation tiers. Routine inbox rows (INFO, FACT_REPORT, CONFLICT,
 * CONSULT) are written directly with addEscalation and do not come through here.
 *
 * For each escalation the service:
 *  1. creates at most one escalation row per message;
 *  2. finds recipients from circle membership (doctors, then caregivers);
 *  3. sends to each recipient through the in-app channel, with a bounded wait;
 *  4. records each delivery;
 *  5. returns an action result that replies are built from.
 *
 * The in-app channel is the only real one (no SMS). A delivery is "delivered" when the
 * recipient had the app open at send time, "pending" when it waits in their inbox, and
 * "failed" when it could not be stored.
 */

import {
    addEscalationOnce,
    addEscalationDelivery,
    getEscalationDeliveries,
    getCircleMembers
} from '../db/index.js';
import { events } from '../orchestrator.js';
import { notificationService } from '../notifications/NotificationService.js';
import { getAgentName } from '../handlers/utils/agentIdentity.js';

// Escalation types created by this service. A message gets at most one of them.
export const SAFETY_ESCALATION_TYPES = [
    'CRITICAL',
    'DOCTOR_REQUEST',
    'CAREGIVER_NOTIFICATION',
    'ANONYMOUS_CONSULTATION',
    'CONSULTATION'
];

export const SEND_TIMEOUT_MS = 5000;

/**
 * Wait for a send, or report it as failed after the timeout.
 */
async function sendWithTimeout(sendPromise, timeoutMs) {
    let timer;
    const timeout = new Promise(resolve => {
        timer = setTimeout(() => resolve({ channel: 'in_app', status: 'failed', providerMessageId: null, error: 'timeout' }), timeoutMs);
    });
    try {
        return await Promise.race([sendPromise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Turn delivery rows into the action record checked by utils/actionClaimGuard.js.
 * Failed deliveries are never counted as reaching anyone.
 */
export function toActionRecord(deliveries, { doctorsWanted, circleHasDoctor, anonymous = false }) {
    const reached = deliveries.filter(d => d.status === 'delivered' || d.status === 'pending');
    const record = {
        escalationCreated: true,
        doctors: reached.filter(d => d.role === 'doctor').map(d => d.username),
        caregiversAlerted: reached.filter(d => d.role === 'caregiver').map(d => d.username),
        failedRecipients: deliveries.filter(d => d.status === 'failed').map(d => d.username),
        noDoctorConnected: doctorsWanted && !circleHasDoctor
    };
    if (anonymous) record.anonymousConsultation = true;
    return record;
}

/**
 * Create a patient-safety escalation and send it to its recipients.
 * @param {object} params
 * @param {string} params.circleId - Circle the escalation belongs to
 * @param {string} params.userId - User whose message caused it
 * @param {string} params.type - One of SAFETY_ESCALATION_TYPES
 * @param {string} params.details - Escalation details (shown to doctors)
 * @param {number|null} [params.messageId] - The message that caused it
 * @param {boolean} [params.notifyDoctors] - Send to the circle's doctors
 * @param {boolean} [params.notifyCaregivers] - Send to the circle's caregivers (not the speaker)
 * @param {string} [params.caregiverMessage] - Text sent to caregivers
 * @param {string} [params.patientUsername] - Patient the circle belongs to
 * @param {boolean} [params.anonymous] - The doctor sees no patient identity
 * @param {object} [params.eventDetails] - Extra fields for the `escalate` event
 * @param {number} [params.timeoutMs] - Longest wait for each send
 * @returns {Promise<{escalationId: number, duplicate: boolean, deliveries: object[], doctorReached: boolean, actions: object}>}
 */
export async function escalate({
    circleId,
    userId,
    type,
    details,
    messageId = null,
    notifyDoctors = true,
    notifyCaregivers = false,
    caregiverMessage = null,
    patientUsername = null,
    anonymous = false,
    eventDetails = {},
    timeoutMs = SEND_TIMEOUT_MS
}) {
    if (!SAFETY_ESCALATION_TYPES.includes(type)) {
        throw new Error(`[EscalationService] Unknown escalation type: ${type}`);
    }

    const members = await getCircleMembers(circleId);
    const doctors = notifyDoctors ? members.filter(m => m.role === 'doctor') : [];
    const caregivers = notifyCaregivers ? members.filter(m => m.role === 'caregiver' && m.user_id !== userId) : [];
    const circleHasDoctor = members.some(m => m.role === 'doctor');
    const recordOptions = { doctorsWanted: notifyDoctors, circleHasDoctor, anonymous };

    const { escalationId, created } = await addEscalationOnce(circleId, type, details, messageId, SAFETY_ESCALATION_TYPES);
    if (!created) {
        // The message already escalated: report what was done then, and send nothing new
        console.log(`[EscalationService] Message ${messageId} already escalated (escalation ${escalationId}); not sending again`);
        const deliveries = await getEscalationDeliveries(escalationId);
        return {
            escalationId,
            duplicate: true,
            deliveries,
            doctorReached: deliveries.some(d => d.role === 'doctor' && d.status !== 'failed'),
            actions: toActionRecord(deliveries, recordOptions)
        };
    }

    const deliveries = [];

    // Doctors see the escalation in their unread list; the in-app notification records delivery
    for (const doctor of doctors) {
        const result = await sendWithTimeout(
            notificationService.sendInApp(doctor.user_id, 'escalation', `Escalation: ${type}`, details, { escalationId, circleId, type }),
            timeoutMs
        );
        deliveries.push(await recordDelivery(escalationId, doctor, result));
    }

    if (caregivers.length > 0 && caregiverMessage) {
        // Live message for caregivers who have the app open
        const agentName = await getAgentName(caregivers[0].user_id, circleId);
        events.emit('broadcast', {
            targetUsers: caregivers.map(m => m.user_id),
            message: caregiverMessage,
            from: agentName,
            circleId,
            patientUsername
        });
        for (const caregiver of caregivers) {
            const result = await sendWithTimeout(
                notificationService.sendInApp(caregiver.user_id, 'escalation', 'Health alert', caregiverMessage, { escalationId, circleId, type }),
                timeoutMs
            );
            deliveries.push(await recordDelivery(escalationId, caregiver, result));
        }
    }

    events.emit('escalate', { circleId, escalationId, ...eventDetails });

    return {
        escalationId,
        duplicate: false,
        deliveries,
        doctorReached: deliveries.some(d => d.role === 'doctor' && d.status !== 'failed'),
        actions: toActionRecord(deliveries, recordOptions)
    };
}

async function recordDelivery(escalationId, member, result) {
    const delivery = {
        escalationId,
        userId: member.user_id,
        username: member.username,
        role: member.role,
        channel: result.channel,
        status: result.status,
        providerMessageId: result.providerMessageId,
        error: result.error
    };
    try {
        delivery.deliveryId = await addEscalationDelivery(delivery);
    } catch (error) {
        console.error(`[EscalationService] Failed to record delivery to ${member.username}:`, error.message);
    }
    return delivery;
}
