/**
 * @fileoverview handlers/messageHandler.js
 * The main dispatcher for handling all regular user messages (non-commands).
 * This module follows a clear "chain of thought" to process incoming messages.
 */

import { getMemberInfo, findUserById, findCircleByPatientId, findCircleById, getCircleMembers, addMessage, getRecentMessages, updateUserState, addPendingAction } from '../db/index.js';
import { performAiAnalysis } from './message_logic/aiAnalysisHandler.js';
import { handleFactProcessing } from './message_logic/conflictHandler.js';
import { handleSharingAndEscalation } from './message_logic/sharing/index.js';
import { handlePendingActionResponse } from './message_logic/actionResponseHandler.js';
import { initializeTopicShiftHandler } from './message_logic/topicShiftHandler.js';
import { handleFuturePlanning } from './message_logic/futurePlanningHandler.js';
import { checkIfShouldReschedule, rescheduleAffectedPlans } from './message_logic/rescheduleHandler.js';
import { events } from '../orchestrator.js';
import { logger as trainingLogger, metrics as metricsCollector } from '../training/index.js';
import { getAgentName } from './utils/agentIdentity.js';
import { generateDelegatedProbe } from '../agents/index.js';
import { randomUUID } from 'crypto';

// Lazy initialization of topic shift handler
let topicShiftHandler = null;

