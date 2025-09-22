/**
 * @fileoverview handlers/message_logic/aiAnalysisHandler.js
 * Handles the primary AI analysis of a user's message. This includes the
 * "chain of thought" for entity resolution and context enrichment, ensuring
 * the system's final analysis is safe and context-aware.
 */

import { getCircleMembers, addMessage, updateUserState, findUserById, findCircleByPatientId } from '../../db/index.js';
import { processUserMessage, performContextEnrichment } from '../../agents/index.js';
import { events } from '../../orchestrator.js';

async function resolveEntitiesAndEnrichContext(message, analysis, circleId) {
    if (!analysis.mentioned_usernames || analysis.mentioned_usernames.length === 0) {
        return analysis; // No entities to resolve, return original analysis.
    }

    const members = await getCircleMembers(circleId);
    let enrichedAnalysis = { ...analysis };

    for (const mentionedUsername of analysis.mentioned_usernames) {
        const matchedMember = members.find(m => m.username.toLowerCase() === mentionedUsername.toLowerCase());

        if (matchedMember) {
            console.log(`[EntityResolution] Matched entity "${mentionedUsername}" to user "${matchedMember.username}" in circle ${circleId}`);
            // This is the critical re-evaluation step.
            const re_evaluation = await performContextEnrichment(
                message,
                analysis,
                mentionedUsername,
                matchedMember.username,
                matchedMember.role
            );

            if (re_evaluation && re_evaluation.updated_criticality) {
                 console.log(`[ContextEnrichment] Criticality updated from ${analysis.criticality} to ${re_evaluation.updated_criticality}`);
                 enrichedAnalysis.criticality = re_evaluation.updated_criticality;
                 // We can also store the enriched summary for better escalation details later.
                 enrichedAnalysis.enriched_summary = re_evaluation.updated_summary;
            }
        }
    }
    return enrichedAnalysis;
}


export async function performAiAnalysis(userId, role, message, circleId) {
    console.log(`[AIAnalysisHandler] Step 1: Performing initial analysis...`);
    const members = await getCircleMembers(circleId);
    const memberUsernames = members.map(m => m.username);
    
    let analysis = await processUserMessage(userId, role, message, memberUsernames, circleId);
    console.log(`[AIAnalysisHandler] Initial analysis complete. Mentioned entities: ${analysis.mentioned_usernames?.join(', ')}`);

    // Step 2: Perform Entity Resolution and Context Enrichment.
    analysis = await resolveEntitiesAndEnrichContext(message, analysis, circleId);
    
    const currentCircle = await findCircleByPatientId(circleId);
    const patientUsername = (await findUserById(currentCircle.primary_patient_id)).username;

    // Persist the original message to the database with the *final, enriched* analysis.
    await addMessage(circleId, userId, role, message, analysis.privacyLevel, analysis.criticality);
    
    // Send the agent's conversational reply back to the original user.
    events.emit('broadcast', { targetUsers: [userId], reply: analysis.reply, from: 'personal-agent', circleId, patientUsername });
    
    if (analysis.state_update) {
        await updateUserState(userId, circleId, analysis.state_update);
        console.log(`[AIAnalysisHandler] State for '${userId}' in circle '${circleId}' updated:`, analysis.state_update);
    }

    return analysis;
}

