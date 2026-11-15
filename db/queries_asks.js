/**
 * @fileoverview db/queries_asks.js
 * Questions and requests a patient has made that have not been answered yet.
 */
import { getDb } from './connection.js';

// An ask not raised again for this long is no longer shown as open
export const OPEN_ASK_MAX_AGE_MS = 7 * 86_400_000;
const MAX_OPEN = 5;
const KINDS = new Set(['question', 'request']);
const CLOSED_AS = new Set(['answered', 'dropped']);

/**
 * @param {string} circleId
 * @param {string} userId - The patient
 * @param {number} [nowMs]
 * @returns {Promise<object[]>} Open asks, most recently asked first
 */
export async function getOpenAsks(circleId, userId, nowMs = Date.now()) {
    const db = await getDb();
    return db.all(
        `SELECT ask_id, text, kind, times_asked, first_asked_at, last_asked_at FROM open_asks
         WHERE circle_id = ? AND user_id = ? AND status = 'open' AND last_asked_at > ?
         ORDER BY last_asked_at DESC LIMIT ?`,
        [circleId, userId, nowMs - OPEN_ASK_MAX_AGE_MS, MAX_OPEN]
    );
}

/**
 * Applies one turn's labels from input understanding: closes resolved asks, counts repeats,
 * and adds new questions and requests. Rhetorical ones are not stored. IDs that are not
 * this patient's open asks are ignored, so a wrong ID from the model cannot touch other rows.
 * @param {string} circleId
 * @param {string} userId - The patient
 * @param {object} labels
 * @param {object[]} [labels.asks] - [{ text, kind, same_as }]
 * @param {object[]} [labels.resolved] - [{ id, how }]
 * @param {number} [nowMs]
 * @returns {Promise<object[]>} Open asks after the update
 */
export async function updateOpenAsks(circleId, userId, { asks = [], resolved = [] } = {}, nowMs = Date.now()) {
    const db = await getDb();
    const openAsks = await getOpenAsks(circleId, userId, nowMs);
    const openIds = new Set(openAsks.map(a => a.ask_id));
    // The model sometimes gives the open ask's text instead of its number
    const byText = new Map(openAsks.map(a => [a.text.trim().toLowerCase(), a.ask_id]));
    const toId = (value) => (typeof value === 'string' && byText.get(value.trim().toLowerCase())) || Number(value);

    for (const item of Array.isArray(resolved) ? resolved : []) {
        const id = toId(item?.id);
        if (!openIds.has(id) || !CLOSED_AS.has(item?.how)) continue;
        await db.run(`UPDATE open_asks SET status = ?, closed_at = ? WHERE ask_id = ?`, [item.how, nowMs, id]);
        openIds.delete(id);
    }

    for (const ask of Array.isArray(asks) ? asks : []) {
        const text = String(ask?.text ?? '').trim().slice(0, 300);
        if (!text || !KINDS.has(ask?.kind)) continue;
        const sameAs = toId(ask.same_as);
        if (openIds.has(sameAs)) {
            await db.run(
                `UPDATE open_asks SET times_asked = times_asked + 1, last_asked_at = ? WHERE ask_id = ?`,
                [nowMs, sameAs]
            );
        } else {
            await db.run(
                `INSERT INTO open_asks (circle_id, user_id, text, kind, first_asked_at, last_asked_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [circleId, userId, text, ask.kind, nowMs, nowMs]
            );
        }
    }
    return getOpenAsks(circleId, userId, nowMs);
}

/**
 * Marks asks answered by a reply. Only the patient's own open asks are changed.
 * @param {string} circleId
 * @param {string} userId - The patient
 * @param {number[]} askIds
 * @param {number} [nowMs]
 * @returns {Promise<number>} How many were closed
 */
export async function markAsksAnswered(circleId, userId, askIds, nowMs = Date.now()) {
    if (!askIds?.length) return 0;
    const db = await getDb();
    let closed = 0;
    for (const id of askIds) {
        const result = await db.run(
            `UPDATE open_asks SET status = 'answered', closed_at = ?
             WHERE ask_id = ? AND circle_id = ? AND user_id = ? AND status = 'open'`,
            [nowMs, id, circleId, userId]
        );
        closed += result.changes || 0;
    }
    return closed;
}

/**
 * Open asks as prompt lines, or '' when there are none.
 * @param {object[]} asks - From getOpenAsks
 * @param {{withIds?: boolean}} [options] - IDs are shown only to input understanding
 * @returns {string}
 */
export function formatOpenAsks(asks, { withIds = false } = {}) {
    return (asks || []).map(a => {
        const times = a.times_asked > 1 ? ` (asked ${a.times_asked} times)` : '';
        return `- ${withIds ? `[${a.ask_id}] ` : ''}${a.kind}: ${a.text}${times}`;
    }).join('\n');
}
