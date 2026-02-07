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
    findCircleById,
    addEscalation,
    getRecentMessages,
    getUserState,
    getFactHistory,
    getUnreadEscalationsForCircle,
    findMemberInSharedCircles
} from '../../db/index.js';
import { processUserMessage, performContextEnrichment } from '../../agents/index.js';
import { events } from '../../orchestrator.js';
import { coordinateCompanions } from '../../companions/CompanionCoordinator.js';
import { notificationService } from '../../notifications/NotificationService.js';

async function resolveEntitiesAndEnrichContext(userId, message, analysis, circleId) {
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
        } else {
            // Cross-Circle Bridge Logic
            if (userId) { // Ensure we have the requester's ID
                const bridgedMember = await findMemberInSharedCircles(mentionedUsername, userId);
                if (bridgedMember) {
                    console.log(`[EntityResolution] Cross-Circle Bridge: Found "${mentionedUsername}" in circle ${bridgedMember.circle_id} (Role: ${bridgedMember.role})`);

                    // Proceed with context enrichment but note the cross-circle nature
                    // Pass a composite role description to the agent context
                    const bridgedRole = `${bridgedMember.role} (from shared circle ${bridgedMember.circle_id})`;

                    const re_evaluation = await performContextEnrichment(
                        message,
                        analysis,
                        mentionedUsername,
                        bridgedMember.username,
                        bridgedRole
                    );

                    if (re_evaluation && re_evaluation.updated_criticality) {
                        console.log(`[ContextEnrichment] (Bridged) Criticality updated from ${analysis.criticality} to ${re_evaluation.updated_criticality}`);
                        enrichedAnalysis.criticality = re_evaluation.updated_criticality;
                        enrichedAnalysis.enriched_summary = re_evaluation.updated_summary;
                    }

                    // Tag the analysis so downstream handlers know this was a bridge
                    if (!enrichedAnalysis.bridged_entities) {
                        enrichedAnalysis.bridged_entities = [];
                    }
                    enrichedAnalysis.bridged_entities.push({
                        username: bridgedMember.username,
                        circleId: bridgedMember.circle_id,
                        role: bridgedMember.role
                    });
                }
            }
        }
    }
    return enrichedAnalysis;
}

/**
 * Perform analysis using Companion system
 */
export async function performCompanionAnalysis(userId, role, message, circleId) {
    console.log(`[AIAnalysisHandler] Using Companion system...`);
    events.emit('analysis_progress', {
        userId,
        step: 1,
        description: 'Analyzing with Companion system...',
        details: 'Coordinating specialized handlers'
    });

    try {
        const { coordinateCompanions } = await import('../../companions/CompanionCoordinator.js');
        const { STAGES_OF_CHANGE, COPING_STYLES } = await import('../../behavioral_models.js');

        // Gather rich context (like unified agent does)
        const history = await getRecentMessages(circleId, 20);
        const members = await getCircleMembers(circleId);
        const currentState = await getUserState(userId, circleId);
        const factHistory = await getFactHistory(circleId, 'all', 10);
        const recentEscalations = await getUnreadEscalationsForCircle(circleId);
        const speaker = await findUserById(userId);
        const circle = await findCircleById(circleId);
        const patient = circle ? await findUserById(circle.primary_patient_id) : null;

        // NEW Features: Profile & Notifications
        const { getUserProfile } = await import('../../db/queries_users.js');
        const userProfile = await getUserProfile(userId);
        const unreadSummary = await notificationService.getUnreadSummary(userId);

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
            userProfile, // Demographics, prefs
            unreadSummary, // Notification counts
            hasMedicalContent: /pain|symptom|medication|diagnosis|treatment/i.test(message),
            hasCriticalContent: /emergency|urgent|critical|severe/i.test(message),
            circleId,
            behavioralModels,
            userAge: userProfile?.age || currentState?.age || null // Prioritize profile age
        };

        // Coordinate companions
        events.emit('analysis_progress', {
            userId,
            step: 2,
            description: 'Understanding your message…',
            details: 'Running Companion handlers for context'
        });
        const companionResult = await coordinateCompanions(userId, role, message, circleId, conversationContext);
        if (process.env.DEBUG_CLI) {
            console.log('[AIAnalysisHandler] Companion raw result:', {
                keys: Object.keys(companionResult || {}),
                replyPreview: companionResult?.reply ? companionResult.reply.slice(0, 120) : null,
                intent: companionResult?.intent,
                criticality: companionResult?.criticality
            });
        }

        events.emit('analysis_progress', {
            userId,
            step: 3,
            description: 'Synthesizing recommendations…',
            details: 'Aggregating handler responses'
        });

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
            reasoning: companionResult.reasoning || null, // Pass through reasoning/CoT
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

        events.emit('analysis_progress', {
            userId,
            step: 4,
            description: 'Resolving mentions…',
            details: analysis.mentioned_usernames?.length
                ? `Processing: ${analysis.mentioned_usernames.join(', ')}`
                : 'Checking for referenced participants'
        });

        // Entity resolution and context enrichment
        if (analysis.mentioned_usernames && analysis.mentioned_usernames.length > 0) {
            analysis = await resolveEntitiesAndEnrichContext(userId, message, analysis, circleId);
        }

        events.emit('analysis_progress', {
            userId,
            step: 5,
            description: 'Finalizing response…',
            details: 'Preparing reply for delivery'
        });
        if (process.env.DEBUG_CLI) {
            console.log('[AIAnalysisHandler] Companion analysis summary:', {
                system_used: 'companion',
                replyPreview: analysis.reply ? analysis.reply.slice(0, 120) : null,
                intent: analysis.intent,
                criticality: analysis.criticality,
                privacyLevel: analysis.privacyLevel
            });
        }

        return analysis;
    } catch (error) {
        console.error('[AIAnalysisHandler] Companion analysis error:', error);
        events.emit('analysis_progress', {
            userId,
            step: 5,
            description: 'Companion analysis fallback…',
            details: 'Reverting to default response'
        });
        throw error;
    } finally {
        events.emit('analysis_progress', { userId, complete: true });
    }
}

