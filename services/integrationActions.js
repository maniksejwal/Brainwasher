/**
 * @fileoverview services/integrationActions.js
 * Actions proposed to HealthyMitra users (delivery mode "healthymitra", lib/deliveryMode.js).
 *
 * Nothing is sent from this service for a HealthyMitra circle. Each outward action is stored
 * here with its fixed HealthyMitra recipient IDs and exact content, and shown to the user as
 * an Accept/Reject card:
 *   pending -> rejected | expired | approved -> completed | failed
 *
 * Approval only records the decision. HealthyMitra executes an approved action through its
 * own services, then reports the per-recipient result; that result is what the user is told
 * ("I've sent an alert to Ravi in the app."). Statements about actions still come only from
 * recorded results, and the results now come from HealthyMitra.
 *
 * Decisions come from HealthyMitra's card (user_card), from the user answering in the
 * conversation (user_chat), or from the unanswered-emergency sweep for a patient who
 * consented in advance (auto_by_prior_consent). The last two happen here, so HealthyMitra
 * is told about them; a card decision already came from HealthyMitra.
 */
import { createHash } from 'crypto';
import {
    addIntegrationAction,
    getIntegrationAction,
    getIntegrationActionsForUser,
    decideIntegrationAction,
    finishIntegrationAction,
    findExternalIdentity,
    findExternalIdentityByUser,
    findConversationByUser,
    findCircleById,
    findUserById,
    removePendingAction,
    addEscalation,
    addEscalationDelivery
} from '../db/index.js';
import { events } from '../orchestrator.js';
import { getAgentName } from '../handlers/utils/agentIdentity.js';
import { buildActionStatus } from '../utils/actionClaimGuard.js';
import { postToHealthyMitra } from '../lib/healthyMitraClient.js';
import { notifyConversationUpdated } from './conversationNotices.js';

const PROVIDER = 'healthymitra';
export const ACTION_KINDS = ['escalation', 'send_member_message', 'post_observation', 'request_patient_agent_update'];
// Bumped when the payload shape changes; HealthyMitra executes only versions it knows
export const ACTION_VERSION = 1;
export const DECISION_PURPOSE = 'action.decision';
export const RESULT_PURPOSE = 'action.result';
export const APPROVED_NOTICE_PURPOSE = 'action.approved';
export const APPROVED_NOTICE_PATH = '/api/integrations/healthymitra-ai/actions';
export const DECISIONS = { card: 'user_card', chat: 'user_chat', auto: 'auto_by_prior_consent' };
// Recorded on an alert sent because the patient consented in advance and did not answer
export const AUTO_SEND_DECISION = DECISIONS.auto;
export const RECIPIENT_RESULT_STATUSES = ['delivered', 'failed'];
// Statuses after approval: the decision can no longer change
const APPROVED_STATUSES = ['approved', 'executing', 'completed', 'failed'];

export class ActionError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export function payloadHash(payload) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function externalId(localUserId) {
    return (await findExternalIdentityByUser(PROVIDER, localUserId))?.external_user_id ?? null;
}

/**
 * Store a proposed action. Recipients are fixed here as HealthyMitra user IDs; one without
 * a HealthyMitra identity cannot be reached through HealthyMitra and is left out.
 * @param {object} params
 * @param {string} params.actionId
 * @param {string} params.kind - One of ACTION_KINDS
 * @param {string} params.ownerUserId - Local user who decides it
 * @param {string} params.circleId
 * @param {Array<{userId: string, username: string, role: string}>} params.recipients - Local members
 * @param {{doctors: string|null, caregivers: string|null}} params.content - Exact text per recipient role
 * @param {string|null} [params.escalationType] - For kind "escalation"
 * @param {number|null} [params.messageId] - The message that caused it
 * @param {number} params.expiresAt
 * @param {number|null} [params.autoSendAt]
 * @returns {Promise<object|null>} The stored row, or null when nobody can be reached
 */
