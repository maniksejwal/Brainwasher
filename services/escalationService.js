/**
 * @fileoverview services/escalationService.js
 * The one place escalations are created and sent.
 *
 * Patient-safety escalations (HIGH emergencies, doctor requests and the escalation
 * tiers) go through `escalate`. For each one the service:
 *  1. creates at most one escalation row per message;
 *  2. finds recipients from circle membership (doctors, then caregivers);
 *  3. sends to each recipient through the in-app channel, with a bounded wait;
 *  4. records each delivery;
 *  5. emits `escalate` with the recipients, so live clients are told only who received it;
 *  6. returns an action result that replies are built from.
 *
 * Routine inbox rows (INFO, FACT_REPORT, CONFLICT) go through `recordInboxEscalation`:
 * no dedupe and no action result, but the same delivery rows, so doctors' unread lists
 * and acknowledgements work the same way.
 *
 * `acknowledge` records that one doctor saw one escalation and tells the user who raised it.
 *
 * The in-app channel is the only real one (no SMS). A delivery is "delivered" when the
 * recipient had the app open at send time, "pending" when it waits in their inbox, and
 * "failed" when it could not be stored.
 *
 * In a HealthyMitra circle (lib/deliveryMode.js) nothing is sent from here: escalations are
 * proposed (`escalateOrPropose`), a proposal is also stored as a HealthyMitra action, and an
 * accepted one is executed by HealthyMitra, which reports the result
 * (services/integrationActions.js).
 */

import {
    addEscalation,
    addEscalationOnce,
    addEscalationDelivery,
    getEscalationDeliveries,
    getEscalationById,
    acknowledgeEscalation,
    getCircleMembers,
    addPendingAction,
    getPendingAction,
    getActivePendingActions,
    removePendingAction,
    findUserById,
    getEmergencyAutoAlertConsent,
    getDueAutoSendProposals
} from '../db/index.js';
import { randomUUID } from 'crypto';
import { events } from '../orchestrator.js';
import { notificationService } from '../notifications/NotificationService.js';
import { getAgentName } from '../handlers/utils/agentIdentity.js';
import { joinNames, buildActionStatus } from '../utils/actionClaimGuard.js';
import { isHealthyMitraCircle } from '../lib/deliveryMode.js';
import { createAction, decideAction, supersedeAction, DECISIONS, AUTO_SEND_DECISION } from './integrationActions.js';
import { partitionRecipients } from './sharingPolicy.js';

export { AUTO_SEND_DECISION };

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
 * @param {string[]} [params.onlyUserIds] - Send only to these members (an approved proposal's
 *   recipients). Without it, members the user asked not to share with are left out.
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
    onlyUserIds = null,
    timeoutMs = SEND_TIMEOUT_MS
}) {
    if (!SAFETY_ESCALATION_TYPES.includes(type)) {
        throw new Error(`[EscalationService] Unknown escalation type: ${type}`);
    }

    const members = await getCircleMembers(circleId);
    // An approved proposal fixes its recipients; anyone who has left the circle since is dropped
    const allowed = (m) => !onlyUserIds || onlyUserIds.includes(m.user_id);
    let doctors = notifyDoctors ? members.filter(m => m.role === 'doctor' && allowed(m)) : [];
    let caregivers = notifyCaregivers ? members.filter(m => m.role === 'caregiver' && m.user_id !== userId && allowed(m)) : [];
    if (!onlyUserIds) {
        // Not approved by the user: their sharing restrictions apply
        const permitted = new Set((await partitionRecipients({
            circleId, ownerUserId: userId, members: [...doctors, ...caregivers], path: 'escalation'
        })).allowed.map(m => m.user_id));
        doctors = doctors.filter(m => permitted.has(m.user_id));
        caregivers = caregivers.filter(m => permitted.has(m.user_id));
    }
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

    const deliveries = await sendToDoctors({ escalationId, circleId, type, details, doctors, timeoutMs });

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

    emitEscalated({ circleId, escalationId, type, deliveries });

    return {
        escalationId,
        duplicate: false,
        deliveries,
        doctorReached: deliveries.some(d => d.role === 'doctor' && d.status !== 'failed'),
        actions: toActionRecord(deliveries, recordOptions)
    };
}

