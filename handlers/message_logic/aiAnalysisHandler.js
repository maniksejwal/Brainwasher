/**
 * @fileoverview Handles the primary AI analysis of a user's message.
 * This module calls the unified agent, processes its analysis, performs
 * entity resolution, logs the message, and sends the initial reply.
 */

import { getCircleMembers, addMessage, updateUserState, findUserById, findCircleByPatientId } from '../../db/index.js';
import { processUserMessage, performContextEnrichment } from '../../agents/index.js';
import { events } from '../../orchestrator.js';

async function resolveEntitiesAndEnrichContext(message, analysis, circleId) {
    if (!analysis.mentioned_entities || analysis.mentioned_entities.length === 0) {
        return analysis;
    }

    const members = await getCircleMembers(circleId);
    let enrichedAnalysis = { ...analysis };

    for (const entity of analysis.mentioned_entities) {
        const matchedMember = members.find(m => m.username.toLowerCase() === entity.toLowerCase());

        if (matchedMember) {
            console.log(`[EntityResolution] Matched entity "${entity}" to user "${matchedMember.username}"`);
            const re_evaluation = await performContextEnrichment(
                message,
                analysis,
                entity,
                matchedMember.username,
                matchedMember.role
            );
            enrichedAnalysis.criticality = re_evaluation.updated_criticality || enrichedAnalysis.criticality;
            // The enriched summary can be used in escalation details later.
        }
    }
    return enrichedAnalysis;
}


export async function performAiAnalysis(userId, role, message, circleId) {
    console.log(`[AIAnalysisHandler] Step 1: Performing initial analysis...`);
    const members = await getCircleMembers(circleId);
    const memberUsernames = members.map(m => m.username);
    
    let analysis = await processUserMessage(userId, role, message, memberUsernames, circleId);
    console.log(`[AIAnalysisHandler] Initial analysis complete.`);

    analysis = await resolveEntitiesAndEnrichContext(message, analysis, circleId);
    
    const currentCircle = await findCircleByPatientId(circleId);
    const patientUsername = (await findUserById(currentCircle.primary_patient_id)).username;

    // Persist the original message to the database with the final analysis.
    await addMessage(circleId, userId, role, message, analysis.privacyLevel, analysis.criticality);
    
    // Send the agent's conversational reply back to the original user.
    events.emit('broadcast', { targetUsers: [userId], reply: analysis.reply, from: 'personal-agent', circleId, patientUsername });
    
    // Update the user's behavioral state if the AI detected a change.
    if (analysis.state_update) {
        await updateUserState(userId, circleId, analysis.state_update);
        console.log(`[AIAnalysisHandler] State for '${userId}' in circle '${circleId}' updated:`, analysis.state_update);
    }

    return analysis;
}

