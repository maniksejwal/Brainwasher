/**
 * @fileoverview lib/serviceAuth.js
 * Signed service-to-service requests between HealthyMitra and this service.
 *
 * Every request carries these headers:
 *   X-HM-Request-Id  unique per request (replays are rejected)
 *   X-HM-Timestamp   milliseconds since the epoch (requests older than 5 minutes are rejected)
 *   X-HM-User-Id     the HealthyMitra user the request acts for
 *   X-HM-Purpose     what the request is for, e.g. "conversation.provision"
 *   X-HM-Signature   "v1=" + hex HMAC-SHA256 of the canonical string below
 *
 * Canonical string, lines joined with "\n":
 *   v1, METHOD, path with query string, timestamp, request ID, user ID, purpose,
 *   hex SHA-256 of the raw body (of the empty string when there is no body)
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';

export const SIGNATURE_VERSION = 'v1';
export const MAX_REQUEST_AGE_MS = 5 * 60 * 1000;
export const HEADERS = {
    requestId: 'x-hm-request-id',
    timestamp: 'x-hm-timestamp',
    userId: 'x-hm-user-id',
    purpose: 'x-hm-purpose',
    signature: 'x-hm-signature'
};

export function bodyDigest(body) {
    return createHash('sha256').update(body ?? '').digest('hex');
}

export function canonicalString({ method, path, timestamp, requestId, userId, purpose, body }) {
    return [SIGNATURE_VERSION, method.toUpperCase(), path, String(timestamp), requestId, userId, purpose, bodyDigest(body)].join('\n');
}

export function computeSignature(key, fields) {
    return `${SIGNATURE_VERSION}=${createHmac('sha256', key).update(canonicalString(fields)).digest('hex')}`;
}

/**
 * Headers for a signed request.
 * @param {string} key - The current key for this direction
 * @param {object} request - { method, path, userId, purpose, body }; body is the exact string sent
 * @returns {Record<string, string>}
 */
export function signRequest(key, { method, path, userId, purpose, body = '', timestamp = Date.now(), requestId = randomUUID() }) {
    return {
        'X-HM-Request-Id': requestId,
        'X-HM-Timestamp': String(timestamp),
        'X-HM-User-Id': userId,
        'X-HM-Purpose': purpose,
        'X-HM-Signature': computeSignature(key, { method, path, timestamp, requestId, userId, purpose, body })
    };
}

/**
 * Check a signature against every accepted key, in constant time per key.
 * @param {string[]} keys - Current key first, then the previous one during a rotation
 * @returns {boolean}
 */
export function verifySignature(keys, fields, signature) {
    if (typeof signature !== 'string') return false;
    const given = Buffer.from(signature);
    return keys.some(key => {
        const expected = Buffer.from(computeSignature(key, fields));
        return expected.length === given.length && timingSafeEqual(expected, given);
    });
}
