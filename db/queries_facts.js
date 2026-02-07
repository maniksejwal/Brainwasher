import { getDb } from './connection.js';

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
