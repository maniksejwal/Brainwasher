/**
 * @fileoverview utils/actionClaimGuard.js
 * Checks agent replies for claims about actions (notifying a doctor, alerting
 * family, sending for help) and verifies each claim against what the system
 * actually did on this turn. Statements about actions in the final message
 * come from code, not from the model.
 *
 * An action record has this shape (all fields optional):
 *   {
 *     escalationCreated: boolean,   // an escalation row was written
 *     doctors: string[],            // doctors in the circle who can see it
 *     caregiversAlerted: string[],  // caregivers sent an alert this turn
 *     membersMessaged: string[],    // members sent a mediated message this turn
 *     noDoctorConnected: boolean,   // a doctor was needed but the circle has none
 *     failedRecipients: string[],   // recipients the escalation could not be sent to
 *     anonymousConsultation: boolean // an anonymous consultation request was logged
 *   }
 *
 * A sharing handler can also return a `question` for the user (asking permission to
 * escalate or to share). It is not an action; it goes at the end of the reply.
 */

import { getEmergencySentence } from '../config/emergencyGuidance.js';

export const FALLBACK_TEXT = "I'm here with you. Can you tell me more about what's happening?";

// First-person subject that states something done or about to be done: "I've", "I'll",
// "I'm going to", "let me", or a bare "I" ("while I flag this"). A bare "I" after a modal
// or "if" is an offer or condition ("Can I flag this?", "if I contact them"), not a claim.
const SUBJECT = String.raw`(?:\b(?:i(?:'m| am) going to|we(?:'re| are) going to|i(?:'ve| have| am|'m|'ll| will)|we(?:'ve| have| are|'re|'ll| will)|let me)|(?<!\b(?:can|could|shall|should|may|might|would|do|did|if|when|unless|to)\s)\bi)\s+(?:already\s+|just\s+|now\s+|also\s+|immediately\s+)?(?:make sure to\s+|be sure to\s+|go ahead and\s+|try to\s+|do my best to\s+)?`;
const ACTION_VERB = String.raw`(?:notif|alert|escalat|contact|messag|inform|reach|call|sent\b|send|told|tell|let|flag|pass|forward|share|ping|arrang)\w*`;
const DOCTOR = String.raw`\b(?:doctors?|dr\b\.?|physicians?|gp|clinician|medical team)\b`;
const FAMILY = String.raw`\b(?:family|caregivers?|care ?givers?|care team|care circle|son|daughter|wife|husband|relatives?)\b`;
// "has been notified", or "has been sent an alert"
const PASSIVE_NOTIFIED = String.raw`\b(?:has|have) been (?:notified|alerted|informed|contacted|told|messaged|sent (?:an? |the )?(?:in-app |urgent )?(?:alert|message|notification))`;

