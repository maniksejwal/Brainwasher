/**
 * @fileoverview handlers/utils/sensitiveContentFilter.js
 * Utilities for detecting and filtering sensitive content, prioritizing less sensitive topics
 * Uses LLM for intelligent detection instead of hardcoded keywords
 */

import { makeApiCall } from '../../agents/api_client.js';

const PROMPT_SENSITIVE_CONTENT_DETECTION = `
You are a privacy and safety specialist. Analyze the following content to detect sensitive topics that require special handling.

**Content to Analyze:**
"{{CONTENT}}"

**Your Task:**
1. Detect if the content contains sensitive topics:
   - Suicide ideation (thoughts of self-harm without specific planning)
   - Suicide planning (specific plans with date, location, method)
   - General violence (fights, conflicts, domestic violence without weapons)
   - Serious violence (weapons, killing, threats to kill, serious harm)
   - Mental health issues (depression, anxiety, therapy - non-emergency)

2. Determine if consent is required:
   - Suicide planning or serious violence: NO consent required (safety override)
   - Suicide ideation, general violence, mental health: FULL consent required
   - Medical/medication topics: No special consent needed

3. Identify medical/medication information that should be prioritized:
   - Medication adherence, dosage, side effects
   - Symptoms, pain, medical concerns
   - Treatment, appointments, medical care

Return ONLY valid JSON:
{
  "isSensitive": true|false,
  "topics": ["suicide_ideation"|"suicide_planning"|"domestic_violence"|"serious_violence"|"mental_health"],
  "requiresConsent": true|false,
  "hasMedicalContent": true|false,
  "medicalTopics": ["medication"|"symptoms"|"treatment"]
}
`;

/**
 * Detect if content contains sensitive topics using LLM
 * @param {string} content - Content to analyze
 * @returns {Promise<object>} { isSensitive: boolean, topics: string[], requiresConsent: boolean }
 */
export async function detectSensitiveTopics(content) {
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return { isSensitive: false, topics: [], requiresConsent: true };
    }

    try {
        const prompt = PROMPT_SENSITIVE_CONTENT_DETECTION.replace('{{CONTENT}}', content);
        const result = await makeApiCall(prompt, [], true, 0.2, 300, 'sensitive_content_detection');
        
        let analysis;
        if (typeof result === 'object' && result.reply) {
            try {
                analysis = JSON.parse(result.reply);
            } catch (parseError) {
                const jsonMatch = result.reply.match(/```json\s*([\s\S]*?)\s*```/) || result.reply.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    analysis = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                } else {
                    throw new Error('Could not parse JSON from LLM response');
                }
            }
        } else if (typeof result === 'object') {
            analysis = result;
        } else {
            throw new Error('Unexpected response format from LLM');
        }

        // Determine requiresConsent based on topics
        let requiresConsent = analysis.requiresConsent !== false;
        if (analysis.topics && analysis.topics.length > 0) {
            // Serious harm overrides consent
            if (analysis.topics.includes('suicide_planning') || analysis.topics.includes('serious_violence')) {
                requiresConsent = false;
            } else {
                requiresConsent = true;
            }
        }

        return {
            isSensitive: analysis.isSensitive || false,
            topics: analysis.topics || [],
            requiresConsent,
            hasMedicalContent: analysis.hasMedicalContent || false,
            medicalTopics: analysis.medicalTopics || []
        };
    } catch (error) {
        console.error('[SensitiveContentFilter] LLM detection failed, using fallback:', error);
        // Fallback: conservative approach - treat as potentially sensitive
        return { isSensitive: true, topics: [], requiresConsent: true };
    }
}

const PROMPT_PRIORITIZE_CONTENT = `
You are a content prioritization specialist. Your task is to extract and prioritize medical/medication information from content that may also contain sensitive topics.

**Content:**
"{{CONTENT}}"

**Your Task:**
1. Identify medical/medication information:
   - Medication adherence, dosage, side effects
   - Symptoms, pain, medical concerns
   - Treatment, appointments, medical care

2. Identify sensitive topics:
   - Domestic violence, fights, family conflicts
   - Mental health issues (unless topic-specific)
   - Suicide ideation (unless planning with specifics)

3. Return prioritized content that:
   - Focuses on medical/medication information
   - Excludes sensitive family dynamics unless they indicate serious harm (weapons, suicide planning with date/method)
   - Maintains coherence and readability

Return ONLY valid JSON:
{
  "prioritizedContent": "Content focusing on medical/medication information, excluding sensitive topics unless serious harm",
  "hasMedicalContent": true|false,
  "hasSensitiveContent": true|false
}
`;

/**
 * Prioritize content - prefer medical/medication topics over sensitive family dynamics using LLM
 * @param {string} content - Full content
 * @returns {Promise<string>} Prioritized content focusing on less sensitive topics
 */
export async function prioritizeContent(content) {
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return content;
    }

    try {
        const prompt = PROMPT_PRIORITIZE_CONTENT.replace('{{CONTENT}}', content);
        const result = await makeApiCall(prompt, [], true, 0.2, 500, 'content_prioritization');
        
        let analysis;
        if (typeof result === 'object' && result.reply) {
            try {
                analysis = JSON.parse(result.reply);
            } catch (parseError) {
                const jsonMatch = result.reply.match(/```json\s*([\s\S]*?)\s*```/) || result.reply.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    analysis = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                } else {
                    throw new Error('Could not parse JSON from LLM response');
                }
            }
        } else if (typeof result === 'object') {
            analysis = result;
        } else {
            throw new Error('Unexpected response format from LLM');
        }

        // If LLM found medical content and filtered sensitive content, use prioritized version
        if (analysis.hasMedicalContent && analysis.prioritizedContent) {
            return analysis.prioritizedContent;
        }
        
        return content;
    } catch (error) {
        console.error('[SensitiveContentFilter] LLM prioritization failed, returning original:', error);
        return content;
    }
}

/**
 * Check if content should be shared based on sensitivity and consent
 * @param {string} content - Content to check
 * @param {string} consentLevel - Consent level: 'FULL', 'LIMITED', 'NONE'
 * @returns {Promise<object>} { canShare: boolean, filteredContent: string, reason: string }
 */
export async function checkSharingPermission(content, consentLevel = 'NONE') {
    const sensitive = await detectSensitiveTopics(content);
    
    // Serious harm overrides consent
    if (sensitive.topics.includes('suicide_planning') || sensitive.topics.includes('serious_violence')) {
        return {
            canShare: true,
            filteredContent: content, // Share full content for serious harm
            reason: 'Serious harm detected - consent override for safety'
        };
    }
    
    // Require FULL consent for sensitive topics
    if (sensitive.isSensitive && sensitive.requiresConsent) {
        if (consentLevel !== 'FULL') {
            // Try to filter out sensitive content and keep only medical/medication info
            const prioritized = await prioritizeContent(content);
            const stillSensitive = await detectSensitiveTopics(prioritized);
            
            if (!stillSensitive.isSensitive) {
                return {
                    canShare: true,
                    filteredContent: prioritized,
                    reason: 'Filtered sensitive content, sharing only medical information'
                };
            }
            
            return {
                canShare: false,
                filteredContent: null,
                reason: `Sensitive topic (${sensitive.topics.join(', ')}) requires FULL consent, current level: ${consentLevel}`
            };
        }
    }
    
    // For non-sensitive or FULL consent, prioritize medical content
    const prioritized = await prioritizeContent(content);
    
    return {
        canShare: true,
        filteredContent: prioritized,
        reason: consentLevel === 'FULL' ? 'Full consent granted' : 'Non-sensitive content'
    };
}

