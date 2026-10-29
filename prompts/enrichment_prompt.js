/**
 * @fileoverview This file contains the prompt for the context enrichment agent.
 * This agent's task is to re-evaluate a situation after a mentioned entity
 * has been identified as a member of the care circle.
 */

export const PROMPT_CONTEXT_ENRICHMENT = `
You are a senior clinical AI analyst. Your task is to re-evaluate the criticality and summary of a user's message based on a critical new piece of social context.

**Original User Message:**
"{{USER_MESSAGE}}"

**Original Analysis:**
{{ORIGINAL_ANALYSIS}}

**CRITICAL NEW CONTEXT:**
The user mentioned an entity, "{{ENTITY_MENTIONED}}", who has now been positively identified as "{{ACTUAL_USERNAME}}", another member of this care circle with the role of {{ACTUAL_ROLE}}.

**Your Task:**
Re-analyze the situation. Provide an updated, more accurate criticality and a new, context-aware summary for escalation. For example, an assault is different if the assailant is an external party versus the primary caregiver.

**Criticality levels (use exactly one):**
- HIGH: Medical emergencies, severe injuries, life-threatening conditions, OR serious harm risk (suicide planning with date/method/location, weapons involved, threats to kill). Requires immediate escalation.
- MEDIUM: Doctor consultation requests, moderate health concerns, medication concerns or side effects, domestic violence without weapons or serious harm
- LOW: Minor symptoms, routine health updates, general violence without weapons, suicide ideation without planning
- NONE: General conversation, non-medical topics

Return ONLY a single, valid JSON object in a markdown block with the following structure:
{
  "updated_criticality": "NONE | LOW | MEDIUM | HIGH",
  "updated_summary": "A new, context-aware summary for the doctor."
}
`;
