/**
 * @fileoverview prompts/feedback_analysis_prompt.js
 * Prompt template for analyzing feedback comments using LLM
 * Extracts themes, issues, and suggestions from feedback data
 */

/**
 * Generate feedback analysis prompt for LLM
 * @param {string} promptVersion - The prompt version being analyzed
 * @param {string} commentsText - Concatenated feedback comments text
 * @returns {string} Complete prompt for LLM analysis
 */
export function generateFeedbackAnalysisPrompt(promptVersion, commentsText) {
    return `You are analyzing feedback comments for a healthcare AI agent prompt optimization system.

Analyze the following feedback comments and extract:
1. **Themes**: Recurring topics or patterns (e.g., verbosity, escalation, empathy, generic responses, topic management, misconception handling)
2. **Issues**: Specific problems mentioned with examples
3. **Suggestions**: Actionable recommendations for prompt improvement

Feedback comments for prompt version "${promptVersion}":
${commentsText}

Return ONLY a valid JSON object with this exact structure:
{
  "themes": [
    {"theme": "theme_name", "count": number, "description": "brief description"}
  ],
  "issues": [
    {
      "issue": "issue_name",
      "frequency": number,
      "examples": ["example1", "example2", "example3"],
      "severity": "low|medium|high"
    }
  ],
  "suggestions": [
    "specific actionable suggestion 1",
    "specific actionable suggestion 2"
  ]
}

Focus on themes like:
- verbosity (responses too long, repetitive)
- escalation (escalation handling, critical situations, denial patterns)
- empathy (empathy level, emotional support)
- generic (generic responses, bland, unhelpful)
- topic_management (topic shifting, conversation stuck, repetitive topics)
- misconception_handling (harmful beliefs, dangerous behaviors)
- probing_questions (missing questions, lack of engagement)
- clinical_accuracy (medical accuracy, symptom assessment)

Return only the JSON object, no other text.`;
}