/**
 * Send an escalation to each doctor's inbox and record each delivery.
 * Doctors see it in their unread list; the in-app notification records delivery.
 */
async function sendToDoctors({ escalationId, circleId, type, details, doctors, timeoutMs }) {
    const deliveries = [];
    for (const doctor of doctors) {
        const result = await sendWithTimeout(
            notificationService.sendInApp(doctor.user_id, 'escalation', `Escalation: ${type}`, details, { escalationId, circleId, type }),
            timeoutMs
        );
        deliveries.push(await recordDelivery(escalationId, doctor, result));
    }
    return deliveries;
}

/**
 * Tell live clients about a new escalation. The event names only the recipients
 * whose delivery did not fail; listeners send it to them and to nobody else.
 */
function emitEscalated({ circleId, escalationId, type, deliveries }) {
    const recipients = deliveries.filter(d => d.status !== 'failed').map(d => d.userId);
    if (recipients.length === 0) return;
    events.emit('escalate', { circleId, escalationId, type, recipients });
}

/**
 * Write a routine escalation (INFO, FACT_REPORT, CONFLICT) to the doctors' inbox.
 * @param {object} params
 * @param {string} params.circleId
 * @param {string} params.type
 * @param {string} params.details
 * @param {number|null} [params.messageId] - The message that caused it
 * @param {number} [params.timeoutMs]
 * @returns {Promise<{escalationId: number, deliveries: object[]}>}
 */
export async function recordInboxEscalation({ circleId, type, details, messageId = null, timeoutMs = SEND_TIMEOUT_MS }) {
    const escalationId = await addEscalation(circleId, type, details, messageId);
    const doctors = (await getCircleMembers(circleId)).filter(m => m.role === 'doctor');
    const deliveries = await sendToDoctors({ escalationId, circleId, type, details, doctors, timeoutMs });
    emitEscalated({ circleId, escalationId, type, deliveries });
    return { escalationId, deliveries };
}

export const PROPOSAL_ACTION_TYPE = 'escalation_proposal';
// An unanswered proposal stops being valid after this long; a later HIGH message proposes again
export const PROPOSAL_TTL_MS = 30 * 60 * 1000;
// The wait a patient consents to before an unanswered emergency alert is sent for them
export const EMERGENCY_AUTO_ALERT_DELAY_MS = 5 * 60 * 1000;

const minutesText = (ms) => {
    const minutes = Math.max(1, Math.round(ms / 60000));
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
};

/**
 * Propose an escalation instead of sending it. Nothing leaves the system until the user
 * accepts. The proposal fixes the escalation's content and recipients, so what the user
 * accepts is exactly what is sent. A newer proposal replaces an older open one from the
 * same user in the same circle, so one "yes" can never send two.
 * Members the user asked not to share with are left out, except in an emergency
 * (`emergency: true`, a HIGH turn): there they stay in the proposal, the question names the
 * restriction, and the proposal is never sent automatically, so they are alerted only on
 * the user's explicit yes.
 * @param {object} params - Same as `escalate`, plus `emergency`, `ttlMs` and `autoSendAfterMs` (send it
 *   if still unanswered after this long; only for a patient who consented in advance)
 * @returns {Promise<{proposal: object|null, question: string|null, actions: object}>}
 *   `proposal` is null when the circle has nobody to alert
 */
