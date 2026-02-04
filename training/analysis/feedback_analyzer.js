/**
 * @fileoverview Feedback Analyzer System
 * Orchestrates analysis of training data and human feedback.
 */

import { DataLoader } from './components/data_loader.js';
import { MetricCalculator } from './components/metric_calculator.js';
import { CommentAnalyzer } from './components/comment_analyzer.js';
import { OptimizationIdentifier } from './components/optimization_identifier.js';

class FeedbackAnalyzer {
    constructor() {
        this.dataLoader = new DataLoader();
        this.metricCalculator = new MetricCalculator();
        this.commentAnalyzer = new CommentAnalyzer();
        this.optimizationIdentifier = new OptimizationIdentifier(this.commentAnalyzer);
    }

    /**
     * Load training log entries
     * @deprecated Use DataLoader directly if possible
     */
    async loadTrainingLog(logPath = 'training/training_log.jsonl') {
        return await this.dataLoader.loadTrainingLog(logPath);
    }

    /**
     * Load human feedback from database
     * @deprecated Use DataLoader directly if possible
     */
    async loadFeedback() {
        return await this.dataLoader.loadFeedback();
    }

    /**
     * Merge training logs with feedback entries
     */
    mergeLogsWithFeedback(logs, feedback) {
        return this.dataLoader.mergeLogsWithFeedback(logs, feedback);
    }

    /**
     * Calculate reward backpropagation
     */
    calculateRewardBackpropagation(feedbackData) {
        return this.metricCalculator.calculateRewardBackpropagation(feedbackData);
    }

    /**
     * Calculate reward signal for a prompt version
     */
    calculateRewardSignal(data) {
        return this.metricCalculator.calculateRewardSignal(data);
    }

    /**
     * Generate actionable reward signals
     */
    generateRewardSignals(promptPerformance) {
        return this.metricCalculator.generateRewardSignals(promptPerformance);
    }

    /**
     * Analyze feedback comments for backpropagation
     */
    async analyzeFeedbackComments(promptGroups) {
        return await this.commentAnalyzer.analyzeFeedbackComments(promptGroups);
    }

    /**
     * Identify specific optimization opportunities
     */
    identifyOptimizationOpportunities(promptPerformance, feedbackData) {
        return this.optimizationIdentifier.identifyOptimizationOpportunities(promptPerformance, feedbackData);
    }

    /**
     * Analyze current system performance
     */
    async analyzePerformance() {
        try {
            console.log('[FeedbackAnalyzer] Loading data for analysis...');
            const logs = await this.dataLoader.loadTrainingLog();
            const feedback = await this.dataLoader.loadFeedback();

            console.log(`[FeedbackAnalyzer] Loaded ${logs.length} logs and ${feedback.length} feedback entries.`);

            // Merge data (optional for this specific analysis but good practice)
            // this.mergeLogsWithFeedback(logs, feedback); 

            // Basic metrics from Calculator (using logs generally)
            const systemMetrics = this.metricCalculator.calculateSystemMetrics(logs);

            // Calculate RLHF-weighted score from last 7 days
            // Note: This logic could be moved to metric calculator but kept here for specific aggregation
            let rewardScore = 0;
            let rewardCount = 0;
            const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000);

            // Use logs for outcome labels analysis
            for (const log of logs) {
                if (log.timestamp > cutoffTime && log.outcome_label) {
                    if (log.outcome_label === 'positive') { rewardScore += 1.0; rewardCount++; }
                    else if (log.outcome_label === 'negative') { rewardScore -= 1.0; rewardCount++; }
                }
            }

            // Calculate AI Feedback Score (from explicit feedback table)
            const recentFeedback = feedback.filter(f => f.timestamp > cutoffTime);
            const aiFeedbackScore = recentFeedback.length > 0
                ? recentFeedback.reduce((sum, f) => sum + (f.score || 0), 0) / recentFeedback.length
                : 0;

            // Combine scores
            const rlhfScore = rewardCount > 0 ? rewardScore / rewardCount : 0;
            const combinedScore = (aiFeedbackScore * 0.7) + (rlhfScore * 0.3);

            console.log('[FeedbackAnalyzer] Performance Analysis:');
            console.log(`  AI Feedback Score: ${aiFeedbackScore.toFixed(2)}`);
            console.log(`  RLHF Reward Score: ${rlhfScore.toFixed(2)} (${rewardCount} samples)`);
            console.log(`  Combined Score: ${combinedScore.toFixed(2)}`);

            return {
                averageScore: combinedScore,
                escalationEffectiveness: systemMetrics.escalationRate > 0 ? 0.8 : 0.4, // Simplified fallback
                conversationQuality: aiFeedbackScore,
                rawMetrics: systemMetrics
            };

        } catch (error) {
            console.error('[FeedbackAnalyzer] Performance analysis failed:', error.message);
            return { averageScore: 0, escalationEffectiveness: 0, conversationQuality: 0 };
        }
    }

    /**
     * Generate comprehensive analysis report
     */
    async generateReport() {
        try {
            const logs = await this.dataLoader.loadTrainingLog();
            const feedback = await this.dataLoader.loadFeedback();

            console.log(`\nLoaded ${logs.length} training interactions`);
            console.log(`Found ${feedback.length} human feedback entries\n`);

            // 1. Calculate Rewards & Metrics
            const { prompt_performance, reward_signals, promptGroups } = this.metricCalculator.calculateRewardBackpropagation(feedback);

            // 2. Identify Optimization Opportunities
            const optimization_opportunities = this.optimizationIdentifier.identifyOptimizationOpportunities(prompt_performance, feedback);

            // 3. Analyze Comments (LLM)
            console.log('Generating AI-powered analysis...');
            const feedback_analysis = await this.commentAnalyzer.analyzeFeedbackComments(promptGroups);

            // 4. Construct Final Report Object
            const analysis = {
                timestamp: new Date().toISOString(),
                prompt_performance,
                feedback_analysis,
                reward_signals,
                optimization_opportunities
            };

            // Save report
            const { getStorage } = await import('../../lib/storage/index.js');
            const storage = getStorage();
            await storage.write('training/analysis_report.md', JSON.stringify(analysis, null, 2));

            console.log('\n✓ Report saved to: training/analysis_report.md');
            return analysis;

        } catch (error) {
            console.error('[FeedbackAnalyzer] Report generation failed:', error.message);
            return { error: error.message };
        }
    }

    async compareCompanionVsUnified() {
        try {
            const logs = await this.dataLoader.loadTrainingLog();
            const companionLogs = logs.filter(log => log.system_used === 'companion');
            const unifiedLogs = logs.filter(log => log.system_used === 'unified' || !log.system_used);

            return {
                companion: this.metricCalculator.calculateSystemMetrics(companionLogs),
                unified: this.metricCalculator.calculateSystemMetrics(unifiedLogs)
            };
        } catch (e) {
            console.error('Comparison failed:', e);
            return {};
        }
    }
}

// Export singleton or class
export default new FeedbackAnalyzer();
export { FeedbackAnalyzer };
