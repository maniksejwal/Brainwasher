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
 *     noDoctorConnected: boolean    // a doctor was needed but the circle has none
 *   }
 */

import { getEmergencySentence } from '../config/emergencyGuidance.js';

export const FALLBACK_TEXT = "I'm here with you. Can you tell me more about what's happening?";

// First-person subject that states something done or about to be done.
// Offers and questions ("I can...", "Would you like me to...") are not claims.
const SUBJECT = String.raw`\b(?:i(?:'ve| have| am|'m|'ll| will)|we(?:'ve| have| are|'re|'ll| will))\s+(?:already\s+|just\s+|now\s+|also\s+)?`;
const ACTION_VERB = String.raw`(?:notif|alert|escalat|contact|messag|inform|reach|call|sent\b|send|told|tell|let|flag|pass|forward|share|ping|arrang)\w*`;
const DOCTOR = String.raw`\b(?:doctors?|dr\b\.?|physicians?|gp|clinician|medical team)\b`;
const FAMILY = String.raw`\b(?:family|caregivers?|care ?givers?|care team|care circle|son|daughter|wife|husband|relatives?)\b`;

const CLAIM_RULES = [
    {
        type: 'EMERGENCY_DISPATCH',
        // The system cannot dispatch anyone, so these claims always fail.
        patterns: [
            new RegExp(`${SUBJECT}(?:called|calling|call(?:ed)?|sent for|sending for|send for|summon\\w*|dispatch\\w*|contact\\w*|notif\\w*|alert\\w*)\\s+(?:an?\\s+|the\\s+|some\\s+)?(?:medical\\s+|emergency\\s+|urgent\\s+)?(?:ambulance|paramedics?|emergency services|first responders?|police|help|112|911|108)`, 'i'),
            /\b(?:ambulance|paramedics?|emergency services|first responders?|police|help|someone|they|he|she|the doctor|your doctor|dr\b\.?\s*\w*)(?:\s+(?:is|are|has been|have been)|'re|'s)\s+(?:already\s+)?(?:on (?:the|their|his|her) way|coming|dispatched|sent|called|en route|arriving)\b/i,
            /\bhelp is (?:on the way|coming)\b/i
        ],
        isSupported: () => false
    },
    {
        type: 'DOCTOR_NOTIFIED',
        patterns: [
            new RegExp(`${SUBJECT}${ACTION_VERB}[^.!?]*${DOCTOR}`, 'i'),
            new RegExp(`${DOCTOR}[^.!?]*\\b(?:has|have) been (?:notified|alerted|informed|contacted|told|messaged)`, 'i')
        ],
        isSupported: (actions) => Boolean(actions.escalationCreated && actions.doctors?.length)
    },
    {
        type: 'FAMILY_NOTIFIED',
        patterns: [
            new RegExp(`${SUBJECT}${ACTION_VERB}[^.!?]*${FAMILY}`, 'i'),
            new RegExp(`${FAMILY}[^.!?]*\\b(?:has|have) been (?:notified|alerted|informed|contacted|told|messaged)`, 'i')
        ],
        isSupported: (actions) => Boolean(actions.caregiversAlerted?.length)
    },
    {
        type: 'ESCALATED',
        // Escalation without a named target
        patterns: [
            new RegExp(`${SUBJECT}(?:escalat|notif|alert)\\w*`, 'i'),
            /\b(?:this|it) (?:has been|was|is being) (?:escalated|flagged|reported)\b/i
        ],
        isSupported: (actions) => Boolean(actions.escalationCreated || actions.caregiversAlerted?.length)
    }
];

function splitSentences(text) {
    return String(text || '').split(/(?<=[.!?])\s+/).filter(Boolean);
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
        // Questions are offers, not claims ("Shall I let your doctor know?")
        if (sentence.trim().endsWith('?')) continue;
        // Rules are ordered most specific first; one sentence yields at most one claim
        const rule = CLAIM_RULES.find(r => r.patterns.some(p => p.test(sentence)));
        if (rule && !rule.isSupported(actions)) {
            failures.push({ type: rule.type, sentence });
        }
    }
    return failures;
}

/**
 * Build the sentence that tells the user what the system actually did.
 * @param {object} actions - Action record for this turn
 * @returns {string} Status sentence, or '' when nothing was done
 */
export function buildActionStatus(actions = {}) {
    const parts = [];
    if (actions.escalationCreated && actions.doctors?.length) {
        parts.push(`I've flagged this for ${joinNames(actions.doctors)}, who will see it in the app.`);
    } else if (actions.noDoctorConnected) {
        parts.push("No doctor is connected to your care circle yet, so I couldn't send this to a doctor.");
    }
    if (actions.caregiversAlerted?.length) {
        parts.push(`I've sent an alert to ${joinNames(actions.caregiversAlerted)} in the app.`);
    }
    return parts.join(' ');
}

/**
 * Compose the one message sent to the user who wrote in:
 * emergency sentence (HIGH only), checked model text, action status.
 * @param {object} params
 * @param {string} params.modelText - Reply written by the model
 * @param {string} params.criticality - Final criticality for the turn
 * @param {string} [params.highCategory] - HIGH category from the clinical agent
 * @param {object} [params.actions] - Action record for this turn
 * @returns {{message: string, violations: Array<{type: string, sentence: string}>}}
 */
export function composeFinalReply({ modelText, criticality, highCategory = null, actions = {} }) {
    const violations = findFalseClaims(modelText, actions);
    const body = violations.length > 0 || !modelText ? FALLBACK_TEXT : modelText.trim();
    const parts = [];
    if (criticality === 'HIGH') {
        parts.push(getEmergencySentence(highCategory));
    }
    parts.push(body);
    const status = buildActionStatus(actions);
    if (status) parts.push(status);
    return { message: parts.join(' '), violations };
}

function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
