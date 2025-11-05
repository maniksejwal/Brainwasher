/**
 * @fileoverview handlers/message_logic/sharing/criticalEvents.js
 * Handles critical health events and family notifications.
 * Uses confidence-based escalation: immediate escalation only for high-confidence emergencies,
 * otherwise uses future planning to ask a follow-up question before escalating.
 */

import { addEscalation, getCircleMembers, findUserById, findCircleByPatientId } from '../../../db/index.js';
import { events } from '../../../orchestrator.js';
import { getAgentName } from '../../utils/agentIdentity.js';
import { createScheduledMessage } from '../../../db/queries_future_plans.js';
import { makeApiCall } from '../../../agents/api_client.js';
import { generateEmergencyConfidencePrompt, generateEscalationHintPrompt } from '../../../prompts/emergency_confidence_prompt.js';

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
 * Only escalates immediately if confidence is very high (0.9+)
 * Otherwise uses future planning to ask a follow-up question before escalating
 * @param {string} userId - The user who reported the critical event
 * @param {string} role - The role of the user
 * @param {string} message - The original message
 * @param {string} circleId - The circle ID
 * @param {object} analysis - The AI analysis result
 * @param {number} currentTurn - Current conversation turn number (optional)
 * @returns {Promise<boolean>} - True if handled, false otherwise
 */
export async function handleCriticalEvent(userId, role, message, circleId, analysis, currentTurn = 1) {
    if (analysis.criticality !== 'HIGH') {
        return false;
    }

    const currentCircle = await findCircleByPatientId(circleId);
    const patientUsername = (await findUserById(currentCircle.primary_patient_id)).username;

    // Calculate confidence level for emergency using LLM
    const confidence = await calculateEmergencyConfidence(message, analysis);
    
    // High confidence (0.9+): Immediate escalation - clear emergency
    if (confidence >= 0.9) {
        // ESCALATION DENIAL OVERRIDE: For HIGH criticality with high confidence, we MUST escalate regardless of patient consent
        const criticalDetails = `User '${userId}' (${role}) reported: "${message}" [IMMEDIATE ESCALATION: High confidence emergency (${(confidence * 100).toFixed(0)}%)]`;
        await addEscalation(circleId, 'CRITICAL', criticalDetails);
        events.emit('escalate', { circleId });
        
        // Notify family members about critical health issues
        const members = await getCircleMembers(circleId);
        const familyMembers = members.filter(m => m.role === 'caregiver' && m.user_id !== userId);
        if (familyMembers.length > 0) {
            const familyNotification = `Urgent health update: ${patientUsername} reported a critical health concern. Please check on them. [Automatically notified due to criticality]`;
            const agentName = await getAgentName(familyMembers[0].user_id, circleId);
            events.emit('broadcast', { 
                targetUsers: familyMembers.map(m => m.user_id), 
                message: familyNotification, 
                from: agentName, 
                circleId, 
                patientUsername 
            });
        }
        
        // Inform patient that escalation is mandatory for safety
        const confirmationReply = `This sounds very serious. I'm escalating this to the doctor immediately for your safety. This escalation happens automatically for clear emergencies.`;
        const agentName = await getAgentName(userId, circleId);
        events.emit('broadcast', { targetUsers: [userId], reply: confirmationReply, from: agentName, circleId, patientUsername });

        return true;
    }
    
    // Lower confidence (< 0.9): Use future planning to ask a follow-up question before escalating
    // Schedule a question for the next turn that hints at escalation intent
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
            confidence: confidence,
            action: 'escalate_after_response'
        }, // trigger_details
        null // trigger_condition
    );
    
    // Respond now with acknowledgment and hint at escalation
    const acknowledgmentReply = `This sounds concerning. ${analysis.reply || "Can you tell me more about what you're experiencing?"} I want to make sure you get the right help.`;
    const agentName = await getAgentName(userId, circleId);
    events.emit('broadcast', { 
        targetUsers: [userId], 
        reply: acknowledgmentReply, 
        from: agentName, 
        circleId, 
        patientUsername 
    });

    return true;
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
