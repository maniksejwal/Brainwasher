import { getDb } from './connection.js';

// Half-life for recency decay: facts lose half their weight after this many days.
// 180 days = 6 months.  Medical/clinical facts should be re-confirmed within this window.
const RECENCY_HALF_LIFE_DAYS = 180;

// Safety-critical categories that bypass the recency decay and are always included
// when confidence >= 0.5 (regardless of age).
const SAFETY_CRITICAL_CATEGORIES = new Set([
    'medication', 'allergy', 'diagnosis', 'emergency_contact', 'dnr', 'consent'
]);

/**
 * Compute a recency weight for a fact.
 * Returns 1.0 for session-local facts (observed_at within current session window),
 * exponential decay for older facts, bypass for safety-critical categories.
 *
 * @param {object} fact   - Row from facts_v2
 * @param {number} nowMs  - Current timestamp in ms
 * @param {number} sessionStartMs - Session start timestamp in ms
 * @returns {number}  weight ∈ (0, 1]
 */
function _recencyWeight(fact, nowMs, sessionStartMs) {
    const category = (fact.category || '').toLowerCase();

    // Session-local: always weight 1.0 — prevents false negatives from the current session
    if (fact.observed_at && fact.observed_at >= sessionStartMs) return 1.0;

    // Safety-critical: bypass decay — false negatives here are clinically dangerous
    if (SAFETY_CRITICAL_CATEGORIES.has(category)) return 1.0;

    const ageDays = (nowMs - (fact.valid_from || fact.created_at)) / 86_400_000;
    const lambda = Math.log(2) / RECENCY_HALF_LIFE_DAYS;   // ln(2) / half_life
    return Math.exp(-lambda * ageDays);                      // exponential decay
}

/**
 * Score how topically aligned a fact is with the current MPS semantic context.
 *
 * Currently uses keyword overlap between the fact's value/category and the
 * MPS semantic hint string.  When ALS training produces real bond embeddings,
 * swap this for a cosine similarity against the bond vector.
 *
 * @param {object} fact         - Row from facts_v2
 * @param {string} mpsHint      - e.g. "moderate_stress, topic: medication, phase: rapport"
 * @param {string} currentTopic - Extracted topic from inputUnderstanding result
 * @returns {number}  alignment ∈ [0.5, 1.0]  (never zero — avoid complete suppression)
 */
function _mpsAlignment(fact, mpsHint, currentTopic) {
    if (!mpsHint && !currentTopic) return 0.75;   // no MPS context → neutral

    const needle = `${mpsHint} ${currentTopic}`.toLowerCase();
    const haystack = `${fact.fact_key} ${fact.value || ''} ${fact.category || ''} ${fact.target_object || ''}`.toLowerCase();

    const hintWords = needle.split(/\W+/).filter(w => w.length > 3);
    if (!hintWords.length) return 0.75;

    const matches = hintWords.filter(w => haystack.includes(w)).length;
    const overlap = matches / hintWords.length;

    // Map overlap → [0.5, 1.0] so that off-topic facts are suppressed but never zeroed
    return 0.5 + 0.5 * Math.min(overlap * 2, 1.0);
}

