/**
 * @fileoverview scripts/hm_signed_request.mjs
 * Sends one signed request to a running server the way HealthyMitra does, for testing
 * the integration routes locally. Uses HEALTHYMITRA_TO_AI_SECRET from .env.
 *
 * Usage:
 *   node scripts/hm_signed_request.mjs <METHOD> <path> --user <hmUserId> --purpose <purpose>
 *       [--body <json>] [--idempotency-key <key>] [--base <url>]
 *
 * Example:
 *   node scripts/hm_signed_request.mjs POST /api/integrations/healthymitra/conversations
 *       --user 665f1c2ab3e4d5f6a7b8c9d0 --purpose conversation.provision
 *       --body "{\"displayName\":\"Asha\"}" --idempotency-key provision-665f1c2a
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { signRequest } from '../lib/serviceAuth.js';

const [method, path, ...rest] = process.argv.slice(2);
const option = (name) => {
    const i = rest.indexOf(`--${name}`);
    return i === -1 ? undefined : rest[i + 1];
};
const userId = option('user');
const purpose = option('purpose');
if (!method || !path?.startsWith('/') || !userId || !purpose) {
    console.error('Usage: node scripts/hm_signed_request.mjs <METHOD> <path> --user <hmUserId> --purpose <purpose> [--body <json>] [--idempotency-key <key>] [--base <url>]');
    process.exit(1);
}
const key = process.env.HEALTHYMITRA_TO_AI_SECRET;
if (!key) {
    console.error('HEALTHYMITRA_TO_AI_SECRET is not set');
    process.exit(1);
}
const base = option('base') || `http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 5000}`;
const body = option('body') ?? '';

const headers = signRequest(key, { method, path, userId, purpose, body });
if (body) headers['Content-Type'] = 'application/json';
headers['Idempotency-Key'] = option('idempotency-key') || randomUUID();

const res = await fetch(base + path, { method, headers, body: body || undefined });
console.log(res.status, await res.text());