export async function proposeEscalation({
    circleId,
    userId,
    type,
    details,
    messageId = null,
    notifyDoctors = true,
    notifyCaregivers = false,
    caregiverMessage = null,
    patientUsername = null,
    ttlMs = PROPOSAL_TTL_MS,
    autoSendAfterMs = null,
    emergency = false
}) {
    if (!SAFETY_ESCALATION_TYPES.includes(type)) {
        throw new Error(`[EscalationService] Unknown escalation type: ${type}`);
    }
    const members = await getCircleMembers(circleId);
    const circleHasDoctor = members.some(m => m.role === 'doctor');
    const wanted = members
        .filter(m => (notifyDoctors && m.role === 'doctor') || (notifyCaregivers && m.role === 'caregiver' && m.user_id !== userId));
    const { allowed: permitted, blocked, failedClosed } = await partitionRecipients({
        circleId, ownerUserId: userId, members: wanted, path: emergency ? 'emergency_proposal' : 'escalation_proposal'
    });
    const included = emergency ? wanted : permitted;
    // Asked first, by name: restricted members are alerted only on an explicit yes
    const overriddenNames = emergency ? blocked.map(m => m.username) : [];
    if (emergency && (blocked.length > 0 || failedClosed)) autoSendAfterMs = null;
    const recipients = included.map(m => ({ userId: m.user_id, username: m.username, role: m.role }));
    const actions = { noDoctorConnected: notifyDoctors && !circleHasDoctor };
    if (recipients.length === 0) {
        return { proposal: null, question: null, actions };
    }

    for (const open of await getActivePendingActions(userId, circleId)) {
        if (open.action_type === PROPOSAL_ACTION_TYPE) {
            await removePendingAction(open.action_id);
            // Its card can no longer be accepted either
            if (isHealthyMitraCircle(circleId)) await supersedeAction(open.action_id);
        }
    }

    const proposal = {
        actionId: `esc_${randomUUID()}`,
        kind: 'escalation',
        type,
        details,
        messageId,
        recipients,
        notifyDoctors,
        notifyCaregivers,
        caregiverMessage,
        patientUsername,
        expiresAt: Date.now() + ttlMs,
        autoSendAfterMs: autoSendAfterMs || null,
        autoSendAt: autoSendAfterMs ? Date.now() + autoSendAfterMs : null,
        overridesRestrictionFor: overriddenNames
    };
    if (isHealthyMitraCircle(circleId)) {
        // HealthyMitra executes it once accepted; the stored action fixes what it may send
        const action = await createAction({
            actionId: proposal.actionId,
            kind: 'escalation',
            ownerUserId: userId,
            circleId,
            recipients,
            content: { doctors: notifyDoctors ? details : null, caregivers: notifyCaregivers ? caregiverMessage : null },
            escalationType: type,
            messageId,
            expiresAt: proposal.expiresAt,
            autoSendAt: proposal.autoSendAt
        });
        if (!action) return { proposal: null, question: null, actions };
    }
    await addPendingAction(proposal.actionId, circleId, userId, PROPOSAL_ACTION_TYPE, proposal);
    let question = `Do you want me to alert ${joinNames(recipients.map(r => r.username))} now? Just reply yes.`;
    if (overriddenNames.length > 0) {
        question = `You asked me not to share with ${joinNames(overriddenNames)}. Because this could be an emergency, I'd like to alert them anyway, but only if you say so. ${question}`;
    }
    if (proposal.autoSendAt) {
        question += ` If you don't answer within ${minutesText(autoSendAfterMs)}, the alert goes to them automatically, as you set up.`;
    }
    return { proposal, question, actions };
}

/**
 * The parts of a proposal a client shows on its Accept/Reject card: who it goes to and
 * the exact text each kind of recipient gets.
 * @param {object|null|undefined} proposal - From proposeEscalation
 * @returns {object|null}
 */
export function toPublicProposal(proposal) {
    if (!proposal) return null;
    return {
        actionId: proposal.actionId,
        kind: proposal.kind ?? 'escalation',
        type: proposal.type,
        recipients: proposal.recipients.map(({ username, role }) => ({ username, role })),
        content: {
            doctors: proposal.notifyDoctors ? proposal.details : null,
            caregivers: proposal.notifyCaregivers ? proposal.caregiverMessage : null
        },
        expiresAt: proposal.expiresAt,
        autoSendAt: proposal.autoSendAt ?? null
    };
}

/**
 * The automatic-send delay for an emergency proposal, or null when it must wait for an
 * answer. Only a patient's own emergency in their own circle qualifies, and only with
 * consent given in advance.
 * @param {string} userId - The user who reported the emergency
 * @param {string} role
 * @param {object} circle - The circle row
 * @returns {Promise<number|null>}
 */
export async function autoSendDelayFor(userId, role, circle) {
    if (role !== 'patient' || circle?.primary_patient_id !== userId) return null;
    const consent = await getEmergencyAutoAlertConsent(userId);
    return consent ? consent.delay_ms : null;
}

