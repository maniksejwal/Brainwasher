/**
 * @fileoverview db/queries_interventions.js
 *
 * Persistent cross-user intervention queue.
 *
 * CONCEPT
 * -------
 * When companion A detects a significant event for user A (physiological spike,
 * crisis disclosure, behavioral flag, relapse signal), it may need to prompt
 * companion B to act during B's next conversation with user B.
 *
 * This is NOT the same as sharing raw information. The queue entry carries:
 *   - A privacy-filtered content summary (no raw user A disclosures unless consent granted)
 *   - A suggested action (from the action_selector.js taxonomy)
 *   - Timing constraints: fire_after (earliest), deadline_at (hard expiry)
 *   - Physio readiness gate: only surface if user B's stress_index < physio_gate
 *   - Session turn gate: minimum turns before introduction (don't cold-open with a crisis)
 *   - Consent chain: what consent from user A permitted this enqueue
 *
 * ORDERING (priority queue semantics)
 * ------------------------------------
 * Items are retrieved by: urgency_score DESC, deadline_at ASC
 * → Most urgent, soonest deadline fires first.
 * → Tied urgency resolves in favour of the item that expires sooner.
 *
 * CONSENT
 * -------
 * Enqueue is gated by consent before calling this module. The consent_chain
 * field records the consent basis at insertion time (audit trail).
 * Consent revocation by user A should call expireByConsentRevocation(userId_A)
 * which marks all pending items originating from A as 'revoked'.
 *
 * STATUS LIFECYCLE
 * ----------------
 *   pending   → surfaced  (item was injected into companion B's conversation)
 *   pending   → expired   (deadline_at passed without surfacing)
 *   pending   → revoked   (source user A revoked consent after enqueue)
 *   surfaced  → dismissed (user B's companion deliberately skipped after surfacing)
 *   surfaced  → completed (the concern was addressed)
 *
 * TABLE: intervention_queue — created by addInterventionQueueTable() below.
 * Call this from schema.js initializeDatabase() or server.js startup.
 */

import { getDb } from './connection.js';
import { randomUUID } from 'crypto';

// ─── Schema ──────────────────────────────────────────────────────────────────

/**
 * Create the intervention_queue table if it doesn't exist.
 * Called from schema.js; idempotent.
 */
export async function addInterventionQueueTable() {
    const db = await getDb();
    await db.exec(`
        CREATE TABLE IF NOT EXISTS intervention_queue (
            item_id             TEXT PRIMARY KEY,

            -- Target: whose conversation receives this
            target_user_id      TEXT NOT NULL,
            target_circle_id    TEXT,

            -- Source: which companion detected the event (null = system-generated)
            source_user_id      TEXT,
            source_companion_id TEXT,

            -- Content
            concern_type        TEXT NOT NULL,
            -- concern_type values:
            --   'physiological_alert'  — stress spike, HRV crash, panic indicators
            --   'behavioral_flag'      — avoidance pattern, relapse signal, medication miss
            --   'cross_user_welfare'   — companion A asking companion B to check on user B
            --   'scheduled_followup'   — a previously agreed future plan, now due
            --   'clinical_directive'   — doctor-originated instruction for companion
            --   'consent_request'      — companion A needs user B to grant consent for something
            concern_summary     TEXT NOT NULL,
            -- Privacy-filtered natural language summary.
            -- NEVER contains verbatim user A disclosures unless consent_chain = 'explicit_full'.
            -- Companion B's LLM sees only this, not the raw source data.

            suggested_action    TEXT,
            -- Action taxonomy key (from action_selector.js) that companion B should consider.
            -- e.g. 'safety_protocol', 'validate', 'probing_question', 'psychoeducation'

            urgency_score       REAL NOT NULL DEFAULT 0.5,
            -- 0.0–1.0. Determines queue position.
            -- Guidelines:
            --   0.9–1.0  crisis / immediate safety risk (suicidality, acute relapse)
            --   0.7–0.89 significant clinical concern (stress AUC > 0.8 for 2+ sessions)
            --   0.5–0.69 behavioral / relational flag (avoidance pattern, trust rupture)
            --   0.2–0.49 routine follow-up, psychoeducation opportunity
            --   0.0–0.19 low-urgency wellbeing nudge

            physio_gate         REAL NOT NULL DEFAULT 0.70,
            -- Maximum stress_index at which this item may be surfaced.
            -- If user B's current stress_index >= physio_gate, defer to next turn.
            -- High-urgency items may have physio_gate = 1.0 (always surface regardless).

            min_session_turn    INTEGER NOT NULL DEFAULT 3,
            -- Don't surface before this turn number within the session.
            -- Allows rapport/warmup before introducing an injected concern.

            -- Timing gates
            fire_after          INTEGER,
            -- Epoch ms. Do not surface before this time.
            -- Set to end-of-current-session to prevent mid-session injection.

            deadline_at         INTEGER,
            -- Epoch ms. After this, mark as 'expired' and never surface.
            -- NULL = no hard deadline (for non-time-sensitive items).

            -- Consent audit
            consent_chain       TEXT NOT NULL DEFAULT 'implied',
            -- 'explicit_full'    — user A granted explicit full disclosure consent
            -- 'explicit_limited' — user A granted limited consent (summary only, no verbatim)
            -- 'implied'          — implied consent from user A's voluntary topic mention
            -- 'clinical'         — clinical directive; user A consent not required (doctor-originated)
            -- 'system'           — system-generated (e.g. scheduled_followup from future_plans)

            -- Status tracking
            status              TEXT NOT NULL DEFAULT 'pending',
            surfaced_at         INTEGER,    -- when companion B first injected this item
            session_turn_surfaced INTEGER, -- turn number within the session when surfaced
            resolved_at         INTEGER,   -- when marked completed/dismissed/expired
            resolution_note     TEXT,      -- companion B's brief note on outcome

            inserted_at         INTEGER NOT NULL,

            FOREIGN KEY (target_user_id)  REFERENCES users(user_id),
            FOREIGN KEY (source_user_id)  REFERENCES users(user_id)
        );

        CREATE INDEX IF NOT EXISTS idx_iq_target_pending
            ON intervention_queue(target_user_id, status, fire_after, deadline_at);

        CREATE INDEX IF NOT EXISTS idx_iq_urgency
            ON intervention_queue(target_user_id, urgency_score DESC, deadline_at ASC)
            WHERE status = 'pending';

        CREATE INDEX IF NOT EXISTS idx_iq_source
            ON intervention_queue(source_user_id, inserted_at);
    `);

    console.log('[Schema] Intervention queue table added');
}


