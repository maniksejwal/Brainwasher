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
    mergeLogsWithFeedback(logs, feedback) {
        const feedbackMap = new Map();
        feedback.forEach(f => {
            feedbackMap.set(f.conversation_id, f);
        });

        return logs.map(log => ({
            ...log,
            feedback: feedbackMap.get(log.conversation_id) || null
        }));
    }

    /**
     * Calculate reward backpropagation for prompt optimization
     * Connects feedback scores with prompt versions to identify optimization opportunities
     */
    async calculateRewardBackpropagation() {
        const db = await getDb();
        
        try {
            // Get feedback with prompt versions and goal assessments
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
            
            // Identify optimization opportunities
            const optimizationOpportunities = this.identifyOptimizationOpportunities(promptPerformance, feedbackData);
            
            return {
                prompt_performance: promptPerformance,
                reward_signals: rewardSignals,
                optimization_opportunities: optimizationOpportunities,
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
        
        negativeFeedback.forEach(feedback => {
            const comment = feedback.comment?.toLowerCase() || '';
            
            // Categorize failure types
            if (comment.includes('escalat')) {
                failurePatterns.escalation = (failurePatterns.escalation || 0) + 1;
            }
            if (comment.includes('empathy') || comment.includes('loop')) {
                failurePatterns.empathy_loop = (failurePatterns.empathy_loop || 0) + 1;
            }
            if (comment.includes('denial') || comment.includes('accept')) {
                failurePatterns.denial_acceptance = (failurePatterns.denial_acceptance || 0) + 1;
            }
            if (comment.includes('generic') || comment.includes('bland')) {
                failurePatterns.generic_response = (failurePatterns.generic_response || 0) + 1;
            }
        });
        
        // Create optimization opportunities based on patterns
        Object.entries(failurePatterns).forEach(([pattern, count]) => {
            if (count >= 3) { // Threshold for actionable optimization
                opportunities.push({
                    pattern: pattern,
                    frequency: count,
                    priority: count >= 5 ? 'high' : 'medium',
                    description: `Frequent ${pattern.replace('_', ' ')} issues detected`,
                    suggested_prompt_changes: this.getPromptSuggestions(pattern)
                });
            }
        });
        
        return opportunities;
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
            average_latency: mergedData.reduce((sum, d) => sum + (d.latency_ms || 0), 0) / mergedData.length,
            average_response_length: mergedData.reduce((sum, d) => sum + (d.response_length || 0), 0) / mergedData.length,
            average_message_length: mergedData.reduce((sum, d) => sum + (d.message_length || 0), 0) / mergedData.length,
            
            // Actions
            escalations: mergedData.filter(d => d.escalated).length,
            shares: mergedData.filter(d => d.shared).length
        };

        stats.verbosity_ratio = stats.average_response_length / stats.average_message_length;

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
            average_response_length: positive.reduce((sum, d) => sum + (d.response_length || 0), 0) / positive.length || 0,
            average_latency: positive.reduce((sum, d) => sum + (d.latency_ms || 0), 0) / positive.length || 0,
            escalation_rate: positive.filter(d => d.escalated).length / positive.length,
            share_rate: positive.filter(d => d.shared).length / positive.length,
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

        // Build report
        const report = this._buildReport(stats, negativePatterns, positiveChars, aiAnalysis);

        // Save report
        await fs.writeFile(outputPath, report, 'utf8');
        console.log(`\n✓ Report saved to: ${outputPath}\n`);

        return { stats, negativePatterns, positiveChars, aiAnalysis };
    }

    /**
     * Build markdown report
     */
    _buildReport(stats, negativePatterns, positiveChars, aiAnalysis) {
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
- ✅ Positive (+1): ${stats.positive_feedback} (${(stats.positive_feedback / stats.with_feedback * 100).toFixed(1)}%)
- 🤷 Neutral (0): ${stats.neutral_feedback} (${(stats.neutral_feedback / stats.with_feedback * 100).toFixed(1)}%)
- ❌ Negative (-1): ${stats.negative_feedback} (${(stats.negative_feedback / stats.with_feedback * 100).toFixed(1)}%)

### Response Metrics
- Average Latency: ${stats.average_latency.toFixed(0)}ms
- Average Response Length: ${stats.average_response_length.toFixed(0)} characters
- Average User Message Length: ${stats.average_message_length.toFixed(0)} characters
- Verbosity Ratio: ${stats.verbosity_ratio.toFixed(2)}x

### Agent Actions
- Escalations: ${stats.escalations} (${(stats.escalations / stats.total_interactions * 100).toFixed(1)}%)
- Information Shares: ${stats.shares} (${(stats.shares / stats.total_interactions * 100).toFixed(1)}%)

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

## Recommendations Priority

${this._generatePriorityRecommendations(stats, negativePatterns)}

---

*This report is automatically generated by the Feedback Analyzer*
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

