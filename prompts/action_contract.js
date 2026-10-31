/**
 * @fileoverview prompts/action_contract.js
 * Shared block for every user-facing reply prompt: what the system can and
 * cannot do, which actions were taken this turn, and the rules for talking
 * about actions. The {{ACTIONS_TAKEN}} placeholder is filled by the caller.
 */

export const ACTION_CONTRACT = `
**CAPABILITIES (what this system can and cannot do):**
- It CAN flag a message for the doctors in this care circle (they see it in the app) and send in-app alerts to caregivers in this care circle.
- It CANNOT call or contact emergency services, send an ambulance or any person, make phone calls, or know whether anyone has read a message.

**ACTIONS_TAKEN this turn:**
{{ACTIONS_TAKEN}}

**Rules about actions:**
- Only describe actions listed in ACTIONS_TAKEN. If it says "none", do not say or imply that you notified, alerted, contacted, escalated to or told anyone. The system adds its own sentence about any action it took, so you never need to.
- Never say or imply that emergency services, an ambulance, a doctor or any person is coming or on the way.
- If criticality is HIGH, the system opens your reply with an approved emergency sentence (for example, telling the user to call the emergency number). Do not repeat, change or contradict it, and never give phone numbers yourself. Write only the supportive text that follows it.
- You may offer to flag something for the doctor as a question ("Would you like me to flag this for your doctor?").
`;

// A draft reply is written during analysis, before any action runs, so nothing has been done yet.
export const NO_ACTIONS_TAKEN = 'none';

/**
 * Whether an action record holds anything the reply must be written around.
 * @param {object} actions - Action record (see utils/actionClaimGuard.js)
 * @returns {boolean}
 */
export function hasActionsToReport(actions = {}) {
    return Boolean(
        actions.escalationCreated ||
        actions.noDoctorConnected ||
        actions.anonymousConsultation ||
        actions.caregiversAlerted?.length ||
        actions.membersMessaged?.length ||
        actions.failedRecipients?.length
    );
}

/**
 * Render the ACTIONS_TAKEN block for a reply written after the actions ran.
 * @param {object} params
 * @param {object} [params.actions] - Action record for this turn
 * @param {string} [params.question] - Question the system appends to the reply
 * @param {string[]} [params.notes] - Planned follow-ups due this turn (internal notes)
 * @param {Array<{sentence: string}>} [params.violations] - Claims from a previous draft that were not true
 * @returns {string}
 */
export function renderActionsTaken({ actions = {}, question = null, notes = [], violations = [] } = {}) {
    const lines = [];
    if (actions.anonymousConsultation) {
        lines.push('- An anonymous consultation request was logged. No doctor has reviewed it.');
    } else if (actions.escalationCreated && actions.doctors?.length) {
        lines.push(`- This was flagged for these doctors, who will see it in the app: ${actions.doctors.join(', ')}. No one has replied yet.`);
    }
    if (actions.noDoctorConnected) {
        lines.push('- No doctor is connected to this care circle, so this was NOT sent to any doctor.');
    }
    if (actions.caregiversAlerted?.length) {
        lines.push(`- An in-app alert was sent to: ${actions.caregiversAlerted.join(', ')}. No one has replied yet.`);
    }
    if (actions.membersMessaged?.length) {
        lines.push(`- A message was passed on in the app to: ${actions.membersMessaged.join(', ')}.`);
    }
    if (actions.failedRecipients?.length) {
        lines.push(`- This could NOT be sent to: ${actions.failedRecipients.join(', ')}.`);
    }
    if (lines.length === 0) {
        lines.push('- No action was taken this turn.');
    } else {
        lines.push('- The system adds its own sentence stating these actions after your reply. Do not repeat it; you may refer to it briefly, without adding to it.');
    }
    if (question) {
        lines.push(`- The system ends your reply with this question, so do not ask another one: "${question}"`);
    }
    for (const note of notes) {
        lines.push(`- Planned follow-up for this turn (an internal note: work it into your reply in your own words, do not quote it): ${note}`);
    }
    for (const { sentence } of violations) {
        lines.push(`- Your previous draft said: "${sentence}" That is not true. Do not say it or anything like it.`);
    }
    return lines.join('\n');
}
