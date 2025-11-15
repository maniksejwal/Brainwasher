/**
 * @fileoverview This module defines agents that perform tasks specifically for the doctor,
 * such as generating summaries or rephrasing clinical directives.
 */

import { makeApiCall } from './api_client.js';
import { PROMPT_DOCTOR_SUMMARY, PROMPT_DELEGATED_PROBE } from '../prompts/doctor_prompts.js';
// FIX: Import the new prompt for summarizing replies.
import { PROMPT_SUMMARIZE_FOR_DOCTOR } from '../prompts/doctor_utility_prompts.js';

export async function generateDoctorSummary(patientUsername, escalations, conversationLog) {
    const escalationText = escalations.length > 0 ? escalations.map(e => `- ${e.type}: ${e.details}`).join('\n') : "None";
    const logText = conversationLog.length > 0 ? conversationLog.map(m => `${m.user_id}: ${m.message}`).join('\n') : "No recent messages.";

    const prompt = PROMPT_DOCTOR_SUMMARY
        .replace('{{PATIENT_USERNAME}}', patientUsername)
        .replace('{{ESCALATIONS}}', escalationText)
        .replace('{{CONVERSATION_LOG}}', logText);
    
    // FIX: This agent does NOT expect a JSON response
    const result = await makeApiCall(prompt, [], false);
    return result.reply;
}

export async function generateDelegatedProbe(targetUser, topic) {
    const prompt = PROMPT_DELEGATED_PROBE
        .replace('{{TARGET_USER}}', targetUser)
        .replace('{{TOPIC}}', topic);
    
    // FIX: This agent does NOT expect a JSON response
    const result = await makeApiCall(prompt, [], false);
    return result.reply;
}

// FIX: Added the missing function to summarize a user's reply for the doctor.
// Now includes conversation history with recency bias
export async function summarizeReplyForDoctor(topic, response, circleId = null, userId = null) {
    let conversationHistory = '';
    let chiefComplaint = '';
    
    // If circleId and userId are provided, fetch conversation history with recency bias
    if (circleId && userId) {
        const { getRecentMessages } = await import('../db/index.js');
        const recentMessages = await getRecentMessages(circleId, 20); // Get last 20 messages
        
        if (recentMessages && recentMessages.length > 0) {
            // Apply recency bias: weight recent messages more heavily
            // Recent messages (last 5) get full weight, older messages get reduced weight
            const weightedMessages = recentMessages.map((msg, index) => {
                const recencyWeight = index < 5 ? 1.0 : Math.max(0.3, 1.0 - (index - 5) * 0.1);
                return { ...msg, weight: recencyWeight };
            });
            
            // Format conversation history with timestamps and recency indicators
            const historyLines = weightedMessages.map((msg, index) => {
                const recency = index < 5 ? '[RECENT]' : index < 10 ? '[RECENT CONTEXT]' : '[HISTORICAL]';
                return `${recency} ${msg.user_id}: ${msg.message}`;
            });
            
            conversationHistory = historyLines.join('\n');
            
            // Extract chief complaint from older messages (messages 10-20, if available)
            if (recentMessages.length > 10) {
                const olderMessages = recentMessages.slice(10, 20);
                const olderContext = olderMessages.map(msg => msg.message).join(' ');
                chiefComplaint = olderContext.length > 200 ? olderContext.substring(0, 200) + '...' : olderContext;
            }
        }
    }
    
    const prompt = PROMPT_SUMMARIZE_FOR_DOCTOR
        .replace('{{TOPIC}}', topic)
        .replace('{{RESPONSE}}', response)
        .replace('{{CONVERSATION_HISTORY}}', conversationHistory || 'No recent conversation history available.')
        .replace('{{CHIEF_COMPLAINT}}', chiefComplaint || 'No historical context available.');
        
    const result = await makeApiCall(prompt, [], false);
    return result.reply;
}