export async function createAction({ actionId, kind, ownerUserId, circleId, recipients, content, escalationType = null, messageId = null, expiresAt, autoSendAt = null }) {
    if (!ACTION_KINDS.includes(kind)) throw new Error(`[IntegrationActions] Unknown action kind: ${kind}`);
    const fixed = [];
    for (const recipient of recipients) {
        const userId = await externalId(recipient.userId);
        if (userId) fixed.push({ userId, username: recipient.username, role: recipient.role });
    }
    if (fixed.length === 0) return null;

    const circle = await findCircleById(circleId);
    const payload = {
        kind,
        escalationType,
        patientUserId: circle ? await externalId(circle.primary_patient_id) : null,
        recipients: fixed,
        content: { doctors: content.doctors ?? null, caregivers: content.caregivers ?? null },
        messageId
    };
    const conversation = await findConversationByUser(ownerUserId);
    const row = await addIntegrationAction({
        actionId,
        kind,
        ownerUserId,
        conversationId: conversation?.conversation_id ?? null,
        circleId,
        payload,
        payloadHash: payloadHash(payload),
        version: ACTION_VERSION,
        expiresAt,
        autoSendAt
    });
    // The card shows in HealthyMitra at once instead of on its next history read
    if (row && conversation) notifyConversationUpdated({ userId: ownerUserId, conversationId: conversation.conversation_id });
    return row;
}

/**
 * What HealthyMitra shows on the card and executes after approval.
 */
export function toPublicAction(row) {
    const { payload } = row;
    return {
        actionId: row.action_id,
        kind: row.kind,
        type: payload.escalationType ?? 'MEMBER_MESSAGE',
        status: row.status,
        decision: row.decision ?? null,
        patientUserId: payload.patientUserId,
        recipients: payload.recipients,
        content: payload.content,
        payloadHash: row.payload_hash,
        version: row.version,
        expiresAt: row.expires_at,
        autoSendAt: row.auto_send_at ?? null,
        results: row.results ?? null
    };
}

/**
 * The user's actions HealthyMitra should show or execute: pending ones that have not expired,
 * and approved ones without a result yet.
 */
export async function getOpenActionsForUser(userId, now = Date.now()) {
    const rows = await getIntegrationActionsForUser(userId, ['pending', 'approved', 'executing']);
    return rows.filter(row => row.status !== 'pending' || row.expires_at > now).map(toPublicAction);
}

/**
 * Expire a pending action that a newer proposal replaced, so only the newest can be accepted.
 */
export async function supersedeAction(actionId, now = Date.now()) {
    return decideIntegrationAction(actionId, 'expired', null, now);
}

async function ownedAction(actionId, ownerUserId) {
    const row = await getIntegrationAction(actionId);
    if (!row || row.owner_user_id !== ownerUserId) {
        throw new ActionError(404, 'action_not_found', 'No such action for this user');
    }
    return row;
}

/**
 * Approve or reject a pending action. It is decided once: a repeat of the same decision
 * returns the action unchanged, and a different decision is refused.
 * @param {string} actionId
 * @param {string} ownerUserId - Local user deciding; must own it
 * @param {boolean} approve
 * @param {string} decision - One of DECISIONS
 * @param {object} [options]
 * @param {string|null} [options.expectedHash] - The payload hash the user saw; a mismatch is refused
 * @returns {Promise<{status: string, action: object, changed: boolean}>}
 */
