/**
 * @fileoverview routes/interventions.js
 *
 * REST endpoints for the persistent cross-user intervention queue.
 *
 * These routes are called by:
 *   1. tensornets/server.py  POST /agents/intervention/enqueue  → forwards here
 *   2. CompanionCoordinator.js for resolve/history queries
 *   3. Future: GUI dashboard for viewing/managing queued items
 *
 * CONSENT GATE (enqueue)
 * ----------------------
 * Before an item is written to the DB, the route checks whether
 * user A (source_user_id) has granted consent for the type of disclosure
 * the item represents:
 *
 *   concern_type                  required_consent_chain
 *   ────────────────────────────  ──────────────────────────────────────
 *   physiological_alert           'implied' or higher
 *   behavioral_flag               'implied' or higher
 *   cross_user_welfare            'explicit_limited' or higher
 *   scheduled_followup            'system' (no user A consent needed)
 *   clinical_directive            'clinical' (doctor-originated; no user A consent)
 *   consent_request               always allowed (it IS the consent request)
 *
 * 'implied' consent is satisfied if:
 *   - care_circle_members.consent_level for (source_user, circle) is 'FULL' or 'LIMITED'
 *   - OR implied_consent table has a live row for (source_user, circle, topic)
 *
 * 'explicit_limited' requires care_circle_members.consent_level = 'FULL' or 'LIMITED'.
 * 'explicit_full'    requires consent_level = 'FULL'.
 *
 * Revocation: DELETE /api/interventions/revoke-by-source/:sourceUserId
 * marks all pending items from that user as 'revoked'.
 */

import express from 'express';
import { getDb } from '../db/connection.js';
import {
    enqueueIntervention,
    resolveIntervention,
    expireByConsentRevocation,
    getInterventionHistory,
    countPendingInterventions,
    peekInterventionQueue,
} from '../db/queries_interventions.js';
import { getImpliedConsent } from '../db/queries_actions.js';

const router = express.Router();


// ─── Consent gate helper ──────────────────────────────────────────────────────

/**
 * Returns true if the source user has sufficient consent for the given concern type.
 * Returns the resolved consent_chain string to store in the DB for audit purposes.
 *
 * @param {object} params
 * @param {string} params.sourceUserId
 * @param {string} params.targetUserId
 * @param {string} params.targetCircleId
 * @param {string} params.concernType
 * @param {string} params.requestedConsentChain — what the caller claims
 * @returns {Promise<{permitted: boolean, resolvedChain: string, reason: string}>}
 */
async function checkConsentGate({ sourceUserId, targetUserId, targetCircleId, concernType, requestedConsentChain }) {

    // System and clinical items bypass user-A consent entirely
    if (concernType === 'scheduled_followup') {
        return { permitted: true, resolvedChain: 'system', reason: 'system_generated' };
    }
    if (concernType === 'clinical_directive') {
        return { permitted: true, resolvedChain: 'clinical', reason: 'doctor_originated' };
    }
    if (concernType === 'consent_request') {
        return { permitted: true, resolvedChain: 'implied', reason: 'consent_request_always_allowed' };
    }
    // No source user → system-generated
    if (!sourceUserId) {
        return { permitted: true, resolvedChain: 'system', reason: 'no_source_user' };
    }

    const db = await getDb();

    // Look up source user's consent level within the target circle
    let memberRow = null;
    if (targetCircleId) {
        memberRow = await db.get(
            `SELECT consent_level FROM care_circle_members
             WHERE circle_id = ? AND user_id = ?`,
            [targetCircleId, sourceUserId]
        ).catch(() => null);
    }

    const consentLevel = (memberRow?.consent_level || 'none').toUpperCase();
    // consentLevel: NONE | LIMITED | FULL

    // cross_user_welfare requires at least explicit_limited (LIMITED or FULL)
    if (concernType === 'cross_user_welfare') {
        if (consentLevel === 'FULL' || consentLevel === 'LIMITED') {
            return { permitted: true, resolvedChain: 'explicit_limited', reason: 'member_consent_limited_or_full' };
        }
        return {
            permitted: false,
            resolvedChain: 'none',
            reason: `cross_user_welfare requires explicit consent; source user consent_level=${consentLevel}`,
        };
    }

    // physiological_alert / behavioral_flag require implied or higher
    if (concernType === 'physiological_alert' || concernType === 'behavioral_flag') {
        // Full or limited member consent satisfies implied
        if (consentLevel === 'FULL' || consentLevel === 'LIMITED') {
            return { permitted: true, resolvedChain: 'explicit_limited', reason: 'member_consent' };
        }
        // Check implied_consent table (15-min window from voluntary topic mention)
        if (targetCircleId) {
            const implied = await getImpliedConsent(sourceUserId, targetCircleId, concernType).catch(() => null);
            if (implied) {
                return { permitted: true, resolvedChain: 'implied', reason: 'implied_consent_active' };
            }
        }
        return {
            permitted: false,
            resolvedChain: 'none',
            reason: `${concernType} requires implied consent; none found for source=${sourceUserId}`,
        };
    }

    // Default: permit with the chain the caller provided (they take responsibility)
    return { permitted: true, resolvedChain: requestedConsentChain || 'implied', reason: 'default_pass' };
}


// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/interventions/enqueue
 *
 * Enqueue a cross-user intervention item after consent gate check.
 *
 * Body: InterventionEnqueueIn (see queries_interventions.js JSDoc for field list)
 */
router.post('/interventions/enqueue', async (req, res) => {
    const {
        targetUserId,
        targetCircleId = null,
        sourceUserId = null,
        sourceCompanionId = null,
        concernType,
        concernSummary,
        suggestedAction = null,
        urgencyScore = 0.5,
        physioGate = 0.70,
        minSessionTurn = 3,
        fireAfter = null,
        deadlineAt = null,
        consentChain = 'implied',
    } = req.body;

    if (!targetUserId || !concernType || !concernSummary) {
        return res.status(400).json({ error: 'targetUserId, concernType, and concernSummary are required' });
    }

    // Consent gate
    const gate = await checkConsentGate({
        sourceUserId,
        targetUserId,
        targetCircleId,
        concernType,
        requestedConsentChain: consentChain,
    });

    if (!gate.permitted) {
        console.warn(`[InterventionQueue] Enqueue blocked by consent gate: ${gate.reason}`);
        return res.status(403).json({ error: 'consent_gate_blocked', reason: gate.reason });
    }

    const itemId = await enqueueIntervention({
        targetUserId,
        targetCircleId,
        sourceUserId,
        sourceCompanionId,
        concernType,
        concernSummary,
        suggestedAction,
        urgencyScore: Math.min(1.0, Math.max(0.0, urgencyScore)),
        physioGate,
        minSessionTurn,
        fireAfter,
        deadlineAt,
        consentChain: gate.resolvedChain,
    });

    console.log(
        `[InterventionQueue] Enqueued item=${itemId} ` +
        `target=${targetUserId} type=${concernType} urgency=${urgencyScore} ` +
        `consent=${gate.resolvedChain}`
    );

    return res.json({ item_id: itemId, consent_chain: gate.resolvedChain });
});


/**
 * POST /api/interventions/resolve
 *
 * Mark a surfaced item as completed or dismissed.
 * Body: { item_id, outcome: 'completed'|'dismissed', note? }
 */
router.post('/interventions/resolve', async (req, res) => {
    const { item_id, outcome, note } = req.body;
    if (!item_id || !outcome) {
        return res.status(400).json({ error: 'item_id and outcome are required' });
    }
    if (!['completed', 'dismissed'].includes(outcome)) {
        return res.status(400).json({ error: 'outcome must be completed or dismissed' });
    }
    await resolveIntervention(item_id, outcome, note || null);
    return res.json({ item_id, outcome });
});


/**
 * DELETE /api/interventions/revoke-by-source/:sourceUserId
 *
 * Called when a user revokes consent. Marks all pending items sourced from
 * them as 'revoked' so they are never surfaced.
 */
router.delete('/interventions/revoke-by-source/:sourceUserId', async (req, res) => {
    const { sourceUserId } = req.params;
    await expireByConsentRevocation(sourceUserId);
    console.log(`[InterventionQueue] Revoked all pending items from source=${sourceUserId}`);
    return res.json({ revoked: true, sourceUserId });
});


/**
 * GET /api/interventions/history/:userId
 *
 * Return queue history for a user (as target or source).
 * Query params: status, limit
 */
router.get('/interventions/history/:userId', async (req, res) => {
    const { userId } = req.params;
    const { status = null, limit = 50 } = req.query;
    const items = await getInterventionHistory(userId, {
        status: status || null,
        limit: parseInt(limit, 10) || 50,
    });
    return res.json({ userId, items });
});


/**
 * GET /api/interventions/peek/:userId
 *
 * Non-destructive peek at the top eligible item for a user.
 * Query params: stress_index (float), session_turn (int)
 * Used by CompanionCoordinator directly via DB, but also exposed for debugging.
 */
router.get('/interventions/peek/:userId', async (req, res) => {
    const { userId } = req.params;
    const { stress_index = '0', session_turn = '1' } = req.query;
    const item = await peekInterventionQueue(userId, {
        currentStressIndex: parseFloat(stress_index),
        currentSessionTurn: parseInt(session_turn, 10),
    });
    return res.json({ userId, item: item || null });
});


/**
 * GET /api/interventions/count/:userId
 *
 * Count pending items (for telemetry).
 */
router.get('/interventions/count/:userId', async (req, res) => {
    const { userId } = req.params;
    const count = await countPendingInterventions(userId);
    return res.json({ userId, pending_count: count });
});


export default router;
