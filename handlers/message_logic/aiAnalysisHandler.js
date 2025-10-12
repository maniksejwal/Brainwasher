/**
 * @fileoverview handlers/message_logic/aiAnalysisHandler.js
 * Handles the primary AI analysis of a user's message. This includes the
 * "chain of thought" for entity resolution and context enrichment, ensuring
 * the system's final analysis is safe and context-aware.
 */

import { getCircleMembers, addMessage, updateUserState, findUserById, findCircleByPatientId } from '../../db/index.js';
import { processUserMessage, performContextEnrichment } from '../../agents/index.js';
import { events } from '../../orchestrator.js';
import { getAgentName } from '../utils/agentIdentity.js';

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
    // Step 1: Initial Analysis
    console.log(`[AIAnalysisHandler] Step 1: Performing initial analysis...`);
    events.emit('analysis_progress', { 
        userId, 
        step: 1, 
        description: 'Analyzing your message...', 
        details: 'Processing content and intent'
    });
    
    const members = await getCircleMembers(circleId);
    const memberUsernames = members.map(m => m.username);
    
    let analysis = await processUserMessage(userId, role, message, memberUsernames, circleId);
    console.log(`[AIAnalysisHandler] Initial analysis complete. Mentioned entities: ${analysis.mentioned_usernames?.join(', ')}`);

    // Step 2: Entity Resolution and Context Enrichment
    if (analysis.mentioned_usernames && analysis.mentioned_usernames.length > 0) {
        events.emit('analysis_progress', { 
            userId, 
            step: 2, 
            description: 'Resolving mentions and context...', 
            details: `Processing mentions: ${analysis.mentioned_usernames.join(', ')}`
        });
    }
    
    analysis = await resolveEntitiesAndEnrichContext(message, analysis, circleId);
    
    // Step 3: Database Operations
    events.emit('analysis_progress', { 
        userId, 
        step: 3, 
        description: 'Saving conversation...', 
        details: 'Storing message and analysis'
    });
    
    const currentCircle = await findCircleByPatientId(circleId);
    const patientUsername = (await findUserById(currentCircle.primary_patient_id)).username;

    // Persist the original message to the database with the *final, enriched* analysis.
    // Add safety defaults to prevent database constraint errors
    const criticality = analysis.criticality || 'NONE';
    const privacyLevel = analysis.privacyLevel || 'PRIVATE';
    await addMessage(circleId, userId, role, message, privacyLevel, criticality);
    
    // Step 4: Agent Response
    events.emit('analysis_progress', { 
        userId, 
        step: 4, 
        description: 'Preparing response...', 
        details: 'Generating personalized reply'
    });
    
    // Determine the appropriate agent name based on context
    const agentName = await getAgentName(userId, circleId);
    
    // Send the agent's conversational reply back to the original user.
    events.emit('broadcast', { targetUsers: [userId], reply: analysis.reply, from: agentName, circleId, patientUsername });
    
    if (analysis.state_update) {
        await updateUserState(userId, circleId, analysis.state_update);
        console.log(`[AIAnalysisHandler] State for '${userId}' in circle '${circleId}' updated:`, analysis.state_update);
    }

    // Step 5: Complete
    events.emit('analysis_progress', { 
        userId, 
        step: 5, 
        description: 'Analysis complete', 
        details: 'Response ready',
        complete: true
    });

    return analysis;
}

