/**
 * @fileoverview companions/patientFacts.js
 * Short facts about where a patient is in their care, for the reply prompt. Fields with no
 * real value are left out, so the model is not invited to guess them or ask for them.
 */

import { formatOpenAsks } from '../db/queries_asks.js';
import { withheldGuidance } from '../services/sharingPolicy.js';

const DAY_MS = 86_400_000;

/**
 * @param {object} context - Conversation context
 * @param {{number: number, previousEndMs: number|null}} [context.patientSession] - From loadKnownContext
 * @param {object[]} [context.recentEscalations] - Unread escalations for the circle
 * @param {number} [nowMs] - Current time
 * @returns {string} Lines of text, or '' when nothing is known
 */
export function buildPatientFacts(context = {}, nowMs = Date.now()) {
    const lines = [];

    const session = context.patientSession;
    if (session?.number > 1 && session.previousEndMs) {
        const days = Math.floor((nowMs - session.previousEndMs) / DAY_MS);
        const since = days === 0 ? 'earlier today' : days === 1 ? '1 day ago' : `${days} days ago`;
        lines.push(`- Conversation ${session.number} with this patient; the last one was ${since}.`);
    } else if (session?.number === 1) {
        lines.push('- First conversation with this patient.');
    }

    // Only the alert types: their details can quote other members' private messages
    const types = [...new Set((context.recentEscalations || []).map(e => e?.type).filter(Boolean))];
    if (types.length) {
        lines.push(`- Topics flagged earlier in the care circle: ${types.join(', ')}.`);
    }

    return lines.join('\n');
}

/**
 * The "already known" section of the reply prompt, or '' when there is nothing to add.
 * @param {object} context - Conversation context, with knownContextBlock and longitudinalHint
 * @returns {string}
 */
export function buildKnownSection(context = {}) {
    const parts = [buildPatientFacts(context), context.knownContextBlock, context.longitudinalHint]
        .map(part => (part || '').trim())
        .filter(Boolean);
    const waiting = formatOpenAsks(context.openAsks);
    const sections = [];
    if (parts.length) {
        sections.push(
            '**What we already know (do not ask again):**',
            'Background only. Use it so you do not ask for something the patient has already told you. It does not mean any action was taken.',
            ...parts
        );
    }
    if (waiting) {
        if (sections.length) sections.push('');
        sections.push(
            '**Still waiting for an answer:**',
            waiting,
            'Address these in this reply: answer them, or say honestly what you cannot do and what the patient can do instead. Do not claim you did something unless ACTIONS_TAKEN lists it.'
        );
    }
    if (context.sharingRestrictionText === null) {
        if (sections.length) sections.push('');
        sections.push('**Sharing limits:** unknown right now. Do not offer to tell, alert or share with anyone.');
    } else if (context.sharingRestrictionText) {
        if (sections.length) sections.push('');
        sections.push(
            `**Sharing limits:** the patient asked you not to share with ${context.sharingRestrictionText}.`,
            'Do not offer to tell, alert or share with them, and do not suggest it. If it comes up, say you will respect this.'
        );
    }
    const withheld = context.withheldFrom === undefined ? '' : withheldGuidance(context.withheldFrom);
    if (withheld) {
        if (sections.length) sections.push('');
        sections.push(`**Updates not available:** ${withheld}`);
    }
    const missed = formatOpenAsks(context.missedAsks);
    if (missed) {
        sections.push(
            '',
            '**Your previous draft did not address:**',
            missed,
            'Rewrite the reply so it answers each of these directly first, or says honestly what you cannot do and what the patient can do instead. A feeling-only line or another question is not an answer. You may still end with one new probing question.'
        );
    }
    return sections.join('\n');
}