/**
 * Retrieve relevant facts for injection into the companion context (RAG retrieval).
 *
 * FILTER PIPELINE (in order):
 *   1. Hard gates: is_current=1, not expired (valid_until), confidence >= minConfidence
 *   2. Privacy gate: sensitivity level must match caller's clearance
 *   3. Recency weight: exponential decay with 180-day half-life; session-local = 1.0;
 *      safety-critical categories bypass decay entirely
 *   4. MPS alignment score: keyword overlap with mpsHint + currentTopic (swap for
 *      embedding cosine similarity once ALS training produces bond vectors)
 *   5. Combined score = confidence × recencyWeight × mpsAlignment
 *   6. Top-K by combined score; safety-critical facts always included regardless of rank
 *
 * OUTPUT FORMAT:
 *   Returns a structured plain-text block, NOT raw fact rows.
 *   The LLM should never see the raw fact schema.
 *   Session-local facts (from this session) are labelled separately.
 *
 * FALSE POSITIVE PREVENTION:
 *   - Hard expiry: facts with valid_until < now are excluded
 *   - Recency decay: stale facts from years ago get near-zero weight
 *   - Confidence gate: facts below minConfidence (default 0.3) excluded
 *
 * FALSE NEGATIVE PREVENTION:
 *   - Session-local override: facts observed in the current session always get
 *     recency weight 1.0 and are separated in the output block
 *   - Safety-critical bypass: medications, allergies, diagnoses always included
 *
 * @param {object} params
 * @param {string}   params.circleId        - Care circle ID
 * @param {string}   params.subjectId       - Subject user ID (patient)
 * @param {string}   [params.mpsHint]       - MPS semantic hint from getLongitudinalHint()
 * @param {string}   [params.currentTopic]  - Topic extracted by inputUnderstanding
 * @param {string}   [params.sensitivity]   - Max sensitivity level: 'public'|'circle'|'private'|'sensitive'
 * @param {number}   [params.sessionStartMs]- Session start timestamp in ms (default: 1 hour ago)
 * @param {number}   [params.topK]          - Max non-session facts to inject (default 6)
 * @param {number}   [params.minConfidence] - Minimum confidence to include (default 0.3)
 * @returns {Promise<{block: string, facts: object[]}>}
 *   block: formatted string ready for prompt injection
 *   facts: raw scored rows (for logging / discrepancy audit)
 */
export async function retrieveRelevantFacts({
    circleId,
    subjectId,
    mpsHint          = '',
    currentTopic     = '',
    sensitivity      = 'circle',
    sessionStartMs   = Date.now() - 3_600_000,   // default: 1 hour = one session
    topK             = 6,
    minConfidence    = 0.3,
} = {}) {
    const db  = await getDb();
    const now = Date.now();

    // Sensitivity clearance levels (inclusive downward)
    const SENSITIVITY_ORDER = ['public', 'circle', 'private', 'sensitive'];
    const maxLevel = SENSITIVITY_ORDER.indexOf(sensitivity);
    const allowedLevels = SENSITIVITY_ORDER.slice(0, maxLevel + 1);
    const placeholders  = allowedLevels.map(() => '?').join(', ');

    const rows = await db.all(
        `SELECT * FROM facts_v2
         WHERE is_current = 1
           AND circle_id  = ?
           AND confidence >= ?
           AND (subject_id = ? OR subject_id IS NULL)
           AND (valid_until IS NULL OR valid_until > ?)
           AND (sensitivity IS NULL OR sensitivity IN (${placeholders}))
         ORDER BY confidence DESC`,
        [circleId, minConfidence, subjectId, now, ...allowedLevels]
    );

    // Score each fact
    const scored = rows.map(f => {
        const recency   = _recencyWeight(f, now, sessionStartMs);
        const alignment = _mpsAlignment(f, mpsHint, currentTopic);
        const score     = f.confidence * recency * alignment;
        const isSession = f.observed_at && f.observed_at >= sessionStartMs;
        const isSafety  = SAFETY_CRITICAL_CATEGORIES.has((f.category || '').toLowerCase());
        return { ...f, _recency: recency, _alignment: alignment, _score: score, _isSession: isSession, _isSafety: isSafety };
    });

    // Partition
    const sessionFacts  = scored.filter(f => f._isSession);
    const safetyFacts   = scored.filter(f => f._isSafety && !f._isSession);
    const otherFacts    = scored
        .filter(f => !f._isSession && !f._isSafety)
        .sort((a, b) => b._score - a._score)
        .slice(0, topK);

    const allSelected = [...sessionFacts, ...safetyFacts, ...otherFacts];

    if (!allSelected.length) {
        return { block: '', facts: [] };
    }

    // Build the structured output block
    const formatFact = (f) => {
        const when = f.observed_at
            ? new Date(f.observed_at).toISOString().slice(0, 10)
            : (f.valid_from ? new Date(f.valid_from).toISOString().slice(0, 10) : 'unknown date');
        const conf = f.confidence < 0.7 ? ` [confidence: ${(f.confidence * 100).toFixed(0)}%]` : '';
        const obj  = f.target_object ? ` (${f.target_object})` : '';
        return `- ${f.fact_key}${obj}: ${f.value || '—'} [${when}]${conf}`;
    };

    const lines = [];

    if (sessionFacts.length) {
        lines.push('CURRENT SESSION:');
        sessionFacts.forEach(f => lines.push(formatFact(f)));
    }

    const persistent = [...safetyFacts, ...otherFacts];
    if (persistent.length) {
        lines.push(sessionFacts.length ? '' : '');
        lines.push('KNOWN CONTEXT:');
        persistent.forEach(f => lines.push(formatFact(f)));
    }

    return {
        block: lines.filter(l => l !== '').join('\n'),
        facts: allSelected,
    };
}


 * This handles the bi-temporal aspect by setting valid_from/valid_until.
 * If a current fact exists for the key, it is marked as not current (soft invalidation) 
 * or we just rely on `is_current` flag.
 */
