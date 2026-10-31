/**
 * @fileoverview handlers/message_logic/sharing/criticalEvents.js
 * Handles critical health events and family notifications.
 * Uses confidence-based escalation: high-confidence emergencies propose an alert the user accepts,
 * otherwise schedules a follow-up question for the next turn without escalating.
 */

import { findUserById, findCircleByPatientId } from '../../../db/index.js';
import { proposeEscalation } from '../../../services/escalationService.js';
import { createScheduledMessage } from '../../../db/queries_future_plans.js';
import { makeApiCall } from '../../../agents/api_client.js';
import { generateEmergencyConfidencePrompt, generateEscalationHintPrompt } from '../../../prompts/emergency_confidence_prompt.js';

// HIGH turns escalate immediately at or above this emergency confidence; below it, a follow-up is asked.
// A failed confidence call returns 0.6, which is below the threshold.
export const ESCALATION_CONFIDENCE_THRESHOLD = 0.9;

/**
 * Calculate confidence level for HIGH criticality events using LLM
 * @param {string} message - User message
 * @param {object} analysis - AI analysis result
 * @returns {Promise<number>} Confidence level (0-1)
 */
async function calculateEmergencyConfidence(message, analysis) {
    try {
        const prompt = generateEmergencyConfidencePrompt(message, analysis);
        
        const result = await makeApiCall(
            prompt,
            [],
            true, // expectJson
            0.2, // temperature (low for consistent assessment)
            500, // maxTokens
            'critical_analysis' // useCase
        );
        
        // Parse the JSON response
        let assessment;
        if (typeof result === 'object' && result.reply) {
            const jsonText = result.reply;
            try {
                assessment = JSON.parse(jsonText);
            } catch (parseError) {
                // Try to extract JSON from markdown code blocks
                const jsonMatch = jsonText.match(/```json\s*([\s\S]*?)\s*```/) || jsonText.match(/```\s*([\s\S]*?)\s*```/) || jsonText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    assessment = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                } else {
                    throw new Error('Could not parse JSON from LLM response');
                }
            }
        } else if (typeof result === 'object') {
            assessment = result;
        } else {
            throw new Error('Unexpected response format from LLM');
        }
        
        // Extract confidence level
        const confidence = assessment.confidence || 0.5;
        
        // Log reasoning if available
        if (assessment.reasoning && process.env.DEBUG_ESCALATION) {
            console.log(`[CriticalEvents] Emergency confidence: ${(confidence * 100).toFixed(0)}% - ${assessment.reasoning}`);
        }
        
        return Math.max(0, Math.min(1, confidence)); // Clamp between 0 and 1
    } catch (error) {
        console.warn(`[CriticalEvents] LLM confidence assessment failed, using fallback:`, error.message);
        // Fallback to conservative assessment
        return 0.6; // Medium confidence as fallback
    }
}

/**
 * Handles HIGH criticality events with confidence-based escalation
 * Proposes an alert to the doctors and caregivers only if confidence is very high (0.9+)
 * Otherwise schedules a follow-up question for the next turn without escalating
 * @param {string} userId - The user who reported the critical event
 * @param {string} role - The role of the user
 * @param {string} message - The original message
 * @param {string} circleId - The circle ID
 * @param {object} analysis - The AI analysis result
 * @param {number} currentTurn - Current conversation turn number (optional)
 * @returns {Promise<object|false>} - Sharing result with the actions taken, or false if not HIGH
 */
export async function handleCriticalEvent(userId, role, message, circleId, analysis, currentTurn = 1) {
    if (analysis.criticality !== 'HIGH') {
        return false;
    }

    const currentCircle = await findCircleByPatientId(circleId);
    const patientUsername = (await findUserById(currentCircle.primary_patient_id)).username;

    // Calculate confidence level for emergency using LLM
    const confidence = await calculateEmergencyConfidence(message, analysis);
    
    // High confidence (0.9+): a clear emergency. The alert to the doctors and caregivers is
    // proposed, not sent: the reply opens with the emergency sentence and asks the user to
    // accept the alert, which goes out on "yes" (escalationService.decideEscalationProposal).
    if (confidence >= ESCALATION_CONFIDENCE_THRESHOLD) {
        const criticalDetails = `User '${userId}' (${role}) reported: "${message}" [High confidence emergency (${(confidence * 100).toFixed(0)}%)]`;
        const { proposal, question, actions } = await proposeEscalation({
            circleId,
            userId,
            type: 'CRITICAL',
            details: criticalDetails,
            messageId: analysis.message_id ?? null,
            notifyCaregivers: true,
            caregiverMessage: `Urgent health update: ${patientUsername} reported a critical health concern. Please check on them.`,
            patientUsername
        });

        // The user is not messaged here: messageHandler puts the question in its one reply.
        return {
            action: 'PROPOSE_ESCALATION',
            escalated: false,
            details: { escalation_type: 'CRITICAL', proposal_id: proposal?.actionId ?? null, confidence },
            question,
            proposal,
            actions
        };
    }
    
    // Lower confidence: ask a follow-up question on the next turn. This does not escalate.
    const nextTurn = currentTurn + 1;
    
    // Create a follow-up question that hints at escalation using LLM
    const followUpQuestion = await generateEscalationHintQuestion(message, analysis, confidence);
    
    // Schedule the follow-up question for the next turn
    await createScheduledMessage(
        circleId,
        userId,
        followUpQuestion,
        nextTurn,
        userId, // target_user_id
        'turn', // trigger_type
        null, // trigger_value
        {
            escalation_intent: true,
            original_message: message,
            confidence: confidence
        }, // trigger_details
        null // trigger_condition
    );
    
    // No acknowledgment is sent here: it repeated analysis.reply as a second message.
    return {
        action: 'FOLLOW_UP',
        escalated: false,
        details: { confidence },
        actions: {}
    };
}

/**
 * Generate a follow-up question that hints at escalation intent using LLM
 * @param {string} message - Original user message
 * @param {object} analysis - AI analysis result
 * @param {number} confidence - Confidence level (0-1)
 * @returns {Promise<string>} Follow-up question that hints at escalation
 */
async function generateEscalationHintQuestion(message, analysis, confidence) {
    try {
        const prompt = generateEscalationHintPrompt(message, analysis, confidence);
        
        const result = await makeApiCall(
            prompt,
            [],
            true, // expectJson
            0.4, // temperature (slightly higher for natural questions)
            300, // maxTokens
            'basic_responses' // useCase
        );
        
        // Parse the JSON response
        let questionData;
        if (typeof result === 'object' && result.reply) {
            const jsonText = result.reply;
            try {
                questionData = JSON.parse(jsonText);
            } catch (parseError) {
                // Try to extract JSON from markdown code blocks
                const jsonMatch = jsonText.match(/```json\s*([\s\S]*?)\s*```/) || jsonText.match(/```\s*([\s\S]*?)\s*```/) || jsonText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    questionData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                } else {
                    throw new Error('Could not parse JSON from LLM response');
                }
            }
        } else if (typeof result === 'object') {
            questionData = result;
        } else {
            throw new Error('Unexpected response format from LLM');
        }
        
        return questionData.question || `Are you experiencing any other symptoms, or is this getting worse? If this is severe or you're concerned, I can help arrange a consultation with your doctor.`;
    } catch (error) {
        console.warn(`[CriticalEvents] LLM question generation failed, using fallback:`, error.message);
        // Fallback to generic question
        return `Are you experiencing any other symptoms, or is this getting worse? If this is severe or you're concerned, I can help arrange a consultation with your doctor.`;
    }
}
