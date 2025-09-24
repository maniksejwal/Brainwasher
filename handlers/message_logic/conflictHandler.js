/**
 * @fileoverview Handles the logic for processing facts from an AI analysis,
 * detecting conflicts between user reports, and initiating mediated clarification.
 */

import chalk from 'chalk';
import { upsertFact, getLastFact, addEscalation, getMemberInfo, findUserById, findCircleByPatientId } from '../../db/index.js';
import { generateMediatedClarification } from '../../agents/index.js';
import { events } from '../../orchestrator.js';
import { getAgentName } from '../utils/agentIdentity.js';

export async function handleFactProcessing(userId, circleId, analysis) {
    if (!analysis.facts || Object.keys(analysis.facts).length === 0) {
        return; // No facts to process
    }

    for (const [key, value] of Object.entries(analysis.facts)) {
        const lastFact = await getLastFact(circleId, key);
        await upsertFact(circleId, key, userId, value);

        if (lastFact && lastFact.reported_by !== userId && String(lastFact.value) !== String(value)) {
            console.log(chalk.yellow.bold(`[ConflictHandler] CONFLICT DETECTED in circle ${circleId} on '${key}'`));
            const conflictDetails = `Reports on '${key}' are conflicting.`;
            await addEscalation(circleId, 'CONFLICT', conflictDetails);
            events.emit('escalate', { circleId });

            // Initiate mediated clarification with the other party
            const otherMember = await getMemberInfo(lastFact.reported_by, circleId);
            if (otherMember) {
                const otherUser = await findUserById(otherMember.user_id);
                const clarificationQuestion = await generateMediatedClarification(otherUser.username, key);
                const agentName = await getAgentName(otherMember.user_id, circleId);
                events.emit('broadcast', { targetUsers: [otherMember.user_id], message: clarificationQuestion, from: agentName, circleId });
            }
        }
    }
}