export async function performAiAnalysis(userId, role, message, circleId) {
    // Check if we should use Companion system or unified agent
    const configModule = await import('../../config.js');
    const cfg = configModule.default;
    const useCompanions = cfg.USE_COMPANIONS;

    // A/B testing: randomly assign to Companion or unified based on ratio
    let useCompanion = useCompanions;
    if (!useCompanions && cfg.COMPANION_AB_TEST_ENABLED) {
        useCompanion = Math.random() < cfg.COMPANION_AB_TEST_RATIO;
    }

    if (useCompanion) {
        try {
            return await performCompanionAnalysis(userId, role, message, circleId);
        } catch (error) {
            console.warn('[AIAnalysisHandler] Companion system failed, falling back to unified agent:', error?.message || error);
        }
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

    let analysis = await processUserMessage(userId, role, message, memberUsernames, circleId, null, { userProfile, unreadSummary });
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

    analysis = await resolveEntitiesAndEnrichContext(userId, message, analysis, circleId);

    // Step 3: Database Operations
    events.emit('analysis_progress', {
        userId,
        step: 3,
        description: 'Saving conversation...',
        details: 'Storing message and analysis'
    });

    const currentCircle = await findCircleById(circleId);
    if (!currentCircle) {
        console.warn(`[AIAnalysisHandler] Circle not found: ${circleId}`);
        return null;
    }
    const patient = await findUserById(currentCircle.primary_patient_id);
    const patientUsername = patient ? patient.username : 'unknown';

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

        // NEW: Send notifications via NotificationService
        try {
            const members = await getCircleMembers(circleId);
            for (const member of members) {
                // Don't notify the user who caused it? Or maybe yes?
                // For now, notify everyone including the sender.
                notificationService.send(
                    member.user_id,
                    'escalation',
                    `⚠️ Critical Event Detected: ${analysis.criticality}`,
                    { criticality: analysis.criticality, details: escalationDetails }
                ).catch(e => console.error(`[AIAnalysisHandler] Notification failed for ${member.user_id}:`, e.message));
            }
        } catch (e) {
            console.error('[AIAnalysisHandler] Error fetching members for notification:', e.message);
        }

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
    if (process.env.DEBUG_CLI) {
        console.log('[AIAnalysisHandler] Broadcasting reply', {
            userId,
            circleId,
            system_used: analysis?.system_used,
            hasReply: Boolean(analysis?.reply),
            replyPreview: analysis?.reply ? analysis.reply.slice(0, 120) : null
        });
    }

    return analysis;
}

