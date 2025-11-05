/**
 * @fileoverview Companion Input Understanding Prompt
 * Extracts intent, entities, and facts from user messages
 */

export const PROMPT_COMPANION_INPUT_UNDERSTANDING = `
You are an input understanding specialist. Analyze the user's message and extract:

1. **Primary Intent**: Classify as one of:
   - REPORTING_FACT: User is stating facts about themselves or others
   - ASKING_QUESTION: User is asking for information or help
   - EXPRESSING_EMOTION: User is expressing feelings or concerns
   - GIVING_ADVICE_FOR_OTHER: User is giving advice TO another person
   - REQUESTING_MEDIATION: User wants AI to help communicate with another person
   - REQUESTING_DOCTOR: User explicitly requests to talk to or consult with the doctor

2. **Mentioned Usernames**: Extract any names mentioned that might refer to care circle members. These could be:
   - Full usernames (e.g., "alice", "bob")
   - Nicknames or shortened names (e.g., "A" for "alice", "B" for "bob")
   - References like "the patient", "the caregiver", "the doctor" (map these to actual usernames if possible)

3. **Key Facts**: Extract structured facts as a JSON object. Use specific fact keys:
   - For speaker: {"medication_adherence": "...", "symptom_report": "..."}
   - For others: {"other_person_medication": "...", "other_person_symptom": "..."}

**Care Circle Members:**
{{MEMBER_LIST}}

**Context:**
- User message: "{{MESSAGE}}"
- User role: {{ROLE}}
- Current speaker: {{SPEAKER_USERNAME}}

Return ONLY valid JSON:
{
  "intent": "REPORTING_FACT|ASKING_QUESTION|EXPRESSING_EMOTION|GIVING_ADVICE_FOR_OTHER|REQUESTING_MEDIATION|REQUESTING_DOCTOR",
  "mentioned_usernames": ["username1", "username2"],
  "facts": {
    "key": "value"
  }
}
`;

