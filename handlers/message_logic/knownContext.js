/**
 * @fileoverview handlers/message_logic/knownContext.js
 * What is already known about a patient, for their own replies. Only the patient's turns get
 * this for now, so a caregiver's reply cannot reveal a patient's private facts.
 */
import { retrieveRelevantFacts } from '../../db/queries_facts.js';
import { getLongitudinalHint } from '../../companions/physio/tensornetsBridge.js';

/**
 * Loads the known facts and longitudinal hint for a turn. Never fails the turn.
 * @param {string} role - Speaker's role
 * @param {string} circleId - Care circle ID
 * @param {string} userId - The speaker
 * @returns {Promise<{knownContextBlock: string, longitudinalHint: string}>} Empty strings when there is nothing to add
 */
export async function loadKnownContext(role, circleId, userId) {
    if (role !== 'patient') return { knownContextBlock: '', longitudinalHint: '' };

    const [facts, longitudinalHint] = await Promise.all([
        retrieveRelevantFacts({ circleId, subjectId: userId }).catch((error) => {
            console.warn('[KnownContext] Could not load facts:', error.message);
            return { block: '' };
        }),
        getLongitudinalHint(userId)
    ]);
    return { knownContextBlock: facts.block, longitudinalHint };
}
