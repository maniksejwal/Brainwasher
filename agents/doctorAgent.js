/**
 * @fileoverview This module defines agents that perform tasks specifically for the doctor,
 * such as generating summaries or rephrasing clinical directives.
 */

import { makeApiCall } from './api_client.js';
import { PROMPT_DOCTOR_SUMMARY, PROMPT_DELEGATED_PROBE } from '../prompts/doctor_prompts.js';

export async function generateDoctorSummary(patientUsername, escalations, conversationLog) {
    const escalationText = escalations.length > 0 ? escalations.map(e => `- ${e.type}: ${e.details}`).join('\n') : "None";
    const logText = conversationLog.length > 0 ? conversationLog.map(m => `${m.user_id}: ${m.message}`).join('\n') : "No recent messages.";

    const prompt = PROMPT_DOCTOR_SUMMARY
        .replace('{{PATIENT_USERNAME}}', patientUsername)
        .replace('{{ESCALATIONS}}', escalationText)
        .replace('{{CONVERSATION_LOG}}', logText);
    
    const result = await makeApiCall(prompt);
    return result.reply;
}

export async function generateDelegatedProbe(targetUser, topic) {
    const prompt = PROMPT_DELEGATED_PROBE
        .replace('{{TARGET_USER}}', targetUser)
        .replace('{{TOPIC}}', topic);
    
    const result = await makeApiCall(prompt);
    return result.reply;
}
