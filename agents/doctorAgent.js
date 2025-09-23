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
export async function summarizeReplyForDoctor(topic, response) {
    const prompt = PROMPT_SUMMARIZE_FOR_DOCTOR
        .replace('{{TOPIC}}', topic)
        .replace('{{RESPONSE}}', response);
        
    const result = await makeApiCall(prompt, [], false);
    return result.reply;
}

