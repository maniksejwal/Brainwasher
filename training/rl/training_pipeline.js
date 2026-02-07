/**
 * @fileoverview RL Training Pipeline
 * Orchestrates the complete reinforcement learning process using modular components
 */

import { FeedbackAnalyzer } from '../analysis/feedback_analyzer.js';
import { PromptOptimizer } from '../analysis/prompt_optimizer.js';
import { trainingDb } from '../core/database_manager.js';

// Modular Components
import { ExperienceGenerator } from './components/experience_generator.js';
import { BanditManager } from './components/bandit_manager.js';
import { ScenarioSelector } from './components/scenario_selector.js';
import { OptimizationStrategist } from './components/optimization_strategist.js';

export class TrainingPipeline {
    constructor(options = {}) {
        this.minConversationsForOptimization = options.minConversations || 50;
        this.minScoreThreshold = options.minScoreThreshold || 0.5;
        this.optimizationInterval = options.optimizationInterval || 24 * 60 * 60 * 1000;
        this.lastOptimization = null;
        this.skipSimulations = options.skipSimulations || false;
        this.optimizePrompts = options.optimizePrompts || 'all';
        this.maxRunsPerTest = options.maxRunsPerTest || 5;
        this.maxScenariosPerTest = options.maxScenariosPerTest || null;
        this.concurrency = options.concurrency || 5;

        this.mixModeRatio = options.mixModeRatio || { targeted: 0.1, random: 0.9 };

        // Core Systems
        this.feedbackAnalyzer = new FeedbackAnalyzer();
        this.promptOptimizer = new PromptOptimizer();
        this.db = null;

        // Sub-components
        this.experienceGenerator = new ExperienceGenerator();
        this.banditManager = new BanditManager(); // DB injected later
        this.scenarioSelector = new ScenarioSelector(this.mixModeRatio);
        this.optimizationStrategist = new OptimizationStrategist(
            this.promptOptimizer,
            this.feedbackAnalyzer,
            { optimizePrompts: this.optimizePrompts }
        );
    }

    /**
     * Initialize the training pipeline
     */
    async initialize() {
        await trainingDb.initialize(true);
        this.db = trainingDb.getDb();
        this.banditManager.setDb(this.db);
        console.log('[TrainingPipeline] Initialized with centralized database manager');
    }

    /**
     * Check if optimization should be triggered
     */
    async shouldOptimize() {
        const now = Date.now();
        if (this.lastOptimization && (now - this.lastOptimization) < this.optimizationInterval) {
            return false;
        }

        const conversationCount = await this.getConversationCount();
        if (conversationCount < this.minConversationsForOptimization) {
            console.log(`[TrainingPipeline] Not enough conversations for optimization: ${conversationCount}/${this.minConversationsForOptimization}`);
            return false;
        }

        const currentPerformance = await this.getCurrentPerformance();
        if (currentPerformance.averageScore >= this.minScoreThreshold) {
            console.log(`[TrainingPipeline] Performance is acceptable: ${currentPerformance.averageScore.toFixed(2)}`);
            return false;
        }

        return true;
    }

    /**
     * Get current status of the pipeline
     */
    async getStatus() {
        const conversationCount = await this.getConversationCount();
        const performance = await this.getCurrentPerformance();
        const shouldOptimize = await this.shouldOptimize();

        // Calculate next optimization time
        let nextOptimization = new Date();
        if (this.lastOptimization) {
            nextOptimization = new Date(this.lastOptimization + this.optimizationInterval);
        }

        return {
            conversationCount,
            performance,
            lastOptimization: this.lastOptimization,
            nextOptimization,
            shouldOptimize
        };
    }