/**
 * Send the emergency proposals that reached their automatic send time unanswered, and
 * tell each patient what was sent. Consent is checked again here, so revoking it stops
 * proposals already waiting. Each proposal is claimed before sending, so it is sent at
 * most once even if the patient answers at the same moment.
 * @param {object} [options]
 * @param {number} [options.now]
 * @returns {Promise<Array<{actionId: string, status: 'completed'|'approved'|'skipped', result?: object}>>}
 *   "approved" is a HealthyMitra action, which HealthyMitra sends
 */
export async function runDueAutoAlerts({ now = Date.now() } = {}) {
    const outcomes = [];
    for (const pending of await getDueAutoSendProposals(now)) {
        const proposal = pending.details;
        const restricted = (await partitionRecipients({
            circleId: pending.circle_id,
            ownerUserId: pending.user_id,
            members: (proposal.recipients || []).map(r => ({ user_id: r.userId, username: r.username, role: r.role })),
            path: 'auto_alert'
        })).blocked.length > 0;
        if (now > proposal.expiresAt || restricted || !(await getEmergencyAutoAlertConsent(pending.user_id))) {
            // Expired, consent revoked, or a recipient restricted since: it waits for an answer
            // like any other proposal
            await updateAutoSend(pending, null);
            outcomes.push({ actionId: proposal.actionId, status: 'skipped' });
            continue;
        }
        if (!(await removePendingAction(proposal.actionId))) continue;

        if (isHealthyMitraCircle(pending.circle_id)) {
            // HealthyMitra sends it and reports the result, which tells the patient
            const decided = await decideAction(proposal.actionId, pending.user_id, true, AUTO_SEND_DECISION, { now })
                .catch(error => ({ status: 'skipped', error }));
            console.log(`[EscalationService] Proposal ${proposal.actionId} approved (${AUTO_SEND_DECISION}) for HealthyMitra: ${decided.status}`);
            outcomes.push({ actionId: proposal.actionId, status: decided.status === 'approved' ? 'approved' : 'skipped' });
            continue;
        }

        const waited = minutesText(proposal.autoSendAfterMs);
        const result = await escalate({
            circleId: pending.circle_id,
            userId: pending.user_id,
            type: proposal.type,
            details: `${proposal.details} [Sent automatically (${AUTO_SEND_DECISION}): no answer within ${waited}]`,
            messageId: proposal.messageId,
            notifyDoctors: proposal.notifyDoctors,
            notifyCaregivers: proposal.notifyCaregivers,
            caregiverMessage: proposal.caregiverMessage,
            patientUsername: proposal.patientUsername,
            onlyUserIds: proposal.recipients.map(r => r.userId)
        });
        console.log(`[EscalationService] Proposal ${proposal.actionId} sent as escalation ${result.escalationId} (${AUTO_SEND_DECISION})`);

        const status = buildActionStatus(result.actions);
        const notice = status
            ? `You didn't answer within ${waited}, so the alert went out as you set up. ${status}`
            : `You didn't answer within ${waited}, but I couldn't send the alert to anyone.`;
        await notificationService.sendInApp(pending.user_id, 'escalation_auto_sent', 'Emergency alert sent', notice, { escalationId: result.escalationId, circleId: pending.circle_id });
        events.emit('broadcast', {
            targetUsers: [pending.user_id],
            reply: notice,
            from: await getAgentName(pending.user_id, pending.circle_id),
            circleId: pending.circle_id,
            patientUsername: proposal.patientUsername,
            source: 'escalation_auto_sent'
        });
        outcomes.push({ actionId: proposal.actionId, status: 'completed', result, notice });
    }
    return outcomes;
}

/**
 * Change or clear a waiting proposal's automatic send time.
 */
async function updateAutoSend(pending, autoSendAt) {
    if (!(await removePendingAction(pending.action_id))) return;
    await addPendingAction(pending.action_id, pending.circle_id, pending.user_id, PROPOSAL_ACTION_TYPE, { ...pending.details, autoSendAt });
}