export async function handleMessage(userId, circleId, message) {
    // Lazy initialize topic shift handler to avoid circular dependency
    if (!topicShiftHandler) {
        topicShiftHandler = initializeTopicShiftHandler(events);
    }
    
    const startTime = Date.now();
    const memberInfo = await getMemberInfo(userId, circleId);
    if (!memberInfo) {
        console.error(`[MessageHandler] ERROR: User ${userId} is not a member of circle ${circleId}.`);
        return;
    }

    // A doctor's message requires targeted delivery that respects privacy.
    if (memberInfo.role === 'doctor') {
        const members = await getCircleMembers(circleId);
        const circle = await findCircleById(circleId);
        if (!circle) {
            throw new Error(`Circle '${circleId}' not found when handling message for ${userId}`);
        }

        const patient = await findUserById(circle.primary_patient_id);
        const doctorRecord = members.find(m => m.user_id === userId);
        const doctorDisplayName = doctorRecord?.username || 'doctor';

        const { recipients, privacyLevel } = determineDoctorRecipients(
            message,
            members,
            userId,
            circle.primary_patient_id
        );

        if (!recipients || recipients.length === 0) {
            console.warn(`[MessageHandler] Doctor message from '${doctorDisplayName}' had no eligible recipients.`);
            return {
                reply: 'No eligible recipients identified; your message was not delivered.',
                intent: 'DOCTOR_NO_RECIPIENTS',
                criticality: 'NONE',
                privacyLevel: 'PRIVATE',
                facts: {}
            };
        }

        const targetUserIds = recipients.map(r => r.user_id);
        const recipientNames = recipients.map(r => r.username);

        await addMessage(circleId, userId, memberInfo.role, message, privacyLevel, 'NONE');

        console.log(`[MessageHandler] Doctor '${doctorDisplayName}' instruction targeting [${recipientNames.join(', ')}] with privacy=${privacyLevel}.`);

        const sanitizedInstruction = sanitizeDoctorInstruction(message);
        const askTopic = sanitizedInstruction || message;
        const successfulRecipients = [];
        const failedRecipients = [];

        for (const recipient of recipients) {
            let probe = null;
            try {
                probe = await generateDelegatedProbe(recipient.username, askTopic);
            } catch (error) {
                console.error(`[MessageHandler] Failed to generate delegated probe for ${recipient.username}:`, error);
                probe = buildFallbackProbe(recipient.username, askTopic);
                failedRecipients.push(recipient.username);
            }

            if (!probe) {
                continue;
            }

            const pendingDetails = {
                topic: askTopic,
                original_instruction: message,
                target_user_id: recipient.user_id,
                target_username: recipient.username,
                full_question: probe,
                requested_by: userId
            };

            const pendingActionId = randomUUID();
            await addPendingAction(
                pendingActionId,
                circleId,
                recipient.user_id,
                'delegated_probe_response',
                { ...pendingDetails, action_type: 'delegated_probe_response' }
            );

            const agentName = await getAgentName(recipient.user_id, circleId);
            events.emit('broadcast', {
                targetUsers: [recipient.user_id],
                message: probe,
                from: agentName,
                circleId,
                patientUsername: patient?.username ?? doctorDisplayName,
                visibility: privacyLevel,
                recipients: [recipient.username],
                doctorInstruction: {
                    instruction: message,
                    pendingActionId,
                    requestedBy: doctorDisplayName
                }
            });

            successfulRecipients.push({ username: recipient.username, question: probe });
        }

        const summaryParts = [];
        if (successfulRecipients.length > 0) {
            const detail = successfulRecipients
                .map(({ username, question }) => `${username}: "${question}"`)
                .join('; ');
            summaryParts.push(`Questions sent → ${detail}`);
        }
        if (failedRecipients.length > 0) {
            summaryParts.push(`⚠️ Could not reach: ${failedRecipients.join(', ')}`);
        }

        const summaryReply = summaryParts.length > 0
            ? summaryParts.join(' | ')
            : 'No eligible recipients identified for your instruction.';

        events.emit('broadcast', {
            targetUsers: [userId],
            reply: summaryReply,
            from: 'system',
            circleId,
            patientUsername: patient?.username ?? doctorDisplayName
        });
        
        // Training log (fire-and-forget, non-blocking)
        metricsCollector.recordMessageLength(userId, message.length, message.length);
        
        return {
            reply: summaryReply,
            intent: 'DOCTOR_MESSAGE',
            criticality: 'NONE',
            privacyLevel,
            facts: {}
        };
    }
    
    // For patients and caregivers, follow the full "chain of thought".
    
    // Step 1: Handle any pending user actions.
    const wasActionHandled = await handlePendingActionResponse(userId, circleId, message);
    if (wasActionHandled) { 
        metricsCollector.recordResponseTime('action_response', Date.now() - startTime, true);
        return {
            reply: "Action handled successfully",
            intent: 'ACTION_RESPONSE',
            criticality: 'NONE',
            privacyLevel: 'PRIVATE',
            facts: {}
        }; 
    }

    // Step 2: Perform the full AI analysis, including entity resolution.
    // This will use Companion system or unified agent based on config
    const analysis = await performAiAnalysis(userId, memberInfo.role, message, circleId);
    if (process.env.DEBUG_CLI) {
        console.log('[MessageHandler] Analysis summary:', {
            system_used: analysis?.system_used,
            intent: analysis?.intent,
            hasReply: Boolean(analysis?.reply),
            replyPreview: analysis?.reply ? analysis.reply.slice(0, 80) : null,
            hasSharingSuggestion: Boolean(analysis?.sharingSuggestion),
            sharingSuggestion: analysis?.sharingSuggestion || null
        });
    }
    
    // Step 3: Process pending future plans and scheduled messages for current turn (PRODUCTION)
    // Get current turn from conversation history (used for both future planning and execution)
    const conversationHistory = await getRecentMessages(circleId, 100);
    const currentTurn = conversationHistory.filter(m => m.user_id === userId).length;
    
    // Prepare conversation context for progress triggers
    const conversationContext = {
        analysis,
        userMessage: message,
        consentGranted: false, // Will be set by sharing handler if consent is granted
        currentTurn
    };
    
    // Execute any due future plans and scheduled messages (including conversation progress triggers)
    const { processPendingFutureItems, executePlan, sendScheduledMessage } = await import('./message_logic/futurePlanningHandler.js');
    const pendingItems = await processPendingFutureItems(userId, circleId, currentTurn, conversationContext);
    
    // Execute due future plans
    for (const plan of pendingItems.plans) {
        await executePlan(plan);
    }
    
    // Send due scheduled messages
    for (const scheduledMsg of pendingItems.messages) {
        await sendScheduledMessage(scheduledMsg);
    }
    
    // Step 3.5: Handle future planning (if present in analysis) - creates NEW plans
    if (analysis.future_plan) {
        await handleFuturePlanning(userId, circleId, analysis, currentTurn);
    }
    
    // Step 4: Handle the core logic for sharing, advice, and escalations.
    const sharingResult = await handleSharingAndEscalation(userId, memberInfo.role, message, circleId, analysis);
    
    // Update conversation context with consent status if sharing was handled
    if (sharingResult?.consentGranted) {
        conversationContext.consentGranted = true;
    }
    
    // Step 4.5: Handle care circle probing questions (caregiver/patient cross-questioning)
    // This doesn't interfere with doctor commands - checks for active doctor delegations first
    const { handleCaregiverProbing, handlePatientProbingFromCaregiver } = await import('./message_logic/sharing/caregiverProbing.js');
    await handleCaregiverProbing(userId, memberInfo.role, message, circleId, analysis, currentTurn);
    await handlePatientProbingFromCaregiver(userId, memberInfo.role, message, circleId, analysis, currentTurn);
    
    // Step 4.6: Reschedule future plans if conversation doesn't make sense or commands were run
    // Check if conversation context changed significantly (e.g., /clear, topic shift, user backtracking)
    const shouldReschedule = await checkIfShouldReschedule(userId, circleId, analysis, message);
    if (shouldReschedule.shouldReschedule) {
        await rescheduleAffectedPlans(userId, circleId, shouldReschedule.reason);
    }
    
    // Step 5: Process facts and check for conflicts.
    await handleFactProcessing(userId, circleId, analysis);
    
    // Step 5.5: Update behavioral state if state_update is present
    if (analysis.state_update) {
        await updateUserState(userId, circleId, analysis.state_update);
    }

    // Ensure the originating user receives the conversational reply.
    if (analysis?.reply) {
        const circle = await findCircleById(circleId);
        const patient = circle ? await findUserById(circle.primary_patient_id) : null;
        const agentName = await getAgentName(userId, circleId);
        if (process.env.DEBUG_CLI) {
            console.log(`[MessageHandler] Emitting primary reply to ${userId} from ${agentName}. Preview="${analysis.reply.slice(0, 80)}"`);
        }
        events.emit('broadcast', {
            targetUsers: [userId],
            reply: analysis.reply,
            from: agentName,
            circleId,
            patientUsername: patient?.username ?? userId
        });
    } else {
        if (process.env.DEBUG_CLI) {
            console.warn('[MessageHandler] Analysis produced no reply text; user may not receive feedback.');
        }
    }
    
    // Training log (fire-and-forget, non-blocking) - happens after main flow completes
    const latencyMs = Date.now() - startTime;
    trainingLogger.logInteraction({
        conversationId: `${circleId}_${userId}_${Date.now()}`,
        userId,
        message,
        agentResponse: analysis?.reply || analysis?.agent_response || '',
        orchestratorAction: sharingResult?.action || { type: 'NONE' },
        stateVector: analysis?.state_vector,
        promptVersion: 'unified_v1.0',
        systemUsed: analysis?.system_used || 'unified', // Track Companion vs unified
        latencyMs
    }).catch(err => {}); // Silently fail
    
    metricsCollector.recordResponseTime('full_analysis', latencyMs, true);
    metricsCollector.recordMessageLength(userId, message.length, analysis?.agent_response?.length || 0);
    
    // Return the analysis for simulations to use
    return analysis;
}

