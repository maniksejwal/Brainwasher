/**
 * @fileoverview Prompts used by analysis and optimization tools
 * Centralized configuration for AI-powered analysis
 */

export const ANALYSIS_SYSTEM_PROMPT = `You are an expert in analyzing conversational AI systems. Provide actionable insights for improving AI agent responses.`;

export const OPTIMIZATION_SYSTEM_PROMPT = `You are an expert prompt engineer specializing in healthcare AI systems. Your task is to improve system prompts based on performance data and user feedback.`;

export const FEEDBACK_ANALYSIS_TEMPLATE = (stats, negativePatterns, positiveChars) => `
Analyze the following training data for a healthcare AI agent system:

## Overall Statistics
- Total interactions: ${stats.total_interactions}
- With human feedback: ${stats.with_feedback} (${(stats.feedback_rate * 100).toFixed(1)}%)
- Average score: ${stats.average_score.toFixed(2)} / 1.0
- Positive: ${stats.positive_feedback}, Neutral: ${stats.neutral_feedback}, Negative: ${stats.negative_feedback}

## Performance Metrics
- Average latency: ${stats.average_latency.toFixed(0)}ms
- Average response length: ${stats.average_response_length.toFixed(0)} chars
- Average user message length: ${stats.average_message_length.toFixed(0)} chars
- Verbosity ratio: ${stats.verbosity_ratio.toFixed(2)}x
- Escalations: ${stats.escalations} (${(stats.escalations / stats.total_interactions * 100).toFixed(1)}%)

## Problem Patterns (Negative Feedback)
- Verbosity issues: ${negativePatterns.verbosity.length} cases
- Missed escalations: ${negativePatterns.missed_escalations.length} cases
- Privacy concerns: ${negativePatterns.privacy_issues.length} cases
- Tone issues: ${negativePatterns.inappropriate_tone.length} cases

## High-Performing Characteristics (Positive Feedback)
- Average response length: ${positiveChars.average_response_length.toFixed(0)} chars
- Escalation rate: ${(positiveChars.escalation_rate * 100).toFixed(1)}%

Provide a structured analysis including:
1. **Key Issues**: What are the main problems?
2. **Root Causes**: Why are these problems occurring?
3. **Recommendations**: Specific, actionable improvements to the system prompts
4. **Priority**: Rank recommendations by impact

Be specific and actionable. Focus on prompt engineering improvements.
`;

export const PROMPT_OPTIMIZATION_TEMPLATE = (currentPrompt, analysis) => `
# Prompt Optimization Task

You are improving a healthcare AI agent's system prompt based on performance data and user feedback.

## Current System Prompt

\`\`\`
${currentPrompt}
\`\`\`

## Performance Analysis

${typeof analysis === 'string' ? analysis : JSON.stringify(analysis, null, 2)}

## Your Task

Generate an improved version of the system prompt that addresses the identified issues while maintaining the agent's core functionality.

### Key Requirements:

1. **Address Specific Issues**: Fix problems identified in the analysis (verbosity, missed escalations, tone, etc.)
2. **Maintain Core Functionality**: Don't remove essential instructions
3. **Be Specific**: Add concrete, actionable guidelines
4. **Preserve Structure**: Keep the overall prompt organization
5. **Add Safeguards**: Include explicit instructions to prevent identified failures

### Output Format

Provide the improved prompt in a clear, ready-to-use format. Start with "OPTIMIZED PROMPT:" followed by the new prompt text.

Focus on:
- Conciseness instructions if verbosity is an issue
- Escalation criteria if missed escalations are a problem  
- Empathy guidelines if tone is inappropriate
- Privacy reminders if consent issues exist

Generate the optimized prompt now:
`;

export const SCORE_COMMAND_USAGE = `Usage: /score <+1|0|-1> "<optional comment>"
Example: /score +1 "Great response"
Example: /score -1 "Too verbose"`;

export default {
    ANALYSIS_SYSTEM_PROMPT,
    OPTIMIZATION_SYSTEM_PROMPT,
    FEEDBACK_ANALYSIS_TEMPLATE,
    PROMPT_OPTIMIZATION_TEMPLATE,
    SCORE_COMMAND_USAGE
};

