/**
 * @fileoverview lib/turnContext.js
 * The integration turn being processed, if any. A HealthyMitra conversation job runs the
 * message pipeline inside runInTurn, and code anywhere below it can read the turn without
 * it being passed through every call. Outside a job (CLI, GUI, simulations) there is none.
 *
 * Inside a turn:
 * - message history the agents read is limited to the speaker's own messages and other
 *   members' PUBLIC messages (db/queries_messages.js getRecentMessages);
 * - saved messages are linked to the conversation;
 * - replies broadcast to the speaker are linked to the job (services/conversationJobs.js).
 */
import { AsyncLocalStorage } from 'async_hooks';

const storage = new AsyncLocalStorage();

/**
 * Run fn as one integration turn.
 * @param {{userId: string, conversationId: string, jobId: string}} turn
 * @param {Function} fn
 */
export function runInTurn(turn, fn) {
    return storage.run(Object.freeze({ startedAt: Date.now(), ...turn }), fn);
}

/**
 * @returns {{userId: string, conversationId: string, jobId: string, startedAt: number}|undefined}
 */
export function currentTurn() {
    return storage.getStore();
}
