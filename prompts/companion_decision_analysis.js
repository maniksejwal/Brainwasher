/**
 * @fileoverview Companion Decision Analysis Prompts
 * Structured prompts for different companion types to analyze decisions
 */

/**
 * Companion profiles with expertise areas and focus points
 */
export const COMPANION_PROFILES = {
    medical_companion: {
        role: 'Medical and Health Companion',
        expertise: 'health outcomes, medical safety, wellbeing optimization, stress factors',
        priorities: ['patient safety', 'health optimization', 'medical evidence', 'long-term wellbeing'],
        concerns: ['health risks', 'medical complications', 'stress impact', 'treatment adherence']
    },
    professional_companion: {
        role: 'Professional and Career Companion', 
        expertise: 'career advancement, business strategy, professional relationships, work-life balance',
        priorities: ['career growth', 'business outcomes', 'professional reputation', 'strategic positioning'],
        concerns: ['career risks', 'business impact', 'relationship damage', 'opportunity costs']
    },
    social_companion: {
        role: 'Social and Relationship Companion',
        expertise: 'interpersonal dynamics, community impact, social wellbeing, relationship health',
        priorities: ['relationship quality', 'social harmony', 'community benefit', 'personal fulfillment'],
        concerns: ['relationship strain', 'social isolation', 'community disruption', 'emotional impact']
    }
};

/**
 * Template for companion decision analysis prompt
 */
export const COMPANION_DECISION_ANALYSIS_PROMPT = `You are a {{COMPANION_ROLE}} AI with expertise in {{COMPANION_EXPERTISE}}.

**DECISION ANALYSIS REQUEST:**
Decision Context: "{{DECISION_CONTEXT}}"

**YOUR ROLE AND PERSPECTIVE:**
- Role: {{COMPANION_ROLE}}
- Key Priorities: {{COMPANION_PRIORITIES}}
- Main Concerns: {{COMPANION_CONCERNS}}

**ANALYSIS REQUIREMENTS:**
Provide a comprehensive analysis from your specialized perspective that includes:

1. **Impact Assessment**: How does this decision affect your domain of expertise?
2. **Risk Analysis**: What are the potential negative consequences in your area?
3. **Benefit Analysis**: What are the potential positive outcomes in your area? 
4. **Recommendation**: Do you support, have concerns about, or oppose this decision?
5. **Confidence Level**: How confident are you in your assessment (0.0-1.0)?
6. **Alternative Considerations**: Are there alternative approaches to consider?

**RESPONSE FORMAT:**
Provide a detailed analysis covering all six points above. Be specific about your reasoning and cite relevant factors from your domain of expertise.

**IMPORTANT GUIDELINES:**
- Focus specifically on your domain ({{COMPANION_TYPE_READABLE}})
- Be thorough but concise
- Provide actionable insights
- Consider both short-term and long-term implications
- Base your analysis on evidence and best practices in your field

Begin your analysis:`;

/**
 * Consensus analysis prompt for LLM
 */
export const COMPANION_CONSENSUS_ANALYSIS_PROMPT = `You are an expert decision coordinator analyzing multiple companion AI perspectives to determine consensus.

**DECISION CONTEXT:** {{DECISION_CONTEXT}}

**COMPANION PERSPECTIVES:**
{{COMPANION_SUMMARIES}}

**ANALYSIS TASK:**
Analyze these companion perspectives and determine:
1. Whether they reach consensus (agreement threshold: 70%)
2. The overall recommendation
3. Confidence level (0.0-1.0)
4. Detailed reasoning
5. Support vs concern breakdown
6. Any conflicts or nuances to highlight

**RETURN ONLY VALID JSON:**
{
  "reached": boolean,
  "recommendation": "detailed recommendation text",
  "confidence": number_between_0_and_1,
  "reason": "detailed analysis of agreement/disagreement",
  "supportCount": number_of_supporting_companions,
  "concernCount": number_of_concerned_companions,
  "nuances": "important nuances or conflicts to note",
  "unanimous": boolean,
  "majorityPosition": "support|concern|neutral",
  "conflictingAreas": ["list", "of", "conflicting", "topics"]
}`;

/**
 * Fallback responses for when AI is unavailable
 */
