/**
 * @fileoverview routes/integrations.js
 * Routes HealthyMitra calls from its server, mounted at /api/integrations/healthymitra.
 * Every route requires a signed service request (middleware/serviceAuth.js); user
 * session tokens are not accepted. Errors are { error: { code, message } }.
 */
import express from 'express';
import { requireServiceRequest, integrationError } from '../middleware/serviceAuth.js';
import {
    provisionConversation,
    submitConversationMessage,
    getConversationHistory,
    contextProblem,
    IntegrationError,
    PROVISION_PURPOSE,
    MESSAGE_PURPOSE,
    HISTORY_PURPOSE,
    MAX_MESSAGE_LENGTH,
    HISTORY_PAGE_DEFAULT,
    HISTORY_PAGE_MAX
} from '../services/integrationService.js';
import { kickConversationWorker } from '../services/conversationJobs.js';

const router = express.Router();
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const REQUEST_ID_PATTERN = IDEMPOTENCY_KEY_PATTERN;

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

// Submit a message with its context snapshot. Saved before the answer, then processed by the
// job worker; a retry with the same requestId returns the same message and job.
router.post('/conversations/:conversationId/messages', requireServiceRequest(MESSAGE_PURPOSE), async (req, res) => {
    const { requestId, text, context } = req.body || {};
    if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
        return integrationError(res, 400, 'invalid_request', 'requestId of 8-128 letters, digits, "-" or "_" is required');
    }
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_MESSAGE_LENGTH) {
        return integrationError(res, 400, 'invalid_request', `text must be 1-${MAX_MESSAGE_LENGTH} characters`);
    }
    const problem = contextProblem(context);
    if (problem) return integrationError(res, 400, 'invalid_request', problem);
    try {
        const { status, body, queued } = await submitConversationMessage({
            externalUserId: req.serviceRequest.userId,
            conversationId: req.params.conversationId,
            requestId,
            text,
            context
        });
        res.status(status).json(body);
        if (queued) kickConversationWorker();
    } catch (error) {
        handleError(res, error, 'Could not accept the message');
    }
});

// Conversation history: ?after=<cursor> for new messages (polling), ?before=<cursor> for
// older ones, neither for the latest page. &limit= up to HISTORY_PAGE_MAX.
router.get('/conversations/:conversationId/messages', requireServiceRequest(HISTORY_PURPOSE), async (req, res) => {
    const cursor = (name) => {
        const value = req.query[name];
        if (value === undefined) return null;
        return /^\d{1,15}$/.test(value) ? Number(value) : NaN;
    };
    const after = cursor('after');
    const before = cursor('before');
    const limit = req.query.limit === undefined ? HISTORY_PAGE_DEFAULT : Number(req.query.limit);
    if (Number.isNaN(after) || Number.isNaN(before) || (after != null && before != null)
        || !Number.isInteger(limit) || limit < 1 || limit > HISTORY_PAGE_MAX) {
        return integrationError(res, 400, 'invalid_request', `Use at most one of after/before (numeric cursors) and limit 1-${HISTORY_PAGE_MAX}`);
    }
    try {
        res.status(200).json(await getConversationHistory({
            externalUserId: req.serviceRequest.userId,
            conversationId: req.params.conversationId,
            after,
            before,
            limit
        }));
    } catch (error) {
        handleError(res, error, 'Could not read the conversation');
    }
});

function handleError(res, error, message) {
    if (error instanceof IntegrationError) return integrationError(res, error.status, error.code, error.message);
    console.error(`[Integrations] ${message}:`, error.message);
    integrationError(res, 500, 'internal_error', message);
}

// Anything else under the integration prefix is not a route
router.use((req, res) => integrationError(res, 404, 'not_found', 'No such integration route'));

export default router;
