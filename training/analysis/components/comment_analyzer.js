/**
 * @fileoverview Component for analyzing feedback comments
 */

import { makeApiCall } from '../../../agents/api_client.js';
import { generateFeedbackAnalysisPrompt } from '../../../prompts/feedback_analysis_prompt.js';

export class CommentAnalyzer {
    /**
     * Analyze feedback comments for backpropagation
     */
    async analyzeFeedbackComments(promptGroups) {
        const feedbackAnalysis = {};

        // Analyze feedback comments per prompt version
        for (const [version, group] of Object.entries(promptGroups)) {
            const comments = group.interactions
                .filter(f => f.comment || f.feedback_text)
                .map(f => f.comment || f.feedback_text || '');

            if (comments.length === 0) {
                feedbackAnalysis[version] = {
                    total_feedback: 0,
                    themes: [],
                    issues: [],
                    suggestions: []
                };
                continue;
            }

            // Use LLM to analyze comments
            try {
                const analysis = await this._analyzeCommentsWithLLM(comments, version);
                feedbackAnalysis[version] = analysis;
            } catch (error) {
                console.warn(`[CommentAnalyzer] LLM analysis failed for version ${version}, using fallback:`, error.message);
                // Fallback to simple analysis if LLM fails
                feedbackAnalysis[version] = this._analyzeCommentsFallback(comments);
            }
        }

        return feedbackAnalysis;
    }

    /**
     * Use LLM to analyze feedback comments
     */
    async _analyzeCommentsWithLLM(comments, promptVersion) {
        const commentsText = comments.join('\n---\n');

        // Use prompt from prompts package
        const analysisPrompt = generateFeedbackAnalysisPrompt(promptVersion, commentsText);

        try {
            const result = await makeApiCall(
                analysisPrompt,
                [],
                true, // expectJson
                0.3, // temperature
                2000, // maxTokens
                'analysis' // useCase
            );

            // Parse the JSON response
            let analysis;
            if (typeof result === 'object' && result.reply) {
                const jsonText = result.reply;
                try {
                    analysis = JSON.parse(jsonText);
                } catch (parseError) {
                    const jsonMatch = jsonText.match(/```json\s*([\s\S]*?)\s*```/) || jsonText.match(/```\s*([\s\S]*?)\s*```/) || jsonText.match(/\{[\s\S]*\}/);
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

            return {
                total_feedback: comments.length,
                themes: (analysis.themes || []).map(t => ({
                    theme: t.theme || t.name || 'unknown',
                    count: t.count || 1,
                    description: t.description || ''
                })).slice(0, 5),
                issues: (analysis.issues || []).map(i => ({
                    issue: i.issue || i.name || 'unknown',
                    frequency: i.frequency || 1,
                    examples: (i.examples || []).slice(0, 3),
                    severity: i.severity || 'medium'
                })),
                suggestions: [...new Set((analysis.suggestions || []))]
            };
        } catch (error) {
            console.error(`[CommentAnalyzer] Error in LLM analysis for version ${promptVersion}:`, error.message);
            throw error;
        }
    }

    /**
     * Fallback analysis method
     */
    _analyzeCommentsFallback(comments) {
        const themes = {};
        const issues = {};
        const suggestions = [];

        comments.forEach(comment => {
            const lowerComment = comment.toLowerCase();

            if (lowerComment.includes('verbose') || lowerComment.includes('too long')) {
                themes.verbosity = (themes.verbosity || 0) + 1;
                issues.verbosity = issues.verbosity || [];
                issues.verbosity.push(comment);
            }
            if (lowerComment.includes('escalat') || lowerComment.includes('critical')) {
                themes.escalation = (themes.escalation || 0) + 1;
                issues.escalation = issues.escalation || [];
                issues.escalation.push(comment);
            }
            if (lowerComment.includes('empathy') || lowerComment.includes('robust')) {
                themes.empathy = (themes.empathy || 0) + 1;
            }
            if (lowerComment.includes('generic') || lowerComment.includes('bland')) {
                themes.generic = (themes.generic || 0) + 1;
                suggestions.push('Add more specific, actionable guidance');
            }
        });

        return {
            total_feedback: comments.length,
            themes: Object.entries(themes)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([theme, count]) => ({ theme, count })),
            issues: Object.entries(issues).map(([issue, examples]) => ({
                issue,
                frequency: examples.length,
                examples: examples.slice(0, 3)
            })),
            suggestions: [...new Set(suggestions)]
        };
    }

    /**
     * Get specific prompt improvement suggestions
     */
    getPromptSuggestions(pattern) {
        const suggestions = {
            escalation: [
                'Add explicit escalation triggers for critical symptoms',
                'Include temporal urgency assessment',
                'Strengthen emergency response protocols'
            ],
            empathy_loop: [
                'Add variety to empathy expressions',
                'Include action-oriented responses',
                'Limit repetitive caring language'
            ],
            denial_acceptance: [
                'Add persistence for critical situations',
                'Include gentle but firm escalation',
                'Strengthen safety override mechanisms'
            ],
            generic_response: [
                'Add context-specific response templates',
                'Include symptom-specific questions',
                'Improve personalization based on patient history'
            ]
        };

        return suggestions[pattern] || ['Review prompt for clarity and specificity'];
    }
}
