/**
 * @fileoverview Handles the logic for processing facts from an AI analysis,
 * detecting conflicts between user reports, and initiating mediated clarification.
 */

import chalk from 'chalk';
import { getMemberInfo, findUserById, addEscalation } from '../../db/index.js';
import { addFact, getCurrentFact, recordFactConflict } from '../../db/queries_facts.js';
import { generateMediatedClarification } from '../../agents/index.js'; // Ensure this is exported/updated
import { events } from '../../orchestrator.js'; // Or wherever addEscalation/events come from
import { getAgentName } from '../utils/agentIdentity.js';

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

        // Add the new fact (this archives the old one)
        const newFactId = await addFact(circleId, key, factValue, metadata);

        // Conflict Detection: there WAS a current fact, different reporter, different value
        if (currentFact && currentFact.reported_by !== userId && String(currentFact.value) !== String(factValue)) {
            console.log(chalk.yellow.bold(`[ConflictHandler] CONFLICT DETECTED in circle ${circleId} on '${key}'`));

            const conflictDetails = `Conflict on '${key}': User ${userId} says '${factValue}', but ${currentFact.reported_by} said '${currentFact.value}'.`;
            await addEscalation(circleId, 'CONFLICT', conflictDetails);
            events.emit('escalate', { circleId });

            // Record the conflict event in fact_conflicts with message reference for full audit trail.
            // analysis.messageId and analysis.messageText are populated by the calling handler
            // when it has access to the originating message (e.g. aiAnalysisHandler.js).
            await recordFactConflict({
                circleId,
                factKey:              key,
                reporterUserId:       userId,
                claimedValue:         factValue,
                existingValue:        currentFact.value,
                existingReporterId:   currentFact.reported_by,
                factIdNew:            newFactId,
                factIdExisting:       currentFact.fact_id,
                sourceMessageId:      analysis.messageId   || null,
                sourceMessageText:    analysis.messageText || null,
                existingMessageId:    currentFact.provenance || null,
                existingMessageText:  null,   // not stored on the fact row itself
            }).catch(err => console.error('[ConflictHandler] recordFactConflict failed:', err.message));

            // Initiate mediated clarification with the previous reporter
            try {
                const otherMember = await getMemberInfo(currentFact.reported_by, circleId);
                if (otherMember) {
                    const otherUser = await findUserById(otherMember.user_id);
                    const clarificationQuestion = await generateMediatedClarification(otherUser.username, key, factValue, currentFact.value);

                    const agentName = await getAgentName(otherMember.user_id, circleId);
                    // Share the clarification question to the other member's companion
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
