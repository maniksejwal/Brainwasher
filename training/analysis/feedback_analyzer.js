/**
 * @fileoverview training/feedback_analyzer.js
 * Analyzes training logs and human feedback to identify patterns and issues.
 * Provides insights for prompt optimization.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../../db/connection.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import config from '../../config.js';
import { ANALYSIS_SYSTEM_PROMPT, FEEDBACK_ANALYSIS_TEMPLATE } from '../config/analysis_prompts.js';
import { generateFeedbackAnalysisPrompt } from '../../prompts/feedback_analysis_prompt.js';
import { makeApiCall } from '../../agents/api_client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class FeedbackAnalyzer {
    constructor() {
        // Initialize LLM for analysis
        if (config.CHAT_GPT_KEY) {
            this.openai = new OpenAI({ apiKey: config.CHAT_GPT_KEY });
            this.useOpenAI = true;
        } else if (config.API_KEYS && config.API_KEYS.length > 0) {
            this.genAI = new GoogleGenerativeAI(config.API_KEYS[0]);
            this.useOpenAI = false;
        }
    }

    /**
     * Load training log entries
     */
    async loadTrainingLog(logPath = path.join(__dirname, '../training_log.jsonl')) {
        try {
            const content = await fs.readFile(logPath, 'utf8');
            const lines = content.trim().split('\n').filter(line => line);
            return lines.map(line => JSON.parse(line));
        } catch (error) {
            console.error('[FeedbackAnalyzer] Error loading training log:', error.message);
            return [];
        }
    }

    /**
     * Load human feedback from database
     */
    async loadFeedback() {
        const db = await getDb();

        try {
            const feedback = await db.all(`
                SELECT * FROM feedback 
                ORDER BY timestamp DESC
            `);
            return feedback;
        } catch (error) {
            console.error('[FeedbackAnalyzer] Error loading feedback:', error.message);
            return [];
        }
    }

    /**
     * Merge training logs with feedback
     */
    /**
     * Merge training logs with feedback entries
     * Uses precise matching based on conversation_id + turn number (or message_id)
     * No timestamp proximity needed - we have proper identifiers
     */
    mergeLogsWithFeedback(logs, feedback) {
        // Create feedback map by conversation_id + turn (or message_id for precise matching)
        const feedbackMap = new Map();

        feedback.forEach(f => {
            // Primary key: conversation_id + turn number (most precise)
            // Fallback: conversation_id + message_id
            // Last resort: conversation_id only
            let key;
            if (f.conversation_id && f.message_id !== null && f.message_id !== undefined) {
                // Use message_id if available (most precise)
                key = `${f.conversation_id}_msg_${f.message_id}`;
            } else if (f.conversation_id) {
                // Conversation-only key (less precise, but works)
                key = f.conversation_id;
            } else {
                return; // Skip feedback without conversation_id
            }

            if (!feedbackMap.has(key)) {
                feedbackMap.set(key, []);
            }
            feedbackMap.get(key).push(f);
        });

        return logs.map(log => {
            let matchedFeedback = null;

            // Try to match by conversation_id + turn number (if log has turn)
            if (log.conversation_id && log.turn !== null && log.turn !== undefined) {
                // Look for feedback with matching conversation_id
                // Since feedback doesn't store turn, we match by conversation_id and pick the closest message_id
                // We'll use conversation_id matching and rely on order
                const convFeedback = feedback.filter(f => f.conversation_id === log.conversation_id);
                if (convFeedback.length > 0) {
                    // Sort by message_id (assuming it corresponds to turn order) or timestamp
                    const sorted = convFeedback.sort((a, b) =>
                        (a.message_id || 0) - (b.message_id || 0) ||
                        (a.timestamp || 0) - (b.timestamp || 0)
                    );
                    // Match by position (turn 0 = first feedback, turn 1 = second, etc.)
                    matchedFeedback = sorted[log.turn] || sorted[0];
                }
            } else if (log.conversation_id) {
                // Fallback: conversation_id only (less precise)
                const key = log.conversation_id;
                const feedbacks = feedbackMap.get(key);
                if (feedbacks && feedbacks.length > 0) {
                    // If multiple, prefer one matching user_id
                    matchedFeedback = feedbacks.find(f => f.user_id === log.user_id) || feedbacks[0];
                }
            }

            return {
                ...log,
                feedback: matchedFeedback,
                // Add mapping metadata
                _mapping: {
                    matched: !!matchedFeedback,
                    method: matchedFeedback ?
                        (log.turn !== null && log.turn !== undefined ? 'conversation_id+turn' : 'conversation_id') :
                        'none'
                }
            };
        });
    }

    /**
     * Calculate reward backpropagation for prompt optimization
     * Connects feedback scores with prompt versions to identify optimization opportunities
     */
    async calculateRewardBackpropagation() {
        const db = await getDb();

        try {
            // Get feedback with prompt versions, goal assessments, AND feedback comments for backpropagation
            const feedbackData = await db.all(`
                SELECT 
                    conversation_id,
                    prompt_version,
                    score,
                    goal_adherence_score,
                    goal_history_score,
                    goal_conversation_score,
                    critical_failure,
                    comment,
                    feedback_text,
                    timestamp
                FROM feedback 
                WHERE source = 'simulation' AND prompt_version IS NOT NULL
                ORDER BY timestamp DESC
            `);

            if (feedbackData.length === 0) {
                return {
                    prompt_performance: {},
                    reward_signals: [],
                    optimization_opportunities: []
                };
            }

            // Group by prompt version
            const promptGroups = {};
            feedbackData.forEach(feedback => {
                const version = feedback.prompt_version;
                if (!promptGroups[version]) {
                    promptGroups[version] = {
                        interactions: [],
                        total_score: 0,
                        total_adherence: 0,
                        total_history: 0,
                        total_conversation: 0,
                        critical_failures: 0,
                        count: 0
                    };
                }

                promptGroups[version].interactions.push(feedback);
                promptGroups[version].total_score += feedback.score;
                promptGroups[version].total_adherence += feedback.goal_adherence_score || 0;
                promptGroups[version].total_history += feedback.goal_history_score || 0;
                promptGroups[version].total_conversation += feedback.goal_conversation_score || 0;
                promptGroups[version].critical_failures += feedback.critical_failure ? 1 : 0;
                promptGroups[version].count++;
            });

            // Calculate performance metrics for each prompt
            const promptPerformance = {};
            Object.entries(promptGroups).forEach(([version, data]) => {
                promptPerformance[version] = {
                    avg_score: data.total_score / data.count,
                    avg_adherence: data.total_adherence / data.count,
                    avg_history: data.total_history / data.count,
                    avg_conversation: data.total_conversation / data.count,
                    failure_rate: data.critical_failures / data.count,
                    total_interactions: data.count,
                    reward_signal: this.calculateRewardSignal(data)
                };
            });

            // Generate reward signals for optimization
            const rewardSignals = this.generateRewardSignals(promptPerformance);

            // Identify optimization opportunities (includes both rewards AND feedback comments)
            const optimizationOpportunities = this.identifyOptimizationOpportunities(promptPerformance, feedbackData);

            // BACKPROPAGATION EXTENSION: Include feedback comments in backpropagation
            // Analyze feedback text/comments to identify patterns and issues
            const feedbackAnalysis = await this.analyzeFeedbackComments(feedbackData, promptGroups);

            return {
                prompt_performance: promptPerformance,
                reward_signals: rewardSignals,
                optimization_opportunities: optimizationOpportunities,
                feedback_analysis: feedbackAnalysis, // NEW: Feedback-based backpropagation
                total_feedback_points: feedbackData.length
            };

        } catch (error) {
            console.error('[FeedbackAnalyzer] Error calculating reward backpropagation:', error.message);
            return null;
        }
    }

    /**
     * Calculate reward signal for a prompt version
     */
    calculateRewardSignal(data) {
        // Weighted reward calculation
        const scoreWeight = 0.4;
        const adherenceWeight = 0.3;
        const historyWeight = 0.2;
        const conversationWeight = 0.1;

        const avgScore = data.total_score / data.count;
        const avgAdherence = data.total_adherence / data.count;
        const avgHistory = data.total_history / data.count;
        const avgConversation = data.total_conversation / data.count;
        const failurePenalty = data.critical_failures / data.count;

        const reward = (
            avgScore * scoreWeight +
            avgAdherence * adherenceWeight +
            avgHistory * historyWeight +
            avgConversation * conversationWeight
        ) - (failurePenalty * 0.5); // Penalty for critical failures

        return Math.max(-1, Math.min(1, reward)); // Clamp between -1 and 1
    }

    /**
     * Generate actionable reward signals
     */
    generateRewardSignals(promptPerformance) {
        const signals = [];

        Object.entries(promptPerformance).forEach(([version, performance]) => {
            if (performance.reward_signal < -0.3) {
                signals.push({
                    type: 'negative_reward',
                    prompt_version: version,
                    severity: 'high',
                    message: `Prompt ${version} shows poor performance (reward: ${performance.reward_signal.toFixed(2)})`,
                    recommendations: [
                        'Review prompt for clarity and specificity',
                        'Add more context about care circle goals',
                        'Improve escalation triggers'
                    ]
                });
            } else if (performance.failure_rate > 0.1) {
                signals.push({
                    type: 'high_failure_rate',
                    prompt_version: version,
                    severity: 'medium',
                    message: `Prompt ${version} has high critical failure rate (${(performance.failure_rate * 100).toFixed(1)}%)`,
                    recommendations: [
                        'Strengthen critical symptom detection',
                        'Improve escalation logic',
                        'Add safety checks for denial patterns'
                    ]
                });
            } else if (performance.avg_adherence < 0.6) {
                signals.push({
                    type: 'poor_adherence',
                    prompt_version: version,
                    severity: 'medium',
                    message: `Prompt ${version} struggles with adherence goals (${performance.avg_adherence.toFixed(2)})`,
                    recommendations: [
                        'Focus on medication management language',
                        'Add adherence tracking prompts',
                        'Improve reminder and tracking suggestions'
                    ]
                });
            }
        });

        return signals;
    }

    /**
     * Identify specific optimization opportunities
     */
    identifyOptimizationOpportunities(promptPerformance, feedbackData) {
        const opportunities = [];

        // Find patterns in negative feedback
        const negativeFeedback = feedbackData.filter(f => f.score < 0);
        const failurePatterns = {};
        const contextFailures = {}; // NEW: Context-aware tracking

        negativeFeedback.forEach(feedback => {
            const comment = feedback.comment?.toLowerCase() || '';
            const scenario = feedback.scenario_name || 'unknown';
            const persona = feedback.persona_name || 'unknown';

            // Categorize failure types
            let type = 'general';
            if (comment.includes('escalat')) type = 'escalation';
            else if (comment.includes('empathy') || comment.includes('loop')) type = 'empathy_loop';
            else if (comment.includes('denial') || comment.includes('accept')) type = 'denial_acceptance';
            else if (comment.includes('generic') || comment.includes('bland')) type = 'generic_response';

            // 1. General Pattern Tracking
            failurePatterns[type] = (failurePatterns[type] || 0) + 1;

            // 2. Context-Aware Tracking (Granular)
            if (scenario !== 'unknown' || persona !== 'unknown') {
                const contextKey = `${type}|${scenario}|${persona}`;
                if (!contextFailures[contextKey]) {
                    contextFailures[contextKey] = { count: 0, type, scenario, persona };
                }
                contextFailures[contextKey].count++;
            }
        });

        // Create optimization opportunities based on GENERAL patterns
        Object.entries(failurePatterns).forEach(([pattern, count]) => {
            if (count >= 3) { // Threshold for action
                opportunities.push({
                    pattern: pattern,
                    frequency: count,
                    priority: count >= 5 ? 'high' : 'medium',
                    description: `Frequent ${pattern.replace('_', ' ')} issues detected globally`,
                    suggested_prompt_changes: this.getPromptSuggestions(pattern)
                });
            }
        });

        // Create optimization opportunities based on CONTEXT patterns (Granular)
        Object.values(contextFailures).forEach(cf => {
            if (cf.count >= 2) { // Lower threshold for specific context
                opportunities.push({
                    type: 'context_specific_failure',
                    pattern: cf.type,
                    context: { scenario: cf.scenario, persona: cf.persona },
                    frequency: cf.count,
                    priority: cf.count >= 3 ? 'high' : 'medium',
                    description: `Failure Pattern: ${cf.type} with ${cf.persona} in ${cf.scenario}`,
                    suggested_prompt_changes: this.getPromptSuggestions(cf.type)
                });
            }
        });

        return opportunities;
    }

    /**
     * Analyze feedback comments for backpropagation (NEW: Extends backpropagation to include feedback text)
     * Uses LLM to intelligently extract themes, issues, and suggestions from feedback comments
     * @param {Array} feedbackData - All feedback entries with comments
     * @param {Object} promptGroups - Feedback grouped by prompt version
     * @returns {Promise<Object>} Analysis of feedback comments per prompt version
     */
    async analyzeFeedbackComments(feedbackData, promptGroups) {
        const feedbackAnalysis = {};

        // Analyze feedback comments per prompt version using LLM
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
                console.warn(`[FeedbackAnalyzer] LLM analysis failed for version ${version}, using fallback:`, error.message);
                // Fallback to simple analysis if LLM fails
                feedbackAnalysis[version] = this._analyzeCommentsFallback(comments);
            }
        }

        return feedbackAnalysis;
    }

    /**
     * Use LLM to analyze feedback comments and extract themes, issues, and suggestions
     * @param {Array<string>} comments - Array of feedback comments
     * @param {string} promptVersion - The prompt version being analyzed
     * @returns {Promise<Object>} Structured analysis with themes, issues, and suggestions
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
                0.3, // temperature (lower for more consistent analysis)
                2000, // maxTokens
                'analysis' // useCase
            );

            // Parse the JSON response
            let analysis;
            if (typeof result === 'object' && result.reply) {
                // If wrapped in reply object, extract it
                const jsonText = result.reply;
                try {
                    analysis = JSON.parse(jsonText);
                } catch (parseError) {
                    // Try to extract JSON from markdown code blocks
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

            // Validate and normalize the response structure
            return {
                total_feedback: comments.length,
                themes: (analysis.themes || []).map(t => ({
                    theme: t.theme || t.name || 'unknown',
                    count: t.count || 1,
                    description: t.description || ''
                })).slice(0, 5), // Top 5 themes
                issues: (analysis.issues || []).map(i => ({
                    issue: i.issue || i.name || 'unknown',
                    frequency: i.frequency || 1,
                    examples: (i.examples || []).slice(0, 3), // Max 3 examples
                    severity: i.severity || 'medium'
                })),
                suggestions: [...new Set((analysis.suggestions || []))] // Unique suggestions
            };
        } catch (error) {
            console.error(`[FeedbackAnalyzer] Error in LLM analysis for version ${promptVersion}:`, error.message);
            throw error;
        }
    }

    /**
     * Fallback analysis method if LLM fails
     * @param {Array<string>} comments - Array of feedback comments
     * @returns {Object} Basic analysis using simple pattern matching
     */
    _analyzeCommentsFallback(comments) {
        const themes = {};
        const issues = {};
        const suggestions = [];

        comments.forEach(comment => {
            const lowerComment = comment.toLowerCase();

            // Extract common themes with simple pattern matching
            if (lowerComment.includes('verbose') || lowerComment.includes('too long') || lowerComment.includes('repetitive')) {
                themes.verbosity = (themes.verbosity || 0) + 1;
                issues.verbosity = issues.verbosity || [];
                issues.verbosity.push(comment);
            }
            if (lowerComment.includes('escalat') || lowerComment.includes('critical') || lowerComment.includes('denial')) {
                themes.escalation = (themes.escalation || 0) + 1;
                issues.escalation = issues.escalation || [];
                issues.escalation.push(comment);
            }
            if (lowerComment.includes('empathy') || lowerComment.includes('emotion') || lowerComment.includes('warm')) {
                themes.empathy = (themes.empathy || 0) + 1;
            }
            if (lowerComment.includes('generic') || lowerComment.includes('bland') || lowerComment.includes('unhelpful')) {
                themes.generic = (themes.generic || 0) + 1;
                suggestions.push('Add more specific, actionable guidance');
            }
            if (lowerComment.includes('topic') || lowerComment.includes('shift') || lowerComment.includes('stuck')) {
                themes.topic_management = (themes.topic_management || 0) + 1;
                suggestions.push('Improve topic shifting when conversation becomes repetitive');
            }
            if (lowerComment.includes('misconception') || lowerComment.includes('harmful') || lowerComment.includes('dangerous')) {
                themes.misconception_handling = (themes.misconception_handling || 0) + 1;
                suggestions.push('Strengthen 6-step misconception handling process');
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

    /**
     * Analyze performance for training pipeline
     */
    async analyzePerformance() {
        const db = await getDb();

        try {
            // Get recent feedback data from DB
            const feedbackData = await db.all(`
                SELECT 
                    AVG(score) as averageScore,
                    COUNT(*) as totalFeedback,
                    SUM(CASE WHEN critical_failure = 1 THEN 1 ELSE 0 END) as criticalFailures,
                    AVG(goal_adherence_score) as avgAdherence,
                    AVG(goal_history_score) as avgHistory,
                    AVG(goal_conversation_score) as avgConversation
                FROM feedback 
                WHERE source = 'simulation'
            `);

            const metrics = feedbackData[0] || {};

            // NEW: Parse training_log.jsonl for outcome labels (RLHF rewards)
            const logPath = path.join(__dirname, '../training_log.jsonl');
            let rewardScore = 0;
            let rewardCount = 0;

            try {
                const content = await fs.readFile(logPath, 'utf-8');
                const entries = content.split('\n')
                    .filter(line => line.trim())
                    .map(line => {
                        try {
                            return JSON.parse(line);
                        } catch (e) {
                            return null;
                        }
                    })
                    .filter(entry => entry !== null);

                // Calculate reward-weighted score from last 7 days
                const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000);

                for (const entry of entries) {
                    if (entry.timestamp > cutoffTime && entry.outcome_label) {
                        if (entry.outcome_label === 'positive') {
                            rewardScore += 1.0;
                            rewardCount++;
                        } else if (entry.outcome_label === 'negative') {
                            rewardScore -= 1.0;
                            rewardCount++;
                        }
                    }
                }
            } catch (error) {
                console.log('[FeedbackAnalyzer] Could not read training_log.jsonl for outcome labels:', error.message);
            }

            const avgRewardScore = rewardCount > 0 ? rewardScore / rewardCount : 0;

            // Calculate derived metrics
            const total = metrics.totalFeedback || 0;
            const failureRate = total > 0 ? (metrics.criticalFailures / total) : 0;
            const escalationEffectiveness = 1 - Math.min(failureRate, 1); // Inverse of critical failures
            const conversationQuality = (metrics.avgConversation || 0) / 5; // Normalize to 0-1

            // Combine AI feedback score with RLHF reward score
            const baseFeedbackScore = metrics.averageScore || 0;
            const combinedScore = rewardCount > 0
                ? (baseFeedbackScore + avgRewardScore) / 2
                : baseFeedbackScore;

            console.log(`[FeedbackAnalyzer] Performance Analysis:`);
            console.log(`  AI Feedback Score: ${baseFeedbackScore.toFixed(2)}`);
            console.log(`  RLHF Reward Score: ${avgRewardScore.toFixed(2)} (${rewardCount} samples)`);
            console.log(`  Combined Score: ${combinedScore.toFixed(2)}`);

            return {
                averageScore: combinedScore, // Use combined score
                baseFeedbackScore: baseFeedbackScore, // Keep original for reference
                rewardScore: avgRewardScore, // NEW: RLHF reward score
                rewardCount: rewardCount, // NEW: Number of reward samples
                escalationEffectiveness: escalationEffectiveness,
                conversationQuality: conversationQuality,
                adherenceScore: metrics.avgAdherence || 0,
                historyScore: metrics.avgHistory || 0,
                totalFeedback: total,
                criticalFailures: metrics.criticalFailures || 0
            };
        } catch (error) {
            console.error('[FeedbackAnalyzer] Error analyzing performance:', error.message);
            return {
                averageScore: 0,
                baseFeedbackScore: 0,
                rewardScore: 0,
                rewardCount: 0,
                escalationEffectiveness: 0,
                conversationQuality: 0,
                adherenceScore: 0,
                historyScore: 0,
                totalFeedback: 0,
                criticalFailures: 0
            };
        }
    }

    /**
     * Compare Companion vs Unified system performance
     * Uses training_log.jsonl to analyze system_used field
     */
    async compareCompanionVsUnified() {
        try {
            const logPath = path.join(__dirname, '../training_log.jsonl');
            const logs = await this.loadTrainingLog(logPath);

            // Separate logs by system_used
            const companionLogs = logs.filter(log => log.system_used === 'companion');
            const unifiedLogs = logs.filter(log => log.system_used === 'unified');

            // Calculate metrics for each system
            const companionMetrics = this.calculateSystemMetrics(companionLogs);
            const unifiedMetrics = this.calculateSystemMetrics(unifiedLogs);

            // Compare performance
            const comparison = {
                companion: companionMetrics,
                unified: unifiedMetrics,
                comparison: {
                    avgScoreDifference: companionMetrics.avgScore - unifiedMetrics.avgScore,
                    avgLatencyDifference: companionMetrics.avgLatency - unifiedMetrics.avgLatency,
                    avgResponseLengthDifference: companionMetrics.avgResponseLength - unifiedMetrics.avgResponseLength,
                    escalationRateDifference: companionMetrics.escalationRate - unifiedMetrics.escalationRate,
                    betterSystem: companionMetrics.avgScore > unifiedMetrics.avgScore ? 'companion' : 'unified',
                    recommendation: this.generateRecommendation(companionMetrics, unifiedMetrics)
                }
            };

            return comparison;
        } catch (error) {
            console.error('[FeedbackAnalyzer] Error comparing systems:', error.message);
            return null;
        }
    }

    /**
     * Calculate metrics for a system based on training logs
     */
    calculateSystemMetrics(logs) {
        if (logs.length === 0) {
            return {
                totalInteractions: 0,
                avgScore: 0,
                avgLatency: 0,
                avgResponseLength: 0,
                avgMessageLength: 0,
                escalationRate: 0,
                shareRate: 0
            };
        }

        const withFeedback = logs.filter(log => log.human_score !== undefined);
        const totalScore = withFeedback.reduce((sum, log) => sum + (log.human_score || 0), 0);
        const totalLatency = logs.reduce((sum, log) => sum + (log.latency_ms || 0), 0);
        const totalResponseLength = logs.reduce((sum, log) => sum + (log.response_length || 0), 0);
        const totalMessageLength = logs.reduce((sum, log) => sum + (log.message_length || 0), 0);
        const escalatedCount = logs.filter(log => log.escalated === true).length;
        const sharedCount = logs.filter(log => log.shared === true).length;

        return {
            totalInteractions: logs.length,
            avgScore: withFeedback.length > 0 ? totalScore / withFeedback.length : 0,
            avgLatency: logs.length > 0 ? totalLatency / logs.length : 0,
            avgResponseLength: logs.length > 0 ? totalResponseLength / logs.length : 0,
            avgMessageLength: logs.length > 0 ? totalMessageLength / logs.length : 0,
            escalationRate: logs.length > 0 ? escalatedCount / logs.length : 0,
            shareRate: logs.length > 0 ? sharedCount / logs.length : 0
        };
    }

    /**
     * Generate recommendation based on comparison
     */
    generateRecommendation(companionMetrics, unifiedMetrics) {
        const companionScore = companionMetrics.avgScore;
        const unifiedScore = unifiedMetrics.avgScore;

        if (Math.abs(companionScore - unifiedScore) < 0.1) {
            return 'Both systems perform similarly. Consider A/B testing with more data.';
        }

        if (companionScore > unifiedScore) {
            return `Companion system outperforms unified by ${((companionScore - unifiedScore) * 100).toFixed(1)}% average score. Consider promoting Companion to production.`;
        } else {
            return `Unified system outperforms Companion by ${((unifiedScore - companionScore) * 100).toFixed(1)}% average score. Continue optimizing Companion or maintain Unified as primary.`;
        }
    }

    /**
     * Calculate basic statistics
     */
    calculateStats(mergedData) {
        const withFeedback = mergedData.filter(d => d.feedback);

        const stats = {
            total_interactions: mergedData.length,
            with_feedback: withFeedback.length,
            feedback_rate: withFeedback.length / mergedData.length,

            // Scores
            positive_feedback: withFeedback.filter(d => d.feedback.score === 1).length,
            neutral_feedback: withFeedback.filter(d => d.feedback.score === 0).length,
            negative_feedback: withFeedback.filter(d => d.feedback.score === -1).length,
            average_score: withFeedback.reduce((sum, d) => sum + d.feedback.score, 0) / withFeedback.length || 0,

            // Response metrics
            average_latency: mergedData.length > 0 ? mergedData.reduce((sum, d) => sum + (d.latency_ms || 0), 0) / mergedData.length : 0,
            average_response_length: mergedData.length > 0 ? mergedData.reduce((sum, d) => sum + (d.response_length || 0), 0) / mergedData.length : 0,
            average_message_length: mergedData.length > 0 ? mergedData.reduce((sum, d) => sum + (d.message_length || 0), 0) / mergedData.length : 0,

            // Actions
            escalations: mergedData.filter(d => d.escalated).length,
            shares: mergedData.filter(d => d.shared).length
        };

        stats.verbosity_ratio = stats.average_message_length > 0 ? stats.average_response_length / stats.average_message_length : 0;

        return stats;
    }

    /**
     * Identify common patterns in negative feedback
     */
    analyzeNegativeFeedback(mergedData) {
        const negative = mergedData.filter(d => d.feedback && d.feedback.score === -1);

        const patterns = {
            verbosity: [],
            missed_escalations: [],
            privacy_issues: [],
            inappropriate_tone: [],
            other: []
        };

        for (const item of negative) {
            const comment = (item.feedback.comment || '').toLowerCase();
            const responseLength = item.response_length || 0;
            const messageLength = item.message_length || 1;

            // Detect verbosity issues
            if (comment.includes('verbose') || comment.includes('too long') || comment.includes('wordy') ||
                responseLength / messageLength > 4) {
                patterns.verbosity.push(item);
            }
            // Detect missed escalations
            else if (comment.includes('escalat') || comment.includes('doctor') || comment.includes('should have')) {
                patterns.missed_escalations.push(item);
            }
            // Detect privacy issues
            else if (comment.includes('privacy') || comment.includes('share') || comment.includes('consent')) {
                patterns.privacy_issues.push(item);
            }
            // Detect tone issues
            else if (comment.includes('tone') || comment.includes('empathy') || comment.includes('rude')) {
                patterns.inappropriate_tone.push(item);
            }
            // Other
            else {
                patterns.other.push(item);
            }
        }

        return patterns;
    }

    /**
     * Analyze high-performing interactions
     */
    analyzePositiveFeedback(mergedData) {
        const positive = mergedData.filter(d => d.feedback && d.feedback.score === 1);

        const characteristics = {
            average_response_length: positive.length > 0 ? positive.reduce((sum, d) => sum + (d.response_length || 0), 0) / positive.length : 0,
            average_latency: positive.length > 0 ? positive.reduce((sum, d) => sum + (d.latency_ms || 0), 0) / positive.length : 0,
            escalation_rate: positive.length > 0 ? positive.filter(d => d.escalated).length / positive.length : 0,
            share_rate: positive.length > 0 ? positive.filter(d => d.shared).length / positive.length : 0,
            sample_interactions: positive.slice(0, 5)
        };

        return characteristics;
    }

    /**
     * Generate AI-powered analysis report
     */
    async generateAIAnalysis(mergedData, stats, negativePatterns, positiveChars) {
        const prompt = FEEDBACK_ANALYSIS_TEMPLATE(stats, negativePatterns, positiveChars);

        try {
            let analysis;

            if (this.useOpenAI) {
                const response = await this.openai.chat.completions.create({
                    model: 'gpt-4',
                    messages: [
                        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.3
                });
                analysis = response.choices[0].message.content;
            } else {
                const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const result = await model.generateContent(prompt);
                analysis = result.response.text();
            }

            return analysis;
        } catch (error) {
            console.error('[FeedbackAnalyzer] Error generating AI analysis:', error.message);
            return 'AI analysis unavailable';
        }
    }

    /**
     * Generate comprehensive analysis report
     */
    async generateReport(outputPath = path.join(__dirname, '../analysis_report.md')) {
        console.log('[FeedbackAnalyzer] Generating analysis report...\n');

        const logs = await this.loadTrainingLog();
        const feedback = await this.loadFeedback();
        const mergedData = this.mergeLogsWithFeedback(logs, feedback);

        console.log(`Loaded ${logs.length} training interactions`);
        console.log(`Found ${feedback.length} human feedback entries\n`);

        if (mergedData.length === 0) {
            console.log('No data available for analysis.');
            return;
        }

        // Calculate statistics
        const stats = this.calculateStats(mergedData);
        const negativePatterns = this.analyzeNegativeFeedback(mergedData);
        const positiveChars = this.analyzePositiveFeedback(mergedData);

        // Generate AI analysis
        console.log('Generating AI-powered analysis...');
        const aiAnalysis = await this.generateAIAnalysis(mergedData, stats, negativePatterns, positiveChars);

        // Compare Companion vs Unified systems (if data available)
        let systemComparison = null;
        try {
            systemComparison = await this.compareCompanionVsUnified();
        } catch (error) {
            console.warn('[FeedbackAnalyzer] Could not generate system comparison:', error.message);
        }

        // Build report
        const report = this._buildReport(stats, negativePatterns, positiveChars, aiAnalysis, systemComparison);

        // Save report
        await fs.writeFile(outputPath, report, 'utf8');
        console.log(`\n✓ Report saved to: ${outputPath}\n`);

        return { stats, negativePatterns, positiveChars, aiAnalysis };
    }

    /**
     * Build markdown report
     */
    _buildReport(stats, negativePatterns, positiveChars, aiAnalysis, systemComparison = null) {
        const timestamp = new Date().toISOString();

        return `# Training Data Analysis Report

Generated: ${timestamp}

---

## Executive Summary

- **Total Interactions**: ${stats.total_interactions}
- **Human Feedback Coverage**: ${(stats.feedback_rate * 100).toFixed(1)}%
- **Average Quality Score**: ${stats.average_score.toFixed(2)} / 1.0
- **Performance Rating**: ${this._getRating(stats.average_score)}

---

## Detailed Statistics

### Feedback Distribution
- ✅ Positive (+1): ${stats.positive_feedback} (${stats.with_feedback > 0 ? (stats.positive_feedback / stats.with_feedback * 100).toFixed(1) : '0'}%)
- 🤷 Neutral (0): ${stats.neutral_feedback} (${stats.with_feedback > 0 ? (stats.neutral_feedback / stats.with_feedback * 100).toFixed(1) : '0'}%)
- ❌ Negative (-1): ${stats.negative_feedback} (${stats.with_feedback > 0 ? (stats.negative_feedback / stats.with_feedback * 100).toFixed(1) : '0'}%)

### Response Metrics
- Average Latency: ${stats.average_latency.toFixed(0)}ms
- Average Response Length: ${stats.average_response_length.toFixed(0)} characters
- Average User Message Length: ${stats.average_message_length.toFixed(0)} characters
- Verbosity Ratio: ${stats.verbosity_ratio.toFixed(2)}x

### Agent Actions
- Escalations: ${stats.escalations} (${stats.total_interactions > 0 ? (stats.escalations / stats.total_interactions * 100).toFixed(1) : '0'}%)
- Information Shares: ${stats.shares} (${stats.total_interactions > 0 ? (stats.shares / stats.total_interactions * 100).toFixed(1) : '0'}%)

---

## Problem Patterns Analysis

### Verbosity Issues (${negativePatterns.verbosity.length} cases)
${negativePatterns.verbosity.length > 0 ? 'Users consistently report responses are too long. This suggests the agent is over-explaining.' : 'No significant verbosity issues detected.'}

### Missed Escalations (${negativePatterns.missed_escalations.length} cases)
${negativePatterns.missed_escalations.length > 0 ? 'Critical symptoms are not being escalated quickly enough to doctors.' : 'Escalation timing appears appropriate.'}

### Privacy Concerns (${negativePatterns.privacy_issues.length} cases)
${negativePatterns.privacy_issues.length > 0 ? 'Users report privacy violations or inappropriate sharing requests.' : 'Privacy handling appears appropriate.'}

### Tone Issues (${negativePatterns.inappropriate_tone.length} cases)
${negativePatterns.inappropriate_tone.length > 0 ? 'Users find the agent tone inappropriate or lacking empathy.' : 'Tone appears appropriate.'}

---

## High-Performing Interactions

### Characteristics of Positive Feedback
- Average Response Length: ${positiveChars.average_response_length.toFixed(0)} chars (${stats.verbosity_ratio > 2 ? 'significantly shorter than overall average' : 'similar to overall average'})
- Escalation Rate: ${(positiveChars.escalation_rate * 100).toFixed(1)}%
- Share Rate: ${(positiveChars.share_rate * 100).toFixed(1)}%

**Key Finding**: ${positiveChars.average_response_length < stats.average_response_length ? 'Shorter responses receive better feedback' : 'Response length is not a primary factor in quality'}

---

## AI-Powered Analysis

${aiAnalysis}

---

${systemComparison ? `## Companion vs Unified System Comparison

${this._formatSystemComparison(systemComparison)}

---` : ''}

## Recommendations Priority

${this._generatePriorityRecommendations(stats, negativePatterns)}

---

*This report is automatically generated by the Feedback Analyzer*
`;
    }

    /**
     * Format system comparison for report
     */
    _formatSystemComparison(comparison) {
        if (!comparison || !comparison.comparison) {
            return 'Insufficient data for system comparison.';
        }

        const comp = comparison.comparison;
        const companion = comparison.companion;
        const unified = comparison.unified;

        return `
### Performance Metrics

| Metric | Companion | Unified | Difference |
|--------|-----------|--------|------------|
| Average Score | ${companion.avgScore?.toFixed(2) || 'N/A'} | ${unified.avgScore?.toFixed(2) || 'N/A'} | ${comp.avgScoreDifference > 0 ? '+' : ''}${comp.avgScoreDifference?.toFixed(2) || 'N/A'} |
| Average Latency | ${companion.avgLatency?.toFixed(0) || 'N/A'}ms | ${unified.avgLatency?.toFixed(0) || 'N/A'}ms | ${comp.avgLatencyDifference > 0 ? '+' : ''}${comp.avgLatencyDifference?.toFixed(0) || 'N/A'}ms |
| Response Length | ${companion.avgResponseLength?.toFixed(0) || 'N/A'} | ${unified.avgResponseLength?.toFixed(0) || 'N/A'} | ${comp.avgResponseLengthDifference > 0 ? '+' : ''}${comp.avgResponseLengthDifference?.toFixed(0) || 'N/A'} |
| Escalation Rate | ${(companion.escalationRate * 100)?.toFixed(1) || 'N/A'}% | ${(unified.escalationRate * 100)?.toFixed(1) || 'N/A'}% | ${comp.escalationRateDifference > 0 ? '+' : ''}${(comp.escalationRateDifference * 100)?.toFixed(1) || 'N/A'}% |

### Recommendation

**Better System**: ${comp.betterSystem === 'companion' ? '🟢 Companion' : comp.betterSystem === 'unified' ? '🔵 Unified' : '🤝 Tie'}

${comp.recommendation || 'Continue monitoring both systems.'}
`;
    }

    /**
     * Get quality rating
     */
    _getRating(score) {
        if (score >= 0.7) return '🟢 Excellent';
        if (score >= 0.4) return '🟡 Good';
        if (score >= 0.0) return '🟠 Needs Improvement';
        return '🔴 Critical Issues';
    }

    /**
     * Generate priority recommendations
     */
    _generatePriorityRecommendations(stats, patterns) {
        const recommendations = [];

        // Priority 1: Critical issues
        if (patterns.missed_escalations.length > 2) {
            recommendations.push('🔴 **P1 - Critical**: Improve escalation detection. Add explicit symptom severity guidelines to prompts.');
        }
        if (patterns.privacy_issues.length > 0) {
            recommendations.push('🔴 **P1 - Critical**: Strengthen privacy controls. Review consent checking logic.');
        }

        // Priority 2: Quality issues
        if (stats.verbosity_ratio > 3) {
            recommendations.push('🟠 **P2 - High**: Reduce verbosity. Add instruction: "Be concise (1-2 sentences unless detail requested)"');
        }
        if (patterns.inappropriate_tone.length > 1) {
            recommendations.push('🟠 **P2 - High**: Improve empathy calibration in prompts.');
        }

        // Priority 3: Optimization
        if (stats.average_latency > 2000) {
            recommendations.push('🟡 **P3 - Medium**: Optimize response latency.');
        }

        if (recommendations.length === 0) {
            recommendations.push('✅ No critical issues detected. Focus on continuous incremental improvements.');
        }

        return recommendations.join('\n');
    }
}

/**
 * CLI interface
 */
async function main() {
    const analyzer = new FeedbackAnalyzer();
    await analyzer.generateReport();
}

// Run if called directly
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` ||
    process.argv[1]?.includes('feedback_analyzer')) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

export { FeedbackAnalyzer };

