/**
 * @fileoverview services/integrationService.js
 * HealthyMitra identities and conversations. A HealthyMitra user is linked to one local
 * user through external_identities and has one private conversation. HealthyMitra's
 * user ID is the identity; the display name is only a label.
 */
import { randomUUID } from 'crypto';
import {
    addUser,
    findUserByUsername,
    findExternalIdentity,
    addExternalIdentity,
    addConversation,
    findIdempotencyRecord,
    addIdempotencyRecord
} from '../db/index.js';

export const PROVIDER = 'healthymitra';
export const PROVISION_PURPOSE = 'conversation.provision';
const MAX_DISPLAY_NAME = 60;

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
 * The local user for a HealthyMitra user, created on first use.
 * @returns {Promise<{userId: string, created: boolean}>}
 */
export async function resolveIdentity(externalUserId, displayName) {
    const existing = await findExternalIdentity(PROVIDER, externalUserId);
    if (existing) return { userId: existing.user_id, created: false };
    const userId = `hm_${randomUUID()}`;
    await addUser(userId, await availableUsername(displayName));
    const link = await addExternalIdentity(PROVIDER, externalUserId, userId);
    return { userId: link.user_id, created: link.user_id === userId };
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
    return serialized(externalUserId, async () => {
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
