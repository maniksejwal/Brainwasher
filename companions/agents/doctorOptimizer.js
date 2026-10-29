/**
 * @fileoverview Doctor Optimizer Handler
 * Optimizes responses specifically for doctors
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';
import { performCompanionAnalysis } from '../../handlers/message_logic/aiAnalysisHandler.js';
import { getCircleMembers, findUserById, getRecentMessages, getFactHistory, getUserState } from '../../db/index.js';
import { getUnreadEscalationsForCircle } from '../../db/index.js';
import { STAGES_OF_CHANGE, COPING_STYLES } from '../../behavioral_models.js';

/**
 * Process doctor optimization
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context
 * @returns {Promise<object>} Optimized doctor response
 */
export async function processDoctorOptimization(userId, role, message, circleId, context) {
    if (role !== 'doctor') {
        return { reply: null };
    }
    
    // Format conversation history
    const conversationHistory = (context.history || []).slice(-5).map(h => 
        `${h.user_id}: ${h.message}`
    ).join('\n') || 'No recent history';
    
    const prompt = loadPrompt('doctor_optimizer', {
        MESSAGE: message,
        CLINICAL_ASSESSMENT: context.clinicalAssessment?.assessment || 'No immediate concerns',
        CRITICALITY: context.clinicalAssessment?.criticality || 'NONE',
        CONVERSATION_HISTORY: conversationHistory
    });

    try {
        const result = await makeApiCall(prompt, [], true);
        const analysis = parseCompanionResponse(result, 'DoctorOptimizer');
        
        if (!analysis) {
            throw new Error('Failed to parse JSON response');
        }
        
        return {
            reply: analysis.reply || null
        };
    } catch (error) {
        console.error('[DoctorOptimizer] Error:', error.message);
        return { reply: null };
    }
}

/**
 * Query patient/caregiver companions to answer doctor's question
 * @param {string} doctorUserId - Doctor's user ID
 * @param {string} circleId - Care circle ID
 * @param {string} doctorQuestion - Doctor's question
 * @param {array} targetMembers - Array of member objects to query (patient/caregivers)
 * @returns {Promise<object>} Aggregated responses from companions
 */
export async function queryCompanionsForDoctor(doctorUserId, circleId, doctorQuestion, targetMembers) {
    if (!targetMembers || targetMembers.length === 0) {
        return { summary: null, responses: [] };
    }

    const { findCircleById } = await import('../../db/index.js');
    const circle = await findCircleById(circleId);
    const patient = circle ? await findUserById(circle.primary_patient_id) : null;
    const history = await getRecentMessages(circleId, 20);
    const members = await getCircleMembers(circleId);
    const factHistory = await getFactHistory(circleId, 'all', 10);
    const recentEscalations = await getUnreadEscalationsForCircle(circleId);
    
    const behavioralModels = {
        stages_of_change: STAGES_OF_CHANGE,
        coping_styles: COPING_STYLES
    };
    
    const careCircleMembers = members.map(m => m.username).join(', ');
    
    const responses = [];
    
    for (const targetMember of targetMembers) {
        try {
            // Create a query message that the target's companion will analyze
            const queryMessage = `[Doctor's question: "${doctorQuestion}"] Based on the conversation history, what information can you provide about this?`;
            
            // Build context for the target member's companion
            const targetContext = {
                history,
                historyText: history.map(h => `${h.user_id}: ${h.message}`),
                members,
                careCircleMembers,
                currentState: await getUserState(targetMember.user_id, circleId),
                factHistory,
                recentEscalations,
                speaker: { username: targetMember.username, userId: targetMember.user_id },
                patient: patient ? { username: patient.username, userId: patient.user_id } : null,
                hasMedicalContent: true,
                hasCriticalContent: false,
                circleId,
                behavioralModels,
                // Mark this as a query from doctor
                isDoctorQuery: true,
                doctorQuestion: doctorQuestion
            };
            
            // Call the target member's companion analysis
            const analysis = await performCompanionAnalysis(
                targetMember.user_id,
                targetMember.role,
                queryMessage,
                circleId
            );
            
            if (analysis && analysis.reply) {
                responses.push({
                    member: targetMember.username,
                    role: targetMember.role,
                    response: analysis.reply,
                    facts: analysis.facts || {},
                    criticality: analysis.criticality || 'NONE'
                });
            }
        } catch (error) {
            console.error(`[DoctorOptimizer] Error querying companion for ${targetMember.username}:`, error.message);
            // Continue with other members even if one fails
        }
    }
    
    // Aggregate responses into summary
    if (responses.length === 0) {
        return { summary: null, responses: [] };
    }
    
    // Create summary from responses
    const summaryParts = responses.map(r => 
        `${r.member} (${r.role}): ${r.response}`
    );
    const summary = summaryParts.join('\n\n');
    
    return { summary, responses };
}