const CLAIM_RULES = [
    {
        type: 'EMERGENCY_DISPATCH',
        // The system cannot dispatch anyone, so these claims always fail.
        patterns: [
            new RegExp(`${SUBJECT}(?:called|calling|call(?:ed)?|sent for|sending for|send for|send|sending|get|getting|bring|bringing|arrang\\w*|summon\\w*|dispatch\\w*|contact\\w*|notif\\w*|alert\\w*)\\s+(?:an?\\s+|the\\s+|some\\s+)?(?:medical\\s+|emergency\\s+|urgent\\s+)?(?:ambulance|paramedics?|emergency services|first responders?|police|help|112|911|108)`, 'i'),
            // There is no call to stay on, and nobody is coming to arrive
            new RegExp(`${SUBJECT}(?:stay|be|remain)\\s+(?:right\\s+)?(?:here\\s+)?(?:on the (?:line|phone|call)|with you until)`, 'i'),
            /\buntil (?:help|assistance|the ambulance|the paramedics|they|someone|the doctor) (?:arrives?|gets? (?:there|here)|comes)\b/i,
            /\b(?:ambulance|paramedics?|emergency services|first responders?|police|help|someone|they|he|she|the doctor|your doctor|dr\b\.?\s*\w*)(?:\s+(?:is|are|has been|have been)|'re|'s)\s+(?:already\s+)?(?:on (?:the|their|his|her) way|coming|dispatched|sent(?!\s+(?:an?|the)\s+(?:in-app\s+|urgent\s+)?(?:alert|message|notification))|called|en route|arriving)\b/i,
            /\bhelp is (?:on the way|coming)\b/i
        ],
        isSupported: () => false
    },
    {
        type: 'DOCTOR_NOTIFIED',
        patterns: [
            new RegExp(`${SUBJECT}${ACTION_VERB}[^.!?]*${DOCTOR}`, 'i'),
            new RegExp(`${DOCTOR}[^.!?]*${PASSIVE_NOTIFIED}`, 'i'),
            /\b(?:the|your)\s+(?:medical|care|healthcare|doctor'?s?)\s+team\s+(?:is|are|has been|have been)\s+(?:already\s+)?(?:aware|informed|notified|alerted|working on|looking into|reviewing)/i,
            /\b(?:your|the)\s+(?:doctor|physician)\s+(?:is|has been)\s+(?:already\s+)?(?:aware|informed|notified|alerted|reviewing)/i
        ],
        isSupported: (actions) => Boolean(actions.escalationCreated && actions.doctors?.length)
    },
    {
        type: 'FAMILY_NOTIFIED',
        patterns: [
            new RegExp(`${SUBJECT}${ACTION_VERB}[^.!?]*${FAMILY}`, 'i'),
            new RegExp(`${FAMILY}[^.!?]*${PASSIVE_NOTIFIED}`, 'i')
        ],
        isSupported: (actions) => Boolean(actions.caregiversAlerted?.length || actions.membersMessaged?.length)
    },
    {
        type: 'ESCALATED',
        // Escalation without a named target
        patterns: [
            new RegExp(`${SUBJECT}(?:escalat|notif|alert)\\w*`, 'i'),
            /\b(?:this|it) (?:has been|was|is being) (?:escalated|flagged|reported)\b/i
        ],
        isSupported: (actions) => Boolean(actions.escalationCreated || actions.caregiversAlerted?.length || actions.membersMessaged?.length)
    }
];

function splitSentences(text) {
    return String(text || '').split(/(?<=[.!?])\s+/).filter(Boolean);
}

const OFFER_CLAUSE = /^\s*(?:and\s+|or\s+|but\s+)?(?:would you like|do you want|shall i|should i|can i|could i|may i|would it help)/i;

/**
 * The parts of a sentence that state something. A question is an offer, not a claim
 * ("Shall I let your doctor know?"), but a statement can come before a trailing question
 * ("...while I flag this for your doctor, can you tell me more?"). For a question, each
 * clause before the last one is checked on its own, skipping offers.
 */
function statementParts(sentence) {
    const trimmed = sentence.trim();
    if (!trimmed.endsWith('?')) return [trimmed];
    return trimmed.split(/,|;|\s[-–—]\s/).slice(0, -1).filter(c => c.trim() && !OFFER_CLAUSE.test(c));
}

/**
 * Find action claims in model-written text that the action record does not support.
 * @param {string} text - Model-written reply (without the code-inserted emergency sentence)
 * @param {object} actions - Action record for this turn
 * @returns {Array<{type: string, sentence: string}>} Failed claims
 */
export function findFalseClaims(text, actions = {}) {
    const failures = [];
    for (const sentence of splitSentences(text)) {
        const parts = statementParts(sentence);
        // Rules are ordered most specific first; one sentence yields at most one claim
        const rule = CLAIM_RULES.find(r => r.patterns.some(p => parts.some(part => p.test(part))));
        if (rule && !rule.isSupported(actions)) {
            failures.push({ type: rule.type, sentence });
        }
    }
    return failures;
}

// A clause that only continues the one before it ("..., who will see it soon")
const DEPENDENT_CLAUSE = /^(?:who|which|where|so (?:that )?(?:they|he|she)|and (?:they|he|she) (?:will|can|should|may))\b/i;
const LEADING_CONJUNCTION = /^(?:and|but|so|also)\s+/i;

/**
 * Remove the model's own statements of actions that did happen. The code adds the
 * action status sentence, so these would repeat it, often less precisely. Only clauses
 * whose claim is supported by the action record are removed; failed claims are left for
 * findFalseClaims. Offers and questions are kept.
 * @param {string} text - Model-written reply
 * @param {object} actions - Action record for this turn
 * @returns {string} The text without those clauses (may be empty)
 */
export function removeSupportedClaims(text, actions = {}) {
    // Claims that name someone the action reached ("I've let gina know")
    const reached = [...(actions.doctors || []), ...(actions.caregiversAlerted || []), ...(actions.membersMessaged || [])];
    const namedClaim = reached.length > 0
        ? new RegExp(`${SUBJECT}${ACTION_VERB}[^.!?]*\\b(?:${reached.map(escapeRegExp).join('|')})\\b`, 'i')
        : null;
    const isSupportedClaim = (clause) => {
        if (OFFER_CLAUSE.test(clause)) return false;
        if (namedClaim?.test(clause)) return true;
        const rule = CLAIM_RULES.find(r => r.patterns.some(p => p.test(clause)));
        return Boolean(rule && rule.isSupported(actions));
    };
    return removeClauses(text, isSupportedClaim);
}

// The model telling the user to call emergency services or go to hospital, in its own
// words. On HIGH turns the code-inserted emergency sentence already says this.
const EMERGENCY_INSTRUCTION = [
    /\b(?:call|dial|ring|phone|contact)\s+(?:your\s+|the\s+)?(?:local\s+|nearest\s+)?(?:emergency(?:\s+(?:services|number|line|helpline))?|(?:an\s+)?ambulance|112|911|108|999|14416|tele-?manas|(?:a\s+|the\s+)?(?:crisis|suicide|mental health)\s+(?:line|helpline|hotline))\b/i,
    /\b(?:go|get|head|rush|make your way)\s+(?:straight\s+|immediately\s+|right away\s+)?to\s+(?:the\s+|a\s+|your\s+)?(?:nearest\s+|closest\s+)?(?:emergency\s+(?:room|department)|er|a&e|casualty|hospital)\b/i,
    /\bseek\s+(?:immediate\s+|emergency\s+|urgent\s+)+(?:medical\s+)?(?:attention|help|care)\b/i
];
// A condition left on its own once its instruction is removed ("If it gets worse, ...")
const CONDITION_CLAUSE = /^(?:if|when|should|in case)\b/i;

/**
 * Remove the model's own emergency instructions ("please call your local emergency
 * number right away"). Used only when the approved emergency sentence opens the reply,
 * so the instruction is given once, in the reviewed wording. Questions about getting
 * help ("Is someone there who can take you to hospital?") are kept. A first-person
 * claim ("I've called 112") never gets here: findFalseClaims replaces that reply first.
 * @param {string} text - Model-written reply
 * @returns {string} The text without those clauses (may be empty)
 */
export function removeEmergencyInstructions(text) {
    return removeClauses(text, (clause) => EMERGENCY_INSTRUCTION.some(p => p.test(clause)), { dropCondition: true });
}

/**
 * Remove the clauses of each sentence that `shouldDrop` matches, keeping the rest of
 * the sentence readable. The last clause of a question (what is being asked) is never
 * removed, and a dependent clause after a removed one goes with it.
 * @param {string} text
 * @param {(clause: string) => boolean} shouldDrop
 * @param {object} [options]
 * @param {boolean} [options.dropCondition] - Also remove a condition clause right before a removed one
 */
function removeClauses(text, shouldDrop, { dropCondition = false } = {}) {
    const kept = [];
    for (const sentence of splitSentences(text)) {
        const trimmed = sentence.trim();
        const isQuestion = trimmed.endsWith('?');
        // [clause, separator, clause, separator, ...]
        const pieces = trimmed.split(/(\s*[,;]\s*|\s[-–—]\s)/);
        const clauses = pieces.filter((_, i) => i % 2 === 0);
        const drop = new Set();
        clauses.forEach((clause, i) => {
            // The last clause of a question is what is being asked, never a claim
            if (isQuestion && i === clauses.length - 1) return;
            if (!shouldDrop(clause)) return;
            drop.add(i);
            if (dropCondition && i > 0 && CONDITION_CLAUSE.test(clauses[i - 1].trim())) drop.add(i - 1);
            for (let j = i + 1; j < clauses.length && DEPENDENT_CLAUSE.test(clauses[j].trim()); j++) drop.add(j);
        });
        if (drop.size === 0) {
            kept.push(trimmed);
            continue;
        }

        let rebuilt = '';
        clauses.forEach((clause, i) => {
            if (drop.has(i)) return;
            rebuilt += rebuilt ? (pieces[i * 2 - 1] ?? ', ') + clause : clause;
        });
        rebuilt = rebuilt.trim().replace(LEADING_CONJUNCTION, '');
        if (!rebuilt || /^[.!?]+$/.test(rebuilt)) continue;
        // Keep the sentence's own ending; a removed last clause can take it with it
        if (!/[.!?]$/.test(rebuilt)) rebuilt += trimmed.slice(-1).match(/[.!?]/) ? trimmed.slice(-1) : '.';
        kept.push(rebuilt.charAt(0).toUpperCase() + rebuilt.slice(1));
    }
    return kept.join(' ');
}

/**
 * Build the sentence that tells the user what the system actually did.
 * @param {object} actions - Action record for this turn
 * @returns {string} Status sentence, or '' when nothing was done
 */
export function buildActionStatus(actions = {}) {
    const parts = [];
    if (actions.anonymousConsultation) {
        parts.push("I've logged a request for an anonymous consultation about your concern, without your identity. No doctor has reviewed it yet.");
    } else if (actions.escalationCreated && actions.doctors?.length) {
        parts.push(`I've flagged this for ${joinNames(actions.doctors)}, who will see it in the app.`);
    } else if (actions.noDoctorConnected) {
        parts.push("No doctor is connected to your care circle yet, so I couldn't send this to a doctor.");
    }
    // One sentence per person: someone both alerted and messaged is named once
    const alerted = actions.caregiversAlerted || [];
    const messaged = actions.membersMessaged || [];
    const both = alerted.filter(name => messaged.includes(name));
    const alertedOnly = alerted.filter(name => !both.includes(name));
    const messagedOnly = messaged.filter(name => !both.includes(name));
    if (both.length) {
        parts.push(`I've sent an alert to ${joinNames(both)} and passed your message on to them in the app.`);
    }
    if (alertedOnly.length) {
        parts.push(`I've sent an alert to ${joinNames(alertedOnly)} in the app.`);
    }
    if (messagedOnly.length) {
        parts.push(`I've passed your message on to ${joinNames(messagedOnly)} in the app.`);
    }
    if (actions.failedRecipients?.length) {
        parts.push(`I couldn't send this to ${joinNames(actions.failedRecipients)}.`);
    }
    return parts.join(' ');
}

/**
 * Compose the one message sent to the user who wrote in:
 * emergency sentence (HIGH only), checked model text, action status, then any question
 * from a sharing handler.
 * @param {object} params
 * @param {string} params.modelText - Reply written by the model
 * @param {string} params.criticality - Final criticality for the turn
 * @param {string} [params.highCategory] - HIGH category from the clinical agent
 * @param {object} [params.actions] - Action record for this turn
 * @param {string} [params.question] - Question from a sharing handler (may be model-written)
 * @returns {{message: string, violations: Array<{type: string, sentence: string}>}}
 */
export function composeFinalReply({ modelText, criticality, highCategory = null, actions = {}, question = null }) {
    const violations = findFalseClaims(modelText, actions);
    const status = buildActionStatus(actions);
    let body = violations.length > 0 || !modelText ? FALLBACK_TEXT : modelText.trim();
    if (status && body !== FALLBACK_TEXT) {
        // The status sentence states what was done; the model's own version is removed
        body = removeSupportedClaims(body, actions);
    }
    const parts = [];
    if (criticality === 'HIGH') {
        parts.push(getEmergencySentence(highCategory));
        // The approved sentence gives the instruction; the model's own version is removed
        if (body !== FALLBACK_TEXT) body = removeEmergencyInstructions(body);
    }
    if (body) parts.push(body);
    if (status) parts.push(status);
    if (question) {
        // A question that claims an action is dropped, not sent
        const questionViolations = findFalseClaims(question, actions);
        if (questionViolations.length > 0) {
            violations.push(...questionViolations);
        } else {
            parts.push(question.trim());
        }
    }
    return { message: parts.join(' '), violations };
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
