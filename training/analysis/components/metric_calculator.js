/**
 * @fileoverview Component for calculating performance metrics and scores
 */

export class MetricCalculator {
    /**
     * Calculate reward backpropagation
     * Connects feedback scores with prompt versions to identify optimization opportunities
     */
    calculateRewardBackpropagation(feedbackData) {
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

        return {
            prompt_performance: promptPerformance,
            reward_signals: rewardSignals,
            promptGroups: promptGroups // Return groups for further analysis (e.g. comments)
        };
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
     * Calculate comparison metrics between systems
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
}
