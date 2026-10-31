/**
 * @fileoverview services/integrationService.js
 * HealthyMitra identities and conversations. A HealthyMitra user is linked to one local
 * user through external_identities and has one private conversation. HealthyMitra's
 * user ID is the identity; the display name is only a label.
 *
 * Each message carries a context snapshot from HealthyMitra: the patient it is about and the
 * other members of that patient's circle with their roles. The local circle is a cache of
 * that snapshot and is updated before the message is handled; it never grants access.
 */
import { randomUUID } from 'crypto';
import {
    addUser,
    findUserByUsername,
    findExternalIdentity,
    addExternalIdentity,
    addConversation,
    findIdempotencyRecord,
    addIdempotencyRecord,
    findConversationById,
    createCareCircle,
    addMemberToCircle,
    updateMemberRole,
    getMemberInfo,
    removeCircleMembersExcept,
    addUserConversationMessage,
    addConversationJob,
    getConversationMessages,
    hasConversationMessagesBefore,
    hasUnfinishedConversationJobs,
    setEmergencyAutoAlertConsent
} from '../db/index.js';
import { getOpenActionsForUser } from './integrationActions.js';

export const PROVIDER = 'healthymitra';
export const PROVISION_PURPOSE = 'conversation.provision';
export const MESSAGE_PURPOSE = 'conversation.message';
export const HISTORY_PURPOSE = 'conversation.history';
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_CIRCLE_MEMBERS = 50;
export const HISTORY_PAGE_DEFAULT = 50;
export const HISTORY_PAGE_MAX = 100;
const MAX_DISPLAY_NAME = 60;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MEMBER_ROLES = ['caregiver', 'doctor'];
// The automatic-send waits HealthyMitra may grant for unanswered emergencies
export const AUTO_ALERT_DELAY_MIN_MS = 60 * 1000;
export const AUTO_ALERT_DELAY_MAX_MS = 60 * 60 * 1000;

export class IntegrationError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

/**
 * A local username for a display name. Usernames are unique here, so a taken name gets a
 * number ("Asha 2"); agents use it only as a label.
 */
async function availableUsername(displayName) {
    const base = (displayName || '').replace(/\s+/g, ' ').trim().slice(0, MAX_DISPLAY_NAME) || 'HealthyMitra user';
    if (!(await findUserByUsername(base))) return base;
    for (let n = 2; ; n++) {
        const candidate = `${base} ${n}`;
        if (!(await findUserByUsername(candidate))) return candidate;
    }
}

// Provisioning runs one at a time per HealthyMitra user, so concurrent first requests
// cannot create two local users for the same person
const inFlight = new Map();

function serialized(key, fn) {
    const previous = inFlight.get(key) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(fn);
    // The stored tail never rejects; the caller gets the rejection from `run`
    const tail = run.catch(() => {}).then(() => {
        if (inFlight.get(key) === tail) inFlight.delete(key);
    });
    inFlight.set(key, tail);
    return run;
}

/**
 * The local user for a HealthyMitra user, created on first use. Runs one at a time per
 * HealthyMitra user, so two requests naming the same person create one local user.
 * @returns {Promise<{userId: string, created: boolean}>}
 */
export function resolveIdentity(externalUserId, displayName) {
    return serialized(`identity:${externalUserId}`, async () => {
        const existing = await findExternalIdentity(PROVIDER, externalUserId);
        if (existing) return { userId: existing.user_id, created: false };
        const userId = `hm_${randomUUID()}`;
        await addUser(userId, await availableUsername(displayName));
        const link = await addExternalIdentity(PROVIDER, externalUserId, userId);
        return { userId: link.user_id, created: link.user_id === userId };
    });
}

/**
 * Provision a HealthyMitra user's identity and private conversation. Safe to repeat: the
 * same user always gets the same conversation, and a repeated idempotency key returns
 * the first response.
 * @param {object} params
 * @param {string} params.externalUserId - From the signed request, never from the body
 * @param {string} [params.displayName]
 * @param {string} params.idempotencyKey
 * @returns {Promise<{status: number, body: object}>}
 */