// ─── Write operations ─────────────────────────────────────────────────────────

/**
 * Enqueue a new intervention item.
 *
 * @param {object} params
 * @param {string}  params.targetUserId
 * @param {string}  [params.targetCircleId]
 * @param {string}  [params.sourceUserId]         — null for system-generated
 * @param {string}  [params.sourceCompanionId]    — e.g. 'medical_companion'
 * @param {string}  params.concernType            — see concern_type values above
 * @param {string}  params.concernSummary         — privacy-filtered natural language
 * @param {string}  [params.suggestedAction]      — action taxonomy key
 * @param {number}  [params.urgencyScore=0.5]     — 0.0–1.0
 * @param {number}  [params.physioGate=0.70]      — surface only if stress_index < this
 * @param {number}  [params.minSessionTurn=3]     — minimum session turn before surfacing
 * @param {number}  [params.fireAfter]            — epoch ms; null = immediately eligible
 * @param {number}  [params.deadlineAt]           — epoch ms; null = no hard deadline
 * @param {string}  [params.consentChain='implied']
 * @returns {Promise<string>} item_id of the inserted row
 */
export async function enqueueIntervention(params) {
    const db = await getDb();
    const itemId = randomUUID();
    const now = Date.now();

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
    } = params;

    await db.run(`
        INSERT INTO intervention_queue (
            item_id, target_user_id, target_circle_id,
            source_user_id, source_companion_id,
            concern_type, concern_summary, suggested_action,
            urgency_score, physio_gate, min_session_turn,
            fire_after, deadline_at, consent_chain,
            status, inserted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `, [
        itemId, targetUserId, targetCircleId,
        sourceUserId, sourceCompanionId,
        concernType, concernSummary, suggestedAction,
        urgencyScore, physioGate, minSessionTurn,
        fireAfter, deadlineAt, consentChain,
        now,
    ]);

    return itemId;
}


// ─── Read operations ──────────────────────────────────────────────────────────

/**
 * Peek at the top item eligible for this user this turn (does NOT update status).
 *
 * Eligibility criteria:
 *   1. status = 'pending'
 *   2. fire_after IS NULL OR fire_after <= now
 *   3. deadline_at IS NULL OR deadline_at > now
 *   4. currentStressIndex < physio_gate
 *   5. currentSessionTurn >= min_session_turn
 *
 * Returns the highest-urgency, soonest-deadline eligible item, or null.
 *
 * @param {string} targetUserId
 * @param {object} [opts]
 * @param {number} [opts.currentStressIndex=0.0]  — from physio state
 * @param {number} [opts.currentSessionTurn=1]    — current turn within this session
 * @returns {Promise<object|null>}
 */