function determineDoctorRecipients(message = '', members = [], doctorId, patientId) {
    const normalizedMessage = String(message || '');
    const otherMembers = members.filter(member => member.user_id !== doctorId);
    const normalizedMap = new Map();
    otherMembers.forEach(member => {
        const key = (member.username || '').trim().toLowerCase();
        if (key) {
            normalizedMap.set(key, member);
        }
    });

    const recipientsMap = new Map();
    const mentionRegex = /@([a-z0-9._-]+)/gi;
    let match;
    let explicitGlobalMention = false;
    while ((match = mentionRegex.exec(normalizedMessage)) !== null) {
        const token = match[1].toLowerCase();
        if (token === 'all' || token === 'everyone' || token === 'team' || token === 'careteam') {
            explicitGlobalMention = true;
            break;
        }
        const member = normalizedMap.get(token);
        if (member) {
            recipientsMap.set(member.user_id, member);
        }
    }

    if (explicitGlobalMention) {
        return {
            recipients: otherMembers,
            privacyLevel: 'PUBLIC'
        };
    }

    const lowerMessage = normalizedMessage.toLowerCase();
    const addMembersByRole = (role) => {
        otherMembers
            .filter(member => member.role === role)
            .forEach(member => recipientsMap.set(member.user_id, member));
    };

    if (/\bcaregivers?\b/.test(lowerMessage) || /\bfamily\b/.test(lowerMessage) || /\bparents?\b/.test(lowerMessage)) {
        addMembersByRole('caregiver');
    }

    if (/\bpatients?\b/.test(lowerMessage) || /\bpatient\b/.test(lowerMessage)) {
        const patientMember = otherMembers.find(member => member.user_id === patientId);
        if (patientMember) {
            recipientsMap.set(patientMember.user_id, patientMember);
        }
    }

    // Always prefer explicit mentions over keyword defaults.
    if (recipientsMap.size === 0) {
        const patientMember = otherMembers.find(member => member.user_id === patientId);
        if (patientMember) {
            recipientsMap.set(patientMember.user_id, patientMember);
        }
    }

    const recipients = Array.from(recipientsMap.values());
    if (recipients.length === 0) {
        return {
            recipients,
            privacyLevel: 'PRIVATE'
        };
    }

    const allOthersCount = otherMembers.length;
    let privacyLevel = 'PRIVATE';
    if (recipients.length === allOthersCount && allOthersCount > 1) {
        privacyLevel = 'PUBLIC';
    } else if (recipients.length > 1) {
        privacyLevel = 'LIMITED';
    } else if (recipients[0].user_id !== patientId) {
        privacyLevel = 'LIMITED';
    }

    return {
        recipients,
        privacyLevel
    };
}

function sanitizeDoctorInstruction(text = '') {
    return text.replace(/@\w+/g, '').replace(/\s+/g, ' ').trim();
}

function buildFallbackProbe(username, instruction) {
    const trimmed = instruction?.trim();
    if (!trimmed) {
        return `Hi ${username}, could you share how you're feeling right now?`;
    }
    return `Hi ${username}, ${trimmed}. Could you tell me more?`;
}

