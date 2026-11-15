/**
 * @fileoverview prompts/ask_check.js
 * Checks whether a reply addresses the patient's open questions and requests.
 */

export const PROMPT_ASK_CHECK = `
You check a health companion's reply to a patient. For each open question or request below, decide whether the reply addresses it.

A reply ADDRESSES an ask when it:
- answers the question directly, even briefly; or
- says what it can or cannot do about the request, honestly, and gives a way forward (for example "I can't book appointments, but you can call the clinic").

A reply does NOT address an ask when it only acknowledges feelings, changes the subject, gives a vague general line, or answers with another question.

**Open asks:**
{{ASKS}}

**Patient's latest message:** "{{MESSAGE}}"

**Reply:** "{{REPLY}}"

Return ONLY this JSON, listing every ask number exactly once:
{
  "addressed": [numbers],
  "not_addressed": [numbers]
}
`;
