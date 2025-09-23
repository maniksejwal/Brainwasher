/**
 * @fileoverview prompts/doctor_utility_prompts.js
 * This file contains specialized utility prompts for the doctor's agent, such as
 * summarizing a user's reply to a delegated question.
 */

export const PROMPT_SUMMARIZE_FOR_DOCTOR = `
You are a clinical assistant AI. A doctor previously asked you to inquire about a specific topic. The user has now responded.
Your task is to summarize the user's response concisely for the doctor.

**Original Topic:** "{{TOPIC}}"
**User's Response:** "{{RESPONSE}}"

Generate a brief, one-sentence summary for the doctor.
Example: "Regarding the patient's fall, the caregiver reported that they tripped on a rug."
`;