export async function decideAction(actionId, ownerUserId, approve, decision, { expectedHash = null, now = Date.now() } = {}) {
    let row = await ownedAction(actionId, ownerUserId);
    if (expectedHash && expectedHash !== row.payload_hash) {
        throw new ActionError(409, 'payload_changed', 'The action changed since it was shown; it was not decided');
    }

    if (row.status === 'pending') {
        const status = now > row.expires_at ? 'expired' : approve ? 'approved' : 'rejected';
        const changed = await decideIntegrationAction(actionId, status, status === 'expired' ? null : decision, now);
        // The chat question for it is answered too
        await removePendingAction(actionId);
        row = await getIntegrationAction(actionId);
        if (changed) {
            if (status === 'approved' && decision !== DECISIONS.card) notifyApproved(row);
            return { status, action: toPublicAction(row), changed: true };
        }
    }

    // Already decided, here or by a concurrent request
    const matches = row.status === 'expired' || (approve ? APPROVED_STATUSES.includes(row.status) : row.status === 'rejected');
    if (!matches) {
        throw new ActionError(409, 'already_decided', `The action was already ${row.status}`);
    }
    return { status: row.status, action: toPublicAction(row), changed: false };
}

// What the user is told after deciding on HealthyMitra's card; an approval is answered by
// the result instead
const CARD_DECISION_REPLIES = {
    rejected: "Okay, I haven't sent it.",
    expired: "That was from a while ago, so I haven't sent it. If you still need it, tell me what's happening now."
};

/**
 * Decide an action from HealthyMitra's Accept/Reject card.
 * @param {string} actionId
 * @param {string} ownerUserId - Local user deciding
 * @param {boolean} approve
 * @param {string} expectedHash - The payload hash on the card
 * @returns {Promise<{status: string, action: object, changed: boolean}>}
 */
export async function decideFromCard(actionId, ownerUserId, approve, expectedHash) {
    const decided = await decideAction(actionId, ownerUserId, approve, DECISIONS.card, { expectedHash });
    if (decided.changed && CARD_DECISION_REPLIES[decided.status]) {
        await tellOwner(await getIntegrationAction(actionId), CARD_DECISION_REPLIES[decided.status], 'action_decision');
    }
    return decided;
}

/**
 * Tell HealthyMitra an action was approved here, so it executes it without waiting for the
 * next history read. A failure is logged only: HealthyMitra also finds approved actions
 * in the history it reads.
 */
function notifyApproved(row) {
    (async () => {
        const userId = await externalId(row.owner_user_id);
        const { status } = await postToHealthyMitra({
            path: APPROVED_NOTICE_PATH,
            userId,
            purpose: APPROVED_NOTICE_PURPOSE,
            body: { conversationId: row.conversation_id, action: toPublicAction(row) }
        });
        if (status >= 300) console.warn(`[IntegrationActions] HealthyMitra answered ${status} to approved action ${row.action_id}`);
    })().catch(error => console.warn(`[IntegrationActions] Could not tell HealthyMitra about approved action ${row.action_id}:`, error.message));
}

/**
 * Check a result body.
 * @returns {string|null} What is wrong, or null
 */
export function resultProblem(body, row) {
    if (!body || !Array.isArray(body.recipients) || body.recipients.length === 0) return 'recipients is required';
    const known = new Set(row.payload.recipients.map(r => r.userId));
    const seen = new Set();
    for (const recipient of body.recipients) {
        if (!recipient || typeof recipient.userId !== 'string' || !known.has(recipient.userId)) return 'each result must name one of the action\'s recipients';
        if (!RECIPIENT_RESULT_STATUSES.includes(recipient.status)) return `recipient status must be one of ${RECIPIENT_RESULT_STATUSES.join(', ')}`;
        if (recipient.resultId !== undefined && recipient.resultId !== null && (typeof recipient.resultId !== 'string' || recipient.resultId.length > 128)) return 'resultId must be a string of at most 128 characters';
        if (seen.has(recipient.userId)) return 'recipients must be unique';
        seen.add(recipient.userId);
    }
    return null;
}

/**
 * The action record (utils/actionClaimGuard.js) for the recipients HealthyMitra reached.
 */