export function provisionConversation({ externalUserId, displayName, idempotencyKey }) {
    return serialized(`provision:${externalUserId}`, async () => {
        const previous = await findIdempotencyRecord(idempotencyKey);
        if (previous) {
            if (previous.external_user_id !== externalUserId || previous.purpose !== PROVISION_PURPOSE) {
                throw new IntegrationError(422, 'idempotency_key_reused', 'This idempotency key was used for a different request');
            }
            return previous.response;
        }

        const { userId } = await resolveIdentity(externalUserId, displayName);
        const { conversation, created } = await addConversation(`conv_${randomUUID()}`, userId);
        const response = {
            status: created ? 201 : 200,
            body: {
                conversationId: conversation.conversation_id,
                createdAt: new Date(conversation.created_at).toISOString(),
                created
            }
        };
        await addIdempotencyRecord(idempotencyKey, PROVISION_PURPOSE, externalUserId, response);
        return response;
    });
}

/**
 * Check a context snapshot's shape.
 * @returns {string|null} What is wrong, or null
 */
export function contextProblem(context) {
    if (!context || typeof context !== 'object') return 'context is required';
    const { patient, members } = context;
    if (!patient || typeof patient.userId !== 'string' || !ID_PATTERN.test(patient.userId)) return 'context.patient.userId is required';
    if (patient.displayName !== undefined && typeof patient.displayName !== 'string') return 'context.patient.displayName must be a string';
    if (!Array.isArray(members) || members.length > MAX_CIRCLE_MEMBERS) return `context.members must be an array of at most ${MAX_CIRCLE_MEMBERS}`;
    const seen = new Set([patient.userId]);
    for (const member of members) {
        if (!member || typeof member.userId !== 'string' || !ID_PATTERN.test(member.userId)) return 'each member needs a userId';
        if (!MEMBER_ROLES.includes(member.role)) return `member role must be one of ${MEMBER_ROLES.join(', ')}`;
        if (member.displayName !== undefined && typeof member.displayName !== 'string') return 'member displayName must be a string';
        if (seen.has(member.userId)) return 'members must be unique and not include the patient';
        seen.add(member.userId);
    }
    const { allowedActions } = context;
    if (allowedActions !== undefined) {
        if (!allowedActions || typeof allowedActions !== 'object') return 'context.allowedActions must be an object';
        const autoAlert = allowedActions.emergencyAutoAlert;
        if (autoAlert !== undefined && autoAlert !== null) {
            const delay = autoAlert.delayMs;
            if (!Number.isInteger(delay) || delay < AUTO_ALERT_DELAY_MIN_MS || delay > AUTO_ALERT_DELAY_MAX_MS) {
                return `context.allowedActions.emergencyAutoAlert.delayMs must be ${AUTO_ALERT_DELAY_MIN_MS}-${AUTO_ALERT_DELAY_MAX_MS}`;
            }
        }
    }
    return null;
}

/**
 * Update the cached circle from a snapshot: the patient, the members and their roles.
 * Members missing from the snapshot are removed. The patient's consent to unanswered
 * emergency alerts comes from the snapshot too (allowedActions.emergencyAutoAlert): HealthyMitra
 * settings are the source of truth, so a snapshot without it revokes it.
 * @param {string} requesterExternalId - The signed request's user
 * @param {object} context - A snapshot that passed contextProblem
 * @returns {Promise<{circleId: string, role: string}>} The circle and the requester's role in it
 * @throws {IntegrationError} If the requester is neither the patient nor a member
 */
export async function syncCircleFromContext(requesterExternalId, context) {
    const role = requesterExternalId === context.patient.userId
        ? 'patient'
        : context.members.find(m => m.userId === requesterExternalId)?.role;
    if (!role) {
        throw new IntegrationError(403, 'context_mismatch', 'The requesting user is not the patient or a member in the context');
    }

    const patient = await resolveIdentity(context.patient.userId, context.patient.displayName);
    const circleId = `hmc_${patient.userId}`;
    await createCareCircle(circleId, patient.userId);

    const keep = [patient.userId];
    for (const member of context.members) {
        const { userId } = await resolveIdentity(member.userId, member.displayName);
        keep.push(userId);
        const existing = await getMemberInfo(userId, circleId);
        if (!existing) {
            await addMemberToCircle(circleId, userId, member.role, null);
        } else if (existing.role !== member.role) {
            await updateMemberRole(circleId, userId, member.role);
        }
    }
    await removeCircleMembersExcept(circleId, keep);
    const autoAlert = context.allowedActions?.emergencyAutoAlert;
    await setEmergencyAutoAlertConsent(patient.userId, Boolean(autoAlert), autoAlert?.delayMs ?? null);
    return { circleId, role };
}