export const COMPANION_FALLBACK_ANALYSES = {
    medical_companion: `**MEDICAL PERSPECTIVE:**

**Impact Assessment:** This decision requires evaluation from a health and wellbeing perspective regarding: {{DECISION_CONTEXT}}

**Risk Analysis:** Key health concerns include potential stress factors, impact on medical treatment adherence, sleep patterns, and overall physical wellbeing. Without detailed analysis, recommend monitoring for signs of health impact.

**Benefit Analysis:** Potential health benefits may include reduced stress, improved lifestyle balance, or enhanced treatment compliance, depending on the nature of the decision.

**Recommendation:** Recommend careful consideration of health implications and consultation with healthcare providers if the decision impacts medical treatment, stress levels, or overall wellbeing.

**Confidence Level:** 0.3 (Limited analysis without full medical context)

**Alternative Considerations:** Consider timing relative to medical appointments, impact on medication schedules, and alignment with current health goals.`,

    professional_companion: `**PROFESSIONAL PERSPECTIVE:**

**Impact Assessment:** This decision requires evaluation from a career and business perspective regarding: {{DECISION_CONTEXT}}

**Risk Analysis:** Key professional concerns include potential impact on career trajectory, professional relationships, business outcomes, and work-life balance. Consider reputation management and opportunity costs.

**Benefit Analysis:** Potential professional benefits may include career advancement opportunities, skill development, network expansion, or improved work-life integration.

**Recommendation:** Recommend thorough analysis of career implications, stakeholder impact, and alignment with professional goals before proceeding.

**Confidence Level:** 0.3 (Limited analysis without full professional context)

**Alternative Considerations:** Consider timing relative to performance reviews, project deadlines, and strategic career planning objectives.`,

    social_companion: `**SOCIAL PERSPECTIVE:**

**Impact Assessment:** This decision requires evaluation from a social and relationship perspective regarding: {{DECISION_CONTEXT}}

**Risk Analysis:** Key social concerns include potential impact on relationships, community connections, social dynamics, and personal fulfillment. Consider effects on family, friends, and social commitments.

**Benefit Analysis:** Potential social benefits may include strengthened relationships, community involvement, personal growth, or enhanced social wellbeing.

**Recommendation:** Recommend considering the social implications and discussing with key relationships who may be affected by this decision.

**Confidence Level:** 0.3 (Limited analysis without full social context)

**Alternative Considerations:** Consider timing relative to social commitments, impact on family dynamics, and alignment with personal relationship goals.`
};

/**
 * Generate companion decision analysis prompt
 * @param {string} companionType - Type of companion (medical_companion, etc.)
 * @param {string} decisionContext - The decision context to analyze
 * @returns {string} Formatted prompt
 */
export function generateCompanionDecisionPrompt(companionType, decisionContext) {
    const profile = COMPANION_PROFILES[companionType];
    if (!profile) {
        return `As a ${companionType.replace('_', ' ')}, analyze this decision: "${decisionContext}"`;
    }

    return COMPANION_DECISION_ANALYSIS_PROMPT
        .replace('{{COMPANION_ROLE}}', profile.role)
        .replace('{{COMPANION_EXPERTISE}}', profile.expertise)
        .replace('{{DECISION_CONTEXT}}', decisionContext)
        .replace('{{COMPANION_ROLE}}', profile.role) // Second occurrence
        .replace('{{COMPANION_PRIORITIES}}', profile.priorities.join(', '))
        .replace('{{COMPANION_CONCERNS}}', profile.concerns.join(', '))
        .replace('{{COMPANION_TYPE_READABLE}}', companionType.replace('_', ' '));
}

/**
 * Generate consensus analysis prompt
 * @param {string} decisionContext - The decision context
 * @param {string} companionSummaries - Formatted companion summaries
 * @returns {string} Formatted consensus prompt
 */
export function generateConsensusAnalysisPrompt(decisionContext, companionSummaries) {
    return COMPANION_CONSENSUS_ANALYSIS_PROMPT
        .replace('{{DECISION_CONTEXT}}', decisionContext)
        .replace('{{COMPANION_SUMMARIES}}', companionSummaries);
}

/**
 * Get fallback analysis for a companion type
 * @param {string} companionType - Type of companion
 * @param {string} decisionContext - The decision context
 * @returns {string} Fallback analysis text
 */
export function getFallbackCompanionAnalysis(companionType, decisionContext) {
    const fallback = COMPANION_FALLBACK_ANALYSES[companionType];
    if (fallback) {
        return fallback.replace('{{DECISION_CONTEXT}}', decisionContext);
    }

    return `**${companionType.replace('_', ' ').toUpperCase()} PERSPECTIVE:**

**Impact Assessment:** Decision analysis not available for companion type "${companionType}" regarding: ${decisionContext}

**Recommendation:** Unable to provide specialized analysis - recommend consulting appropriate domain experts.

**Confidence Level:** 0.1 (No specialized analysis available)

This is a fallback response due to system limitations.`;
}