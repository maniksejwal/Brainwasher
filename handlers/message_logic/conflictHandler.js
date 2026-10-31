/**
 * @fileoverview Handles the logic for processing facts from an AI analysis,
 * detecting conflicts between user reports, and initiating mediated clarification.
 */

import chalk from 'chalk';
import { getMemberInfo, findUserById } from '../../db/index.js';
import { recordInboxEscalation } from '../../services/escalationService.js';
import { addFact, getCurrentFact } from '../../db/queries_facts.js';
import { generateMediatedClarification } from '../../agents/index.js'; // Ensure this is exported/updated
import { events } from '../../orchestrator.js'; // Or wherever addEscalation/events come from
import { getAgentName } from '../utils/agentIdentity.js';

// Values that say nothing, so they cannot contradict anything
const EMPTY_VALUES = new Set(['', 'null', 'undefined', 'none', 'n/a', 'na', 'unknown', 'not mentioned', 'not specified']);
// Facts that describe how someone is (symptoms, mood, concerns). Several can be true at
// once ("anxious" and "frustrated"), so a different description is not a contradiction.
const DESCRIPTIVE_KEY = /symptom|mood|feeling|emotion|concern|condition|behaviou?r|observation|note|report/i;
// Keys about "another person" whose subject the extractor did not name
const UNRESOLVED_SUBJECT_KEY = /^other_person_/;

function normalizeValue(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Whether a newly reported fact contradicts the current one. Fact keys are relative to
 * the speaker ("symptom_report" is the speaker's own symptom), so two members using the
 * same key are usually talking about different people. A conflict needs:
 *  - a different reporter;
 *  - the same, known subject (a key like other_person_* with no named subject is unknown);
 *  - a single-valued fact, not a description such as a symptom or mood;
 *  - two real values that differ after normalizing case and punctuation.
 * @param {object|undefined} currentFact - Current row from facts_v2
 * @param {object} reported - { key, value, reporterId, subjectId, subjectNamed }
 * @returns {boolean}
 */
export function isFactConflict(currentFact, { key, value, reporterId, subjectId, subjectNamed }) {
    if (!currentFact || currentFact.reported_by === reporterId) return false;
    if (DESCRIPTIVE_KEY.test(key)) return false;
    if (UNRESOLVED_SUBJECT_KEY.test(key) && !subjectNamed) return false;
    if (!subjectId || !currentFact.subject_id || currentFact.subject_id !== subjectId) return false;
    const before = normalizeValue(currentFact.value);
    const now = normalizeValue(value);
    if (EMPTY_VALUES.has(before) || EMPTY_VALUES.has(now)) return false;
    return before !== now;
}

export async function handleFactProcessing(userId, circleId, analysis) {
    if (!analysis.facts || Object.keys(analysis.facts).length === 0) {
        return; // No facts to process
    }

    // Process each fact from the analysis
    for (const [key, rawValue] of Object.entries(analysis.facts)) {
        // Prepare metadata
        let factValue = rawValue;
        let metadata = {
            reportedBy: userId,
            sourceType: 'user',
            confidence: 1.0,
            category: 'general',
            subjectId: userId, // Default to self
            targetObject: null,
            sensitivity: 'normal'
        };

        // If rawValue is an object with 'value', use it as rich fact
        if (typeof rawValue === 'object' && rawValue !== null) {
            // Handle new structured format
            if (rawValue.value !== undefined) {
                factValue = rawValue.value;
                metadata = { ...metadata, ...rawValue };

                // Handle 'self' subject reference
                if (metadata.subject_id === 'self') {
                    metadata.subjectId = userId;
                } else if (metadata.subject_id) {
                    metadata.subjectId = metadata.subject_id; // Map snake_case to camelCase
                }

                if (metadata.target_object) metadata.targetObject = metadata.target_object;
                // sensitivity is already correct key

                // Handle timestamps (parse ISO strings or 'now')
                const parseTime = (val) => {
                    if (!val) return null;
                    if (val === 'now') return Date.now();
                    const ts = Date.parse(val);
                    return isNaN(ts) ? null : ts;
                };

                if (metadata.observed_at) metadata.observedAt = parseTime(metadata.observed_at);
                if (metadata.valid_from) metadata.validFrom = parseTime(metadata.valid_from);
                if (metadata.valid_until) metadata.validUntil = parseTime(metadata.valid_until);

                delete metadata.value;
                delete metadata.subject_id;
                delete metadata.target_object;
                delete metadata.observed_at;
                delete metadata.valid_from;
                delete metadata.valid_until;
            }
        }

        // Check for conflicts with CURRENT fact
        const currentFact = await getCurrentFact(circleId, key);

        // Add the new fact (this will archive the old one)
        await addFact(circleId, key, factValue, metadata);

        const subjectNamed = typeof rawValue === 'object' && rawValue !== null && Boolean(rawValue.subject_id) && rawValue.subject_id !== 'self';
        if (isFactConflict(currentFact, { key, value: factValue, reporterId: userId, subjectId: metadata.subjectId, subjectNamed })) {
            console.log(chalk.yellow.bold(`[ConflictHandler] CONFLICT DETECTED in circle ${circleId} on '${key}'`));

            const conflictDetails = `Conflict on '${key}': User ${userId} says '${factValue}', but ${currentFact.reported_by} said '${currentFact.value}'.`;
            await recordInboxEscalation({ circleId, type: 'CONFLICT', details: conflictDetails, messageId: analysis.message_id ?? null });

            // Initiate mediated clarification with the previous reporter
            try {
                const otherMember = await getMemberInfo(currentFact.reported_by, circleId);
                if (otherMember) {
                    const otherUser = await findUserById(otherMember.user_id);
                    // Generate clarification message
                    // Note: generateMediatedClarification might need updating to handle context better
                    const clarificationQuestion = await generateMediatedClarification(otherUser.username, key, factValue, currentFact.value);

                    const agentName = await getAgentName(otherMember.user_id, circleId);
                    events.emit('broadcast', {
                        targetUsers: [otherMember.user_id],
                        message: clarificationQuestion,
                        from: agentName,
                        circleId
                    });
                }
            } catch (error) {
                console.error(`[ConflictHandler] Error during mediation: ${error.message}`);
            }
        }
    }
}
