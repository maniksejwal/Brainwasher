/**
 * @fileoverview routes/integrations.js
 * Routes HealthyMitra calls from its server, mounted at /api/integrations/healthymitra.
 * Every route requires a signed service request (middleware/serviceAuth.js); user
 * session tokens are not accepted. Errors are { error: { code, message } }.
 */
import express from 'express';
import { requireServiceRequest, integrationError } from '../middleware/serviceAuth.js';
import { provisionConversation, IntegrationError, PROVISION_PURPOSE } from '../services/integrationService.js';

const router = express.Router();
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

// Provision the user's identity and single private conversation
router.post('/conversations', requireServiceRequest(PROVISION_PURPOSE), async (req, res) => {
    const idempotencyKey = req.get('idempotency-key');
    if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
        return integrationError(res, 400, 'invalid_request', 'An Idempotency-Key header of 8-128 letters, digits, "-" or "_" is required');
    }
    const { displayName } = req.body || {};
    if (displayName !== undefined && typeof displayName !== 'string') {
        return integrationError(res, 400, 'invalid_request', 'displayName must be a string');
    }
    try {
        const { status, body } = await provisionConversation({
            externalUserId: req.serviceRequest.userId,
            displayName,
            idempotencyKey
        });
        res.status(status).json(body);
    } catch (error) {
        if (error instanceof IntegrationError) return integrationError(res, error.status, error.code, error.message);
        console.error('[Integrations] Provisioning failed:', error.message);
        integrationError(res, 500, 'internal_error', 'Could not provision the conversation');
    }
});

// Anything else under the integration prefix is not a route
router.use((req, res) => integrationError(res, 404, 'not_found', 'No such integration route'));

export default router;