export function resultActions(row, results) {
    const delivered = results.filter(r => r.status === 'delivered');
    const failed = results.filter(r => r.status !== 'delivered').map(r => r.username);
    if (row.kind === 'escalation') {
        const doctors = delivered.filter(r => r.role === 'doctor').map(r => r.username);
        return {
            escalationCreated: delivered.length > 0,
            doctors,
            caregiversAlerted: delivered.filter(r => r.role === 'caregiver').map(r => r.username),
            failedRecipients: failed
        };
    }
    return { membersMessaged: delivered.map(r => r.username), failedRecipients: failed };
}

const minutesText = (ms) => {
    const minutes = Math.max(1, Math.round(ms / 60000));
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
};

/**
 * Record HealthyMitra's result for an approved action and tell the user what was done.
 * Recorded once: a repeated report returns the stored result without telling the user again.
 * @param {string} actionId
 * @param {string} ownerUserId - Local user; must own it
 * @param {{recipients: Array<{userId: string, status: string, resultId?: string}>}} body
 * @returns {Promise<{action: object, changed: boolean}>}
 */
export async function recordActionResult(actionId, ownerUserId, body, { now = Date.now() } = {}) {
    const row = await ownedAction(actionId, ownerUserId);
    const problem = resultProblem(body, row);
    if (problem) throw new ActionError(400, 'invalid_request', problem);

    if (['completed', 'failed'].includes(row.status)) {
        return { action: toPublicAction(row), changed: false };
    }
    if (!['approved', 'executing'].includes(row.status)) {
        throw new ActionError(409, 'action_not_approved', `The action is ${row.status}; only approved actions have results`);
    }

    // Every recipient gets a result; one HealthyMitra did not report was not reached
    const reported = new Map(body.recipients.map(r => [r.userId, r]));
    const results = row.payload.recipients.map(recipient => ({
        userId: recipient.userId,
        username: recipient.username,
        role: recipient.role,
        status: reported.get(recipient.userId)?.status ?? 'failed',
        resultId: reported.get(recipient.userId)?.resultId ?? null
    }));
    const status = results.every(r => r.status === 'delivered') ? 'completed' : 'failed';
    if (!(await finishIntegrationAction(actionId, status, results, now))) {
        // A concurrent report recorded it first
        return { action: toPublicAction(await getIntegrationAction(actionId)), changed: false };
    }

    if (row.kind === 'escalation') await recordEscalation(row, results);
    await tellOwner(row, resultSentence(row, resultActions(row, results)), 'action_result');
    return { action: toPublicAction(await getIntegrationAction(actionId)), changed: true };
}

/**
 * Keep the escalation and its deliveries as for a local one, with HealthyMitra as the channel.
 */
async function recordEscalation(row, results) {
    const { payload } = row;
    try {
        const escalationId = await addEscalation(row.circle_id, payload.escalationType, payload.content.doctors ?? payload.content.caregivers, payload.messageId ?? null);
        for (const result of results) {
            // Deliveries are kept per local user, like local ones
            const local = await findExternalIdentity(PROVIDER, result.userId);
            await addEscalationDelivery({
                escalationId,
                userId: local?.user_id ?? result.userId,
                role: result.role,
                channel: 'healthymitra',
                status: result.status,
                providerMessageId: result.resultId
            });
        }
    } catch (error) {
        console.error(`[IntegrationActions] Could not record escalation for action ${row.action_id}:`, error.message);
    }
}

function resultSentence(row, actions) {
    const status = buildActionStatus(actions) || "I couldn't send it to anyone.";
    if (row.decision === DECISIONS.auto && row.auto_send_at) {
        return `You didn't answer within ${minutesText(row.auto_send_at - row.created_at)}, so the alert went out as you set up. ${status}`;
    }
    return status;
}

async function tellOwner(row, reply, source) {
    const circle = await findCircleById(row.circle_id);
    const patient = circle ? await findUserById(circle.primary_patient_id) : null;
    events.emit('broadcast', {
        targetUsers: [row.owner_user_id],
        reply,
        from: await getAgentName(row.owner_user_id, row.circle_id),
        circleId: row.circle_id,
        patientUsername: patient?.username ?? null,
        source
    });
}
