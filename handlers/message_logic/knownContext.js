/**
 * @fileoverview handlers/message_logic/knownContext.js
 * What is already known about a patient, for their own replies. Only the patient's turns get
 * this for now, so a caregiver's reply cannot reveal a patient's private facts.
 */
import { getDb } from '../../db/connection.js';
import { retrieveRelevantFacts } from '../../db/queries_facts.js';
import { getLongitudinalHint } from '../../companions/physio/tensornetsBridge.js';

// A gap longer than this between a patient's messages starts a new conversation
export const SESSION_GAP_MS = 6 * 3_600_000;
const NO_CONTEXT = { knownContextBlock: '', longitudinalHint: '', patientSession: null };

/**
 * Which conversation this is for the patient, from their message times.
 * @param {number[]} timestamps - The patient's message times, any order
 * @param {number} nowMs - Current time
 * @returns {{number: number, startMs: number, previousEndMs: number|null}}
 */
export function sessionFromTimestamps(timestamps, nowMs = Date.now()) {
    const times = [...timestamps, nowMs].sort((a, b) => a - b);
    let number = 1;
    let startMs = times[0];
    let previousEndMs = null;
    for (let i = 1; i < times.length; i++) {
        if (times[i] - times[i - 1] > SESSION_GAP_MS) {
            number++;
            previousEndMs = times[i - 1];
            startMs = times[i];
        }
    }
    return { number, startMs, previousEndMs };
}

async function loadPatientSession(circleId, userId) {
    const db = await getDb();
    const rows = await db.all(
        'SELECT timestamp FROM messages WHERE circle_id = ? AND user_id = ?',
        [circleId, userId]
    );
    return sessionFromTimestamps(rows.map(r => r.timestamp));
}

/**
 * Loads the known facts and longitudinal hint for a turn. Never fails the turn.
 * @param {string} role - Speaker's role
 * @param {string} circleId - Care circle ID
 * @param {string} userId - The speaker
 * @returns {Promise<{knownContextBlock: string, longitudinalHint: string, patientSession: object|null}>} Empty when there is nothing to add
 */
export async function loadKnownContext(role, circleId, userId) {
    if (role !== 'patient') return { ...NO_CONTEXT };

    const patientSession = await loadPatientSession(circleId, userId).catch((error) => {
        console.warn('[KnownContext] Could not load session:', error.message);
        return null;
    });
    const [facts, longitudinalHint] = await Promise.all([
        retrieveRelevantFacts({
            circleId,
            subjectId: userId,
            ...(patientSession ? { sessionStartMs: patientSession.startMs } : {})
        }).catch((error) => {
            console.warn('[KnownContext] Could not load facts:', error.message);
            return { block: '' };
        }),
        getLongitudinalHint(userId)
    ]);
    return { knownContextBlock: facts.block, longitudinalHint, patientSession };
}
