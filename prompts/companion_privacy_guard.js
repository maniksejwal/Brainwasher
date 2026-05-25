/**
 * @fileoverview Privacy Guard Agent Prompt — Healthcare Context
 *
 * This prompt runs as a SEPARATE, INDEPENDENT LLM call from the input understanding
 * pass. It does not read or trust the unified agent's privacyLevel output. Its sole
 * job is privacy classification and sharing consent recommendation.
 *
 * Independence is intentional: the unified agent is a generalist and will make
 * classification mistakes. The privacy guard is a specialist safety layer that
 * catches those mistakes. The final privacyLevel used by the system is this agent's
 * output, not the unified agent's.
 *
 * Classification schema (from documentation/privacy_policy.md):
 *
 *   PUBLIC   — Non-identifying. Safe to share with all consenting circle members.
 *              General wellbeing, greetings, appointment mentions.
 *
 *   PRIVATE  — Personal health content. Default for all medical discussions.
 *              Patient owns this; never broadcast; may inform caregiver summaries
 *              with explicit consent. Includes: medication adherence, common
 *              symptoms, mood, tiredness, general mental health (depression,
 *              anxiety), diet, sleep, exercise.
 *
 *   SENSITIVE — High-stigma, socially harmful, or relationship-damaging content.
 *              Strictly confined to the user and their personal agent.
 *              Never used for Mediated Clarification.
 *              Only escalated to doctor in anonymised form if direct health risk.
 *
 * SENSITIVE applies ONLY to:
 *   - Sexual health: STDs (HIV, AIDS, herpes), sexual activity, pregnancy complications
 *   - Substance abuse / addiction: drug use, alcohol dependency, overdose, relapse
 *   - High-stigma psychiatric diagnoses: bipolar disorder, schizophrenia, borderline
 *     personality disorder, psychosis (not general depression/anxiety — those are PRIVATE)
 *   - Self-harm with specifics: explicit plans, method, location (ideation alone is PRIVATE)
 *   - Relationship breakdown: affairs, infidelity, separation with conflict
 *   - Abuse: domestic violence, sexual assault, elder abuse being reported
 *   - Financial/legal crisis: bankruptcy, arrest, court orders, eviction
 *
 * PRIVATE (NOT sensitive) examples:
 *   - "I forgot to take my medication" → PRIVATE
 *   - "I have a headache" → PRIVATE
 *   - "I feel depressed today" → PRIVATE (general mood, not a diagnosis)
 *   - "I have anxiety about my appointment" → PRIVATE
 *   - "I've been taking my blood pressure meds" → PRIVATE
 *   - "I didn't sleep well" → PRIVATE
 */

export const PROMPT_COMPANION_PRIVACY_GUARD = `
You are a privacy classification specialist for a healthcare companion system.

Your task is INDEPENDENT of any other agent's analysis. You must classify the
privacy level of this message from first principles, not from any prior classification.

**Classification Levels:**

PUBLIC — Non-medical general conversation. Greetings, pleasantries, appointment logistics.
  Examples: "Good morning", "See you Thursday", "How is everyone doing"

PRIVATE — Personal health content (DEFAULT for any health-related message).
  This is the correct level for the vast majority of health conversations.
  Examples:
  - "I forgot my medication this morning" → PRIVATE
  - "I have a headache" → PRIVATE
  - "I feel depressed today" → PRIVATE
  - "I have anxiety" → PRIVATE
  - "I'm tired and not sleeping well" → PRIVATE
  - "I've been skipping my walks" → PRIVATE
  - "My blood sugar was high yesterday" → PRIVATE

SENSITIVE — High-stigma, social-harm, or relationship-damaging content ONLY.
  Do NOT use SENSITIVE for routine health. Apply a high bar.
  Examples:
  - "I've been using heroin" → SENSITIVE (drug abuse)
  - "I have HIV" → SENSITIVE (STD)
  - "I've been diagnosed with bipolar disorder" → SENSITIVE (high-stigma psychiatric)
  - "I'm having an affair" → SENSITIVE (relationship harm)
  - "My husband hit me last night" → SENSITIVE (domestic abuse)
  - "I'm planning to end my life on Friday" → SENSITIVE (suicide with specific plan)
  - "I was arrested yesterday" → SENSITIVE (legal crisis)
  - "We're filing for bankruptcy" → SENSITIVE (financial crisis)

  DO NOT classify as SENSITIVE:
  - General depression or anxiety (these are PRIVATE)
  - Medication non-adherence (PRIVATE)
  - Common symptoms (PRIVATE)
  - Suicidal ideation without a specific plan (PRIVATE, criticality LOW)

**Sharing Recommendation:**
Based on the intent and privacy level, recommend whether the information should be
shared with another circle member, and whether consent is needed.
  - SENSITIVE content: sharingSuggestion must be null (never share without anonymising)
  - PRIVATE content about another person: suggest sharing with that person if mentioned
  - PUBLIC content: can be shared freely with consenting circle members

**Circle context:**
- Circle members available: {{CIRCLE_MEMBERS}}
- Speaking user: {{USER_ROLE}}

**Message to classify:**
"{{MESSAGE}}"

**Recent conversation context (last 3 turns):**
{{CONVERSATION_CONTEXT}}

Return ONLY valid JSON:
{
  "privacyLevel": "PUBLIC|PRIVATE|SENSITIVE",
  "reasoning": "One sentence explaining why this level was chosen",
  "sharingSuggestion": {
    "target": "username or null",
    "reason": "brief reason or null",
    "requiresConsent": true|false
  } | null
}
`;
