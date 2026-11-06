import { getDb } from './connection.js';

const RECENCY_HALF_LIFE_DAYS = 180;
const SAFETY_CRITICAL_CATEGORIES = new Set(['medication', 'allergy', 'diagnosis', 'emergency_contact', 'dnr', 'consent']);
const UNUSABLE_VALUE = /^(\[object Object\]|null|undefined|none|n\/a|unknown|)$/i;

/**
 * What a patient has told us about themselves, as a block for a prompt. Other members'
 * statements are left out, because they may have been made in private.
 * @param {object} params
 * @param {string} params.circleId - Care circle ID
 * @param {string} params.subjectId - The patient
 * @param {number} [params.sessionStartMs] - Facts observed since then are listed as this session's
 * @param {number} [params.topK] - Most older, non-safety facts to include
 * @param {number} [params.minConfidence] - Lowest confidence to include
 * @returns {Promise<{block: string, facts: object[]}>} The prompt block and the rows behind it
 */
export async function retrieveRelevantFacts({
    circleId,
    subjectId,
    sessionStartMs = Date.now() - 3_600_000,
    topK = 6,
    minConfidence = 0.3
}) {
    const db = await getDb();
    const now = Date.now();
    const rows = await db.all(
        `SELECT * FROM facts_v2
         WHERE is_current = 1
           AND circle_id = ?
           AND subject_id = ?
           AND reported_by = ?
           AND confidence >= ?
           AND (valid_until IS NULL OR valid_until > ?)
           AND (sensitivity IS NULL OR sensitivity IN ('public', 'circle', 'normal'))
           AND fact_key NOT LIKE 'other\\_person%' ESCAPE '\\'`,
        [circleId, subjectId, subjectId, minConfidence, now]
    );

    const usable = rows.filter(fact => !UNUSABLE_VALUE.test(String(fact.value ?? '').trim()));
    const isSafety = (fact) => SAFETY_CRITICAL_CATEGORIES.has(String(fact.category).toLowerCase());
    const isSession = (fact) => fact.observed_at >= sessionStartMs;
    const score = (fact) => {
        const ageDays = (now - (fact.valid_from || fact.created_at)) / 86_400_000;
        return fact.confidence * Math.exp(-Math.LN2 * ageDays / RECENCY_HALF_LIFE_DAYS);
    };

    const sessionFacts = usable.filter(isSession);
    const earlier = usable.filter(fact => !isSession(fact));
    const persistent = [
        ...earlier.filter(isSafety),
        ...earlier.filter(fact => !isSafety(fact)).sort((a, b) => score(b) - score(a)).slice(0, topK)
    ];

    const format = (fact) => {
        const name = fact.fact_key.replace(`_${subjectId}`, '').replace(/_/g, ' ');
        const date = new Date(fact.observed_at || fact.valid_from || fact.created_at).toISOString().slice(0, 10);
        return `- ${name}: ${fact.value} [${date}]`;
    };
    const section = (title, facts) => (facts.length ? [title, ...facts.map(format)] : []);

    return {
        block: [...section('CURRENT SESSION:', sessionFacts), ...section('KNOWN CONTEXT:', persistent)].join('\n'),
        facts: [...sessionFacts, ...persistent]
    };
}

/**
 * Add a new structured fact (versioned).
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