    /**
     * Run the complete training pipeline
     */
    async runTrainingCycle() {
        console.log('[TrainingPipeline] Starting training cycle...');

        try {
            // Step 1: Check data sufficiency (Baseline Experience)
            // Uses component logic if needed, but simple check remains here
            const conversationCount = await this.getConversationCount();
            if (conversationCount < this.minConversationsForOptimization) {
                const needed = this.minConversationsForOptimization - conversationCount;
                console.log(`[TrainingPipeline] Insufficient data (${conversationCount}/${this.minConversationsForOptimization}). Generating ${needed} baseline simulations...`);
                await this.generateExperience(Math.max(needed, 5));
            }

            // Step 2: Check optimization criteria
            if (!(await this.shouldOptimize())) {
                console.log('[TrainingPipeline] Optimization skipped (criteria not met after data collection)');
                return;
            }

            // Step 3: Analyze current performance
            console.log('[TrainingPipeline] Analyzing current performance...');
            const performanceAnalysis = await this.feedbackAnalyzer.analyzePerformance();

            // Step 4: Identify opportunities & Generate Prompts
            console.log('[TrainingPipeline] Identifying optimization opportunities...');
            const opportunities = await this.optimizationStrategist.identifyOptimizationOpportunities(performanceAnalysis);

            if (opportunities.length === 0) {
                console.log('[TrainingPipeline] No clear optimization opportunities found');
                return;
            }

            console.log('[TrainingPipeline] Generating optimized prompts...');
            const optimizedPrompts = await this.optimizationStrategist.generateOptimizedPrompts(opportunities);

            // Step 5: Multi-arm bandit testing
            const banditResults = await this.runMultiArmBandit(optimizedPrompts, this.skipSimulations);

            // Step 6: Process Results (Display Winners)
            this._processBanditResults(banditResults);

            // Step 7: Update timestamp
            this.lastOptimization = Date.now();
            await this.saveOptimizationTimestamp();

            console.log('[TrainingPipeline] Training cycle completed successfully');

        } catch (error) {
            console.error('[TrainingPipeline] Training cycle failed:', error.message);
            throw error;
        }
    }

    // --- Delegation Methods ---

    async generateExperience(count) {
        return this.experienceGenerator.generateExperience(count);
    }

    async runMultiArmBandit(optimizedPrompts, skipSimulations) {
        return this.banditManager.runMultiArmBandit(optimizedPrompts, this, skipSimulations);
    }

    /** 
     * @private
     * Exposed for BanditManager to access if needed (or moved entirely to Selector)
     */
    _selectMixedScenarios(allScenarios, targetTags, totalNeeded) {
        return this.scenarioSelector.selectMixedScenarios(allScenarios, targetTags, totalNeeded);
    }


    // --- Helper Methods (DB Access) ---

    async getConversationCount() {
        return await trainingDb.getConversationCount(7, 0);
    }

    async getCurrentPerformance() {
        return await trainingDb.getPerformanceMetrics(7);
    }

    async saveOptimizationTimestamp() {
        return await trainingDb.storeTrainingMetadata('last_optimization', this.lastOptimization.toString());
    }

    // --- Result Processing ---

    _processBanditResults(banditResults) {
        const winners = [];
        if (banditResults.winner) {
            winners.push(banditResults.winner);
        }

        // Check other candidates
        for (const test of banditResults.tests || []) {
            if (test.testResult && test.testResult.score > 0 && test.version !== 'current') {
                const stats = test.testResult.stats || [];
                const baselineStats = stats.find(s => s.version === 'current');
                const challengerStats = stats.find(s => s.version === test.version);

                if (challengerStats && baselineStats && challengerStats.expectedValue > baselineStats.expectedValue) {
                    if (!winners.find(w => w.version === test.version)) {
                        winners.push(test);
                    }
                }
            }
        }

        if (winners.length > 0) {
            console.log('\n⚠️  DEPLOYMENT CANDIDATES DETECTED ⚠️');
            winners.forEach(winner => {
                console.log(`📝 ${winner.name || winner.type || 'Unknown Prompt'}:`);
                console.log(`   Version: ${winner.version}`);
                console.log(`   Performance: ${winner.testResult?.score?.toFixed(2) || 'N/A'}`);
                console.log(`   Type: ${winner.type || 'N/A'}`);
                console.log(`   node cli/train.js deploy --version ${winner.version}\n`);
            });
            console.log('⚠️  Auto-deployment is DISABLED. Review prompts and deploy manually. ⚠️');
        } else {
            console.log('\n📊 No deployment candidates - all prompts performed similarly or baseline was better');
        }
    }
}

// Export singleton instance for CLI usage
export const trainingPipeline = new TrainingPipeline();