/**
 * Accept or reject an escalation proposal. Only the user it was proposed to can decide,
 * and it runs at most once: the proposal is removed before anything is sent.
 * @param {string} actionId
 * @param {string} userId - The user deciding
 * @param {boolean} accept
 * @returns {Promise<{status: 'completed'|'approved'|'rejected'|'expired'|'not_found', result?: object}>}
 *   "approved" is a HealthyMitra action: the decision is recorded and HealthyMitra sends it
 */
export async function decideEscalationProposal(actionId, userId, accept) {
    const pending = await getPendingAction(actionId);
    if (!pending || pending.action_type !== PROPOSAL_ACTION_TYPE || pending.user_id !== userId) {
        return { status: 'not_found' };
    }
    if (isHealthyMitraCircle(pending.circle_id)) {
        const decided = await decideAction(actionId, userId, accept, DECISIONS.chat).catch(() => null);
        return { status: decided?.changed ? decided.status : 'not_found' };
    }
    // Removing it claims it: a second decision (another tab, a double click) finds nothing
    if (!(await removePendingAction(actionId))) return { status: 'not_found' };

    const proposal = pending.details;
    if (Date.now() > proposal.expiresAt) return { status: 'expired' };
    if (!accept) return { status: 'rejected' };

    const result = await escalate({
        circleId: pending.circle_id,
        userId,
        type: proposal.type,
        details: proposal.details,
        messageId: proposal.messageId,
        notifyDoctors: proposal.notifyDoctors,
        notifyCaregivers: proposal.notifyCaregivers,
        caregiverMessage: proposal.caregiverMessage,
        patientUsername: proposal.patientUsername,
        onlyUserIds: proposal.recipients.map(r => r.userId)
    });
    return { status: 'completed', result };
}

/**
 * Escalate, or in a HealthyMitra circle propose the same escalation for the user to accept.
 * @param {object} params - As for `escalate`
 * @returns {Promise<object>} `escalate`'s result with `proposed: false`, or
 *   { proposed: true, proposal, question, actions } (proposal null when nobody can be alerted)
 */
export async function escalateOrPropose(params) {
    if (!isHealthyMitraCircle(params.circleId)) {
        return { ...(await escalate(params)), proposed: false };
    }
    const { anonymous, onlyUserIds, timeoutMs, ...proposalParams } = params;
    return { ...(await proposeEscalation(proposalParams)), proposed: true };
}

// Conflicts are between two members' reports; nobody raised them, so nobody is told
const NO_ACKNOWLEDGEMENT_NOTICE = ['CONFLICT'];

/**
 * Record that a doctor saw an escalation, and tell the user who raised it.
 * The notice goes to the author of the message that caused it, or to the patient
 * when the message is not known. It runs only on the first acknowledgement by
 * this doctor.
 * @param {number} escalationId
 * @param {string} doctorId
 * @returns {Promise<{acknowledged: boolean, notified: string|null}>}
 */
export async function acknowledge(escalationId, doctorId) {
    const acknowledged = await acknowledgeEscalation(escalationId, doctorId);
    if (!acknowledged) return { acknowledged: false, notified: null };

    const escalation = await getEscalationById(escalationId);
    const notifyUserId = escalation?.author_id || escalation?.patient_id;
    if (!escalation || !notifyUserId || NO_ACKNOWLEDGEMENT_NOTICE.includes(escalation.type) || notifyUserId === doctorId) {
        return { acknowledged: true, notified: null };
    }

    const doctor = await findUserById(doctorId);
    const notice = ['ANONYMOUS_CONSULTATION', 'CONSULT'].includes(escalation.type)
        ? 'A doctor has seen your anonymous consultation request.'
        : `${doctor?.username ?? 'Your doctor'} has seen the concern I flagged for them.`;

    await notificationService.sendInApp(notifyUserId, 'escalation_acknowledged', 'Your doctor has seen this', notice, { escalationId, circleId: escalation.circle_id });
    const patient = escalation.patient_id ? await findUserById(escalation.patient_id) : null;
    events.emit('broadcast', {
        targetUsers: [notifyUserId],
        reply: notice,
        from: await getAgentName(notifyUserId, escalation.circle_id),
        circleId: escalation.circle_id,
        patientUsername: patient?.username ?? null,
        source: 'escalation_acknowledged'
    });
    return { acknowledged: true, notified: notifyUserId };
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
