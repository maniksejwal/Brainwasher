/**
 * @fileoverview lib/serviceSecrets.js
 * Keys for signed requests between HealthyMitra and this service. There is one secret per
 * direction, each with a current and an optional previous key so a key can be rotated
 * without downtime: a request is accepted if it verifies against either key.
 *
 * SERVICE_SECRETS_SOURCE selects where the keys come from:
 * - "env" (default, local development):
 *     HEALTHYMITRA_TO_AI_SECRET, HEALTHYMITRA_TO_AI_SECRET_PREVIOUS,
 *     AI_TO_HEALTHYMITRA_SECRET, AI_TO_HEALTHYMITRA_SECRET_PREVIOUS
 * - "aws" (deployment): AWS Secrets Manager. HEALTHYMITRA_TO_AI_SECRET_ID and
 *     AI_TO_HEALTHYMITRA_SECRET_ID name secrets whose value is JSON
 *     {"current": "...", "previous": "..."}. Keys are reloaded every
 *     SERVICE_SECRETS_REFRESH_MS (default 15 minutes).
 */

export const DIRECTIONS = {
    // Requests HealthyMitra sends to this service; verified here
    inbound: { env: 'HEALTHYMITRA_TO_AI_SECRET', secretId: 'HEALTHYMITRA_TO_AI_SECRET_ID' },
    // Requests this service sends to HealthyMitra; signed here
    outbound: { env: 'AI_TO_HEALTHYMITRA_SECRET', secretId: 'AI_TO_HEALTHYMITRA_SECRET_ID' }
};

const DEFAULT_REFRESH_MS = 15 * 60 * 1000;

let cache = {};
let loadedAt = 0;
let loading = null;
let awsClient = null;

const source = () => (process.env.SERVICE_SECRETS_SOURCE || 'env').toLowerCase();
const refreshMs = () => Number(process.env.SERVICE_SECRETS_REFRESH_MS) || DEFAULT_REFRESH_MS;

function fromEnv() {
    const keys = {};
    for (const [direction, { env }] of Object.entries(DIRECTIONS)) {
        keys[direction] = [process.env[env], process.env[`${env}_PREVIOUS`]].filter(Boolean);
    }
    return keys;
}

async function fromAws() {
    if (!awsClient) {
        const { SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager');
        awsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });
    }
    const { GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
    const keys = {};
    for (const [direction, { secretId }] of Object.entries(DIRECTIONS)) {
        const id = process.env[secretId];
        if (!id) {
            keys[direction] = [];
            continue;
        }
        const { SecretString } = await awsClient.send(new GetSecretValueCommand({ SecretId: id }));
        const value = JSON.parse(SecretString || '{}');
        keys[direction] = [value.current, value.previous].filter(Boolean);
    }
    return keys;
}

async function load() {
    if (source() === 'aws') {
        try {
            cache = await fromAws();
        } catch (error) {
            // Keep the last keys that loaded; requests fail closed only if there never were any
            console.error('[ServiceSecrets] Could not load keys from AWS Secrets Manager:', error.message);
        }
    } else {
        cache = fromEnv();
    }
    loadedAt = Date.now();
}

/**
 * The keys for one direction, current first. Empty when none are configured, in which
 * case every signed request in that direction is rejected.
 * @param {'inbound'|'outbound'} direction
 * @returns {Promise<string[]>}
 */
export async function getServiceKeys(direction) {
    if (Date.now() - loadedAt >= refreshMs() || !cache[direction]) {
        loading ??= load().finally(() => { loading = null; });
        await loading;
    }
    return cache[direction] ?? [];
}

/**
 * Forget loaded keys so the next call reloads them (tests, or after a rotation).
 */
export function resetServiceKeys() {
    cache = {};
    loadedAt = 0;
}
