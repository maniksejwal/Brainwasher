/**
 * @fileoverview middleware/serviceAuth.js
 * Accepts only signed HealthyMitra requests (lib/serviceAuth.js) on integration routes.
 * User session tokens are never accepted here, and user-session routes never accept
 * service signatures. On success, req.serviceRequest = { requestId, userId, purpose }.
 */
import { HEADERS, MAX_REQUEST_AGE_MS, verifySignature } from '../lib/serviceAuth.js';
import { getServiceKeys } from '../lib/serviceSecrets.js';
import { recordIntegrationRequestId } from '../db/index.js';

// HealthyMitra user IDs (MongoDB ObjectIds today) and request IDs (UUIDs)
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;

export function integrationError(res, status, code, message) {
    return res.status(status).json({ error: { code, message } });
}

/**
 * Keep the exact request bytes so the body digest can be checked. Pass as
 * express.json({ verify: captureRawBody }).
 */
export function captureRawBody(req, res, buf) {
    req.rawBody = buf;
}

const windows = new Map();

/**
 * Fixed one-minute window per HealthyMitra user and route.
 * @returns {boolean} True if the request is within the limit
 */
function withinRateLimit(userId, route, now) {
    const limit = Number(process.env.INTEGRATION_RATE_LIMIT_PER_MINUTE) || DEFAULT_RATE_LIMIT_PER_MINUTE;
    const key = `${userId}:${route}`;
    const window = windows.get(key);
    if (!window || now - window.start >= 60000) {
        windows.set(key, { start: now, count: 1 });
        return true;
    }
    window.count += 1;
    return window.count <= limit;
}

export function resetRateLimits() {
    windows.clear();
}

/**
 * Require a signed request made for one purpose.
 * @param {string} purpose - The X-HM-Purpose this route accepts
 */
export function requireServiceRequest(purpose) {
    return async (req, res, next) => {
        const header = (name) => req.get(name);
        const requestId = header(HEADERS.requestId);
        const timestamp = header(HEADERS.timestamp);
        const userId = header(HEADERS.userId);
        const signature = header(HEADERS.signature);
        const givenPurpose = header(HEADERS.purpose);

        if (!requestId || !timestamp || !userId || !givenPurpose || !signature) {
            return integrationError(res, 401, 'unsigned_request', 'Signed request headers are required');
        }
        if (!ID_PATTERN.test(requestId) || !ID_PATTERN.test(userId) || !/^\d{1,16}$/.test(timestamp)) {
            return integrationError(res, 400, 'invalid_request', 'Malformed signed request headers');
        }
        const now = Date.now();
        if (Math.abs(now - Number(timestamp)) > MAX_REQUEST_AGE_MS) {
            return integrationError(res, 401, 'expired_request', 'Request timestamp is outside the accepted window');
        }

        const keys = await getServiceKeys('inbound');
        if (keys.length === 0) {
            return integrationError(res, 503, 'not_configured', 'Service authentication is not configured');
        }
        const fields = {
            method: req.method,
            path: req.originalUrl,
            timestamp,
            requestId,
            userId,
            purpose: givenPurpose,
            body: req.rawBody ?? ''
        };
        if (!verifySignature(keys, fields, signature)) {
            return integrationError(res, 401, 'invalid_signature', 'Request signature does not verify');
        }
        // Checked after the signature, so the signed purpose is the one compared
        if (givenPurpose !== purpose) {
            return integrationError(res, 403, 'purpose_mismatch', `This route requires purpose "${purpose}"`);
        }
        // Recorded only after the signature verifies, so unsigned traffic cannot fill the store
        if (!(await recordIntegrationRequestId(requestId, now))) {
            return integrationError(res, 409, 'replayed_request', 'This request ID was already used');
        }
        if (!withinRateLimit(userId, purpose, now)) {
            return integrationError(res, 429, 'rate_limited', 'Too many requests for this user');
        }

        req.serviceRequest = { requestId, userId, purpose };
        next();
    };
}
