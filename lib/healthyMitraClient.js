/**
 * @fileoverview lib/healthyMitraClient.js
 * Signed requests from this service to HealthyMitra (lib/serviceAuth.js), with the
 * outbound key. HEALTHYMITRA_BASE_URL is HealthyMitra's origin; without it nothing is sent.
 */
import { signRequest } from './serviceAuth.js';
import { getServiceKeys } from './serviceSecrets.js';

export const REQUEST_TIMEOUT_MS = 5000;

/**
 * POST a JSON body to HealthyMitra.
 * @param {object} params
 * @param {string} params.path - Path with query string, e.g. "/api/integrations/healthymitra-ai/actions"
 * @param {string} params.userId - The HealthyMitra user the request acts for
 * @param {string} params.purpose
 * @param {object} params.body
 * @returns {Promise<{status: number, body: object|null}>}
 * @throws {Error} When HealthyMitra is not configured, has no key, or cannot be reached
 */
export async function postToHealthyMitra({ path, userId, purpose, body, timeoutMs = REQUEST_TIMEOUT_MS }) {
    const base = process.env.HEALTHYMITRA_BASE_URL;
    if (!base) throw new Error('HEALTHYMITRA_BASE_URL is not set');
    const [key] = await getServiceKeys('outbound');
    if (!key) throw new Error('No outbound service key is configured');

    const raw = JSON.stringify(body);
    const response = await fetch(new URL(path, base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...signRequest(key, { method: 'POST', path, userId, purpose, body: raw }) },
        body: raw,
        signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    let parsed = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {
        parsed = null;
    }
    return { status: response.status, body: parsed };
}
