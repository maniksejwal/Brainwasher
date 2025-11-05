/**
 * @fileoverview handlers/message_logic/aiAnalysisHandler.js
 * Handles the primary AI analysis of a user's message. This includes the
 * "chain of thought" for entity resolution and context enrichment, ensuring
 * the system's final analysis is safe and context-aware.
 */

import { 
    getCircleMembers, 
    addMessage, 
    updateUserState, 
    findUserById, 
    findCircleByPatientId, 
    addEscalation,
    getRecentMessages,
    getUserState,
    getFactHistory,
    getUnreadEscalationsForCircle
} from '../../db/index.js';
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

/**
 * Perform analysis using Companion system
 */
async function performCompanionAnalysis(userId, role, message, circleId) {
    console.log(`[AIAnalysisHandler] Using Companion system...`);
    events.emit('analysis_progress', { 
        userId, 
        step: 1, 
        description: 'Analyzing with Companion system...', 
        details: 'Coordinating specialized handlers'
    });
    
    const { coordinateCompanions } = await import('../../companions/CompanionCoordinator.js');
    const { STAGES_OF_CHANGE, COPING_STYLES } = await import('../../behavioral_models.js');
    
    // Gather rich context (like unified agent does)
    const history = await getRecentMessages(circleId, 20);
    const members = await getCircleMembers(circleId);
    const currentState = await getUserState(userId, circleId);
    const factHistory = await getFactHistory(circleId, 'all', 10);
    const recentEscalations = await getUnreadEscalationsForCircle(circleId);
    const speaker = await findUserById(userId);
    const circle = await findCircleByPatientId(circleId);
    const patient = await findUserById(circle?.primary_patient_id);
    
    const behavioralModels = {
        stages_of_change: STAGES_OF_CHANGE,
        coping_styles: COPING_STYLES
    };
    
    // Format care circle members as string (like unified agent)
    const careCircleMembers = members.map(m => m.username).join(', ');
    
    // Prepare rich context for Companion handlers
    const conversationContext = {
        history,
        historyText: history.map(h => `${h.user_id}: ${h.message}`),
        members,
        careCircleMembers,
        currentState,
        factHistory,
        recentEscalations,
        speaker: speaker ? { username: speaker.username, userId: speaker.user_id } : null,
        patient: patient ? { username: patient.username, userId: patient.user_id } : null,
        hasMedicalContent: /pain|symptom|medication|diagnosis|treatment/i.test(message),
        hasCriticalContent: /emergency|urgent|critical|severe/i.test(message),
        circleId,
        behavioralModels,
        userAge: currentState?.age || null // For elderly fall detection
    };
    
    // Coordinate companions
    const companionResult = await coordinateCompanions(userId, role, message, circleId, conversationContext);
    
    // Convert Companion result to unified analysis format
    let analysis = {
        intent: companionResult.intent || 'ASKING_QUESTION',
        reply: companionResult.reply || 'I understand.',
        privacyLevel: companionResult.privacyLevel || 'PRIVATE',
        criticality: companionResult.criticality || 'NONE',
        facts: companionResult.facts || {},
        mentioned_usernames: companionResult.mentioned_usernames || [],
        sharingSuggestion: companionResult.sharingSuggestion || null,
        state_update: companionResult.state_update || null, // Include state update if generated
        future_plan: companionResult.future_plan || null, // Include future planning from Companion (now generated!)
        system_used: 'companion' // Track which system was used
    };
    
    // Extract mentioned_usernames from inputUnderstanding if not already set
    if (!analysis.mentioned_usernames || analysis.mentioned_usernames.length === 0) {
        const inputResult = conversationContext.inputUnderstanding?.result || 
                           companionResult.inputUnderstanding?.result ||
                           conversationContext.inputUnderstanding;
        if (inputResult?.mentionedUsernames || inputResult?.mentioned_usernames) {
            analysis.mentioned_usernames = inputResult.mentionedUsernames || inputResult.mentioned_usernames || [];
        }
    }
    
    // Entity resolution and context enrichment
    if (analysis.mentioned_usernames && analysis.mentioned_usernames.length > 0) {
        analysis = await resolveEntitiesAndEnrichContext(message, analysis, circleId);
    }
    
    return analysis;
}

export async function performAiAnalysis(userId, role, message, circleId) {
    // Check if we should use Companion system or unified agent
    const config = await import('../../config.js');
    const useCompanions = config.default.USE_COMPANIONS;
    
    // A/B testing: randomly assign to Companion or unified based on ratio
    let useCompanion = useCompanions;
    if (!useCompanions && config.default.COMPANION_AB_TEST_ENABLED) {
        useCompanion = Math.random() < config.default.COMPANION_AB_TEST_RATIO;
    }
    
    if (useCompanion) {
        return await performCompanionAnalysis(userId, role, message, circleId);
    }
    
    // Step 1: Initial Analysis (Unified Agent)
    console.log(`[AIAnalysisHandler] Step 1: Performing initial analysis (Unified Agent)...`);
    events.emit('analysis_progress', { 
        userId, 
        step: 1, 
        description: 'Analyzing your message...', 
        details: 'Processing content and intent'
    });
    
    const members = await getCircleMembers(circleId);
    const memberUsernames = members.map(m => m.username);
    
    let analysis = await processUserMessage(userId, role, message, memberUsernames, circleId);
    analysis.system_used = 'unified'; // Track which system was used
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
    
    // Check for escalation based on criticality
    if (analysis.criticality === 'HIGH' || analysis.criticality === 'CRITICAL') {
        console.log(`🚨 [AIAnalysisHandler] HIGH/CRITICAL escalation detected for user ${userId} in circle ${circleId}`);
        
        // Add escalation to database
        const escalationDetails = `AI Analysis detected ${analysis.criticality} criticality. Message: "${message}"`;
        await addEscalation(circleId, analysis.criticality, escalationDetails);
        
        // Emit escalation event for notification system
        events.emit('escalate', { circleId });
        
        console.log(`📢 [AIAnalysisHandler] Escalation event emitted for circle ${circleId}`);
    }
    
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