export async function addFact(circleId, factKey, value, metadata = {}) {
    const db = await getDb();
    const {
        category = 'general',
        confidence = 1.0,
        sourceType = 'user',
        reportedBy,
        provenance = null,
        validFrom = Date.now(),
        validUntil = null,
        visibility = 'circle',
        subjectId = null,     // NEW
        targetObject = null,  // NEW
        sensitivity = 'normal', // NEW
        observedAt = Date.now() // NEW: Default to now if not provided
    } = metadata;

    const now = Date.now();
    const effectiveValidFrom = validFrom || now;

    // 1. Mark existing current fact for this key as not current and close its validity window
    await db.run(`
        UPDATE facts_v2 
        SET is_current = 0, valid_until = ?
        WHERE circle_id = ? AND fact_key = ? AND is_current = 1
    `, [effectiveValidFrom, circleId, factKey]);

    // 2. Insert new fact
    const result = await db.run(`
        INSERT INTO facts_v2 (
            circle_id, fact_key, value, category, confidence, 
            source_type, reported_by, provenance, 
            valid_from, valid_until, visibility, is_current, created_at,
            subject_id, target_object, sensitivity, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `, [
        circleId, factKey, value, category, confidence,
        sourceType, reportedBy, provenance,
        effectiveValidFrom, validUntil, visibility, now,
        subjectId, targetObject, sensitivity, observedAt
    ]);

    return result.lastID;
}

/**
 * Get the current active fact for a key.
 */
export async function getCurrentFact(circleId, factKey) {
    const db = await getDb();
    return db.get(`
        SELECT * FROM facts_v2 
        WHERE circle_id = ? AND fact_key = ? AND is_current = 1
    `, [circleId, factKey]);
}

/**
 * Get all current facts for a circle, optionally filtered by category.
 */
export async function getFacts(circleId, category = null) {
    const db = await getDb();
    let query = `SELECT * FROM facts_v2 WHERE circle_id = ? AND is_current = 1`;
    const params = [circleId];

    if (category) {
        query += ` AND category = ?`;
        params.push(category);
    }

    return db.all(query, params);
}

/**
 * Get fact history (all versions).
 */
export async function getFactHistory(circleId, factKey) {
    const db = await getDb();
    return db.all(`
        SELECT * FROM facts_v2 
        WHERE circle_id = ? AND fact_key = ? 
        ORDER BY valid_from DESC
    `, [circleId, factKey]);
}

/**
 * Invalidate a fact explicitly (e.g. it was wrong).
 */
export async function invalidateFact(factId) {
    const db = await getDb();
    await db.run(`UPDATE facts_v2 SET is_current = 0, valid_until = ? WHERE fact_id = ?`, [Date.now(), factId]);
}
