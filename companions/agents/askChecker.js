/**
 * @fileoverview companions/agents/askChecker.js
 * Whether a reply addresses the patient's open questions and requests.
 */
import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { PROMPT_ASK_CHECK } from '../../prompts/ask_check.js';

/**
 * @param {string} reply - The reply to check
 * @param {object[]} openAsks - From getOpenAsks
 * @param {string} message - The patient's message
 * @returns {Promise<{addressed: number[], missed: object[]}|null>} null when the check could not run
 */
export async function checkReplyAddressesAsks(reply, openAsks, message) {
    if (!reply || !openAsks?.length) return null;
    const ids = new Set(openAsks.map(a => a.ask_id));
    const prompt = PROMPT_ASK_CHECK
        .replace('{{ASKS}}', openAsks.map(a => `${a.ask_id}. ${a.kind}: ${a.text}`).join('\n'))
        .replace('{{MESSAGE}}', String(message ?? '').slice(0, 600))
        .replace('{{REPLY}}', String(reply).slice(0, 1200));
    try {
        const parsed = parseCompanionResponse(await makeApiCall(prompt, [], true), 'AskChecker');
        if (!parsed || !Array.isArray(parsed.addressed)) return null;
        const addressed = [...new Set(parsed.addressed.map(Number).filter(id => ids.has(id)))];
        // An ask the checker left out of both lists counts as missed
        const missed = openAsks.filter(a => !addressed.includes(a.ask_id));
        return { addressed, missed };
    } catch (error) {
        console.warn('[AskChecker] Skipped:', error.message);
        return null;
    }
}