/**
 * The conversation if it belongs to this HealthyMitra user.
 * @throws {IntegrationError} 404 otherwise, so another user's conversation ID reveals nothing
 */
async function ownedConversation(externalUserId, conversationId) {
    const identity = await findExternalIdentity(PROVIDER, externalUserId);
    const conversation = await findConversationById(conversationId);
    if (!identity || !conversation || conversation.user_id !== identity.user_id) {
        throw new IntegrationError(404, 'conversation_not_found', 'No such conversation for this user');
    }
    return { conversation, userId: identity.user_id };
}

/**
 * Save a user's message and queue it for processing. A repeated request ID returns the
 * first message and its job instead of saving another.
 * @returns {Promise<{status: number, body: object, queued: boolean}>}
 */
export async function submitConversationMessage({ externalUserId, conversationId, requestId, text, context }) {
    const { userId } = await ownedConversation(externalUserId, conversationId);
    const { circleId } = await syncCircleFromContext(externalUserId, context);

    const { message, created } = await addUserConversationMessage({
        messageId: `msg_${randomUUID()}`,
        conversationId,
        requestId,
        circleId,
        text,
        jobId: `job_${randomUUID()}`
    });
    if (!created && message.text !== text) {
        throw new IntegrationError(422, 'request_id_reused', 'This request ID was used for a different message');
    }
    // Also repairs a message saved without its job (a crash between the two writes)
    const job = await addConversationJob({ jobId: message.job_id, conversationId, messageId: message.message_id, userId, circleId: message.circle_id });
    return {
        status: created ? 202 : 200,
        queued: job.status === 'accepted',
        body: {
            messageId: message.message_id,
            jobId: job.job_id,
            status: job.status,
            createdAt: new Date(message.created_at).toISOString()
        }
    };
}

function toPublicMessage(row) {
    const message = {
        messageId: row.message_id,
        sender: row.sender,
        text: row.text,
        createdAt: new Date(row.created_at).toISOString(),
        patientUserId: row.patient_external_id ?? null
    };
    if (row.sender === 'user') {
        message.requestId = row.request_id;
        message.job = { jobId: row.job_id, status: row.job_status ?? 'accepted' };
    } else {
        message.jobId = row.job_id ?? null;
        message.source = row.source ?? null;
        message.proposal = row.proposal ? JSON.parse(row.proposal) : null;
    }
    return message;
}

/**
 * One page of the user's conversation with the user's open actions: proposals waiting for
 * an answer, and approved ones HealthyMitra has not reported a result for yet.
 * @param {object} params
 * @param {number|null} [params.after] - Messages after this cursor, oldest first (polling)
 * @param {number|null} [params.before] - Messages before this cursor (older history)
 * @param {number} [params.limit]
 */
export async function getConversationHistory({ externalUserId, conversationId, after = null, before = null, limit = HISTORY_PAGE_DEFAULT }) {
    const { userId } = await ownedConversation(externalUserId, conversationId);
    const rows = await getConversationMessages(conversationId, { after, before, limit });
    const first = rows[0]?.message_seq ?? null;
    const last = rows.at(-1)?.message_seq ?? null;
    return {
        messages: rows.map(toPublicMessage),
        openProposals: await getOpenActionsForUser(userId),
        processing: await hasUnfinishedConversationJobs(conversationId),
        cursor: {
            next: String(last ?? after ?? 0),
            previous: first != null && (await hasConversationMessagesBefore(conversationId, first)) ? String(first) : null
        }
    };
}