export async function peekInterventionQueue(targetUserId, opts = {}) {
    const db = await getDb();
    const {
        currentStressIndex = 0.0,
        currentSessionTurn = 1,
    } = opts;
    const now = Date.now();

    // Expire stale items first (best-effort, non-blocking on failure)
    expireStaleItems(targetUserId).catch(() => {});

    const row = await db.get(`
        SELECT * FROM intervention_queue
        WHERE target_user_id = ?
          AND status = 'pending'
          AND (fire_after IS NULL OR fire_after <= ?)
          AND (deadline_at IS NULL OR deadline_at > ?)
          AND ? < physio_gate
          AND ? >= min_session_turn
        ORDER BY urgency_score DESC, deadline_at ASC NULLS LAST
        LIMIT 1
    `, [targetUserId, now, now, currentStressIndex, currentSessionTurn]);

    return row || null;
}


/**
 * Mark an item as 'surfaced' — called when companion B injects the item into the turn.
 * Returns the item so the caller can use it without a second query.
 *
 * @param {string} itemId
 * @param {number} sessionTurn — current session turn
 * @returns {Promise<object|null>}
 */
export async function markSurfaced(itemId, sessionTurn) {
    const db = await getDb();
    const now = Date.now();
    await db.run(`
        UPDATE intervention_queue
        SET status = 'surfaced', surfaced_at = ?, session_turn_surfaced = ?
        WHERE item_id = ? AND status = 'pending'
    `, [now, sessionTurn, itemId]);
    return db.get('SELECT * FROM intervention_queue WHERE item_id = ?', [itemId]);
}


/**
 * Mark a surfaced item as resolved (completed or dismissed).
 *
 * @param {string} itemId
 * @param {'completed'|'dismissed'} outcome
 * @param {string} [note]
 */
export async function resolveIntervention(itemId, outcome, note = null) {
    const db = await getDb();
    await db.run(`
        UPDATE intervention_queue
        SET status = ?, resolved_at = ?, resolution_note = ?
        WHERE item_id = ?
    `, [outcome, Date.now(), note, itemId]);
}


/**
 * Expire all pending items whose deadline has passed for a given user.
 * Called lazily before every peek; also safe to call from a cron.
 */
export async function expireStaleItems(targetUserId) {
    const db = await getDb();
    const now = Date.now();
    await db.run(`
        UPDATE intervention_queue
        SET status = 'expired', resolved_at = ?
        WHERE target_user_id = ?
          AND status = 'pending'
          AND deadline_at IS NOT NULL
          AND deadline_at <= ?
    `, [now, targetUserId, now]);
}


/**
 * Revoke all pending items sourced from a specific user (consent revocation).
 * Marks them 'revoked' so they are never surfaced and appear in the audit trail.
 *
 * @param {string} sourceUserId — the user whose consent was revoked
 */
export async function expireByConsentRevocation(sourceUserId) {
    const db = await getDb();
    await db.run(`
        UPDATE intervention_queue
        SET status = 'revoked', resolved_at = ?, resolution_note = 'consent_revoked'
        WHERE source_user_id = ?
          AND status = 'pending'
    `, [Date.now(), sourceUserId]);
}


// ─── Audit / reporting ────────────────────────────────────────────────────────

/**
 * Return all queue items for a user in any status (for audit / GUI display).
 * Most recent first.
 *
 * @param {string} userId — target OR source user
 * @param {object} [opts]
 * @param {string} [opts.status]   — filter by status; omit for all
 * @param {number} [opts.limit=50]
 * @returns {Promise<object[]>}
 */
export async function getInterventionHistory(userId, opts = {}) {
    const db = await getDb();
    const { status = null, limit = 50 } = opts;

    if (status) {
        return db.all(`
            SELECT * FROM intervention_queue
            WHERE (target_user_id = ? OR source_user_id = ?) AND status = ?
            ORDER BY inserted_at DESC LIMIT ?
        `, [userId, userId, status, limit]);
    }
    return db.all(`
        SELECT * FROM intervention_queue
        WHERE target_user_id = ? OR source_user_id = ?
        ORDER BY inserted_at DESC LIMIT ?
    `, [userId, userId, limit]);
}


/**
 * Count pending items in the queue for a user (for telemetry / training metrics).
 *
 * @param {string} targetUserId
 * @returns {Promise<number>}
 */
export async function countPendingInterventions(targetUserId) {
    const db = await getDb();
    const row = await db.get(`
        SELECT COUNT(*) as cnt FROM intervention_queue
        WHERE target_user_id = ? AND status = 'pending'
    `, [targetUserId]);
    return row?.cnt ?? 0;
}
