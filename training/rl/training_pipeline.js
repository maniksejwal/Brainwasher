/**
 * @fileoverview RL Training Pipeline
 * Orchestrates the complete reinforcement learning process:
 * 1. Collect feedback from simulations
 * 2. Analyze performance patterns
 * 3. Optimize prompts based on feedback
 * 4. Deploy new prompt versions
 * 5. A/B test new versions
 */

import { FeedbackAnalyzer } from '../analysis/feedback_analyzer.js';
import { PromptOptimizer } from '../analysis/prompt_optimizer.js';
import { ABTest } from '../analysis/ab_test.js';
import { trainingDb } from '../core/database_manager.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class TrainingPipeline {
    constructor(options = {}) {
        this.minConversationsForOptimization = options.minConversations || 50;
        this.minScoreThreshold = options.minScoreThreshold || 0.5;
        this.optimizationInterval = options.optimizationInterval || 24 * 60 * 60 * 1000; // 24 hours
        this.lastOptimization = null;
        this.skipSimulations = options.skipSimulations || false; // Skip AB test simulations
        
        this.feedbackAnalyzer = new FeedbackAnalyzer();
        this.promptOptimizer = new PromptOptimizer();
        
        this.db = null;
    }

    /**
     * Initialize the training pipeline
     */
    async initialize() {
        // Use simulation database for training pipeline
        await trainingDb.initialize(true);
        this.db = trainingDb.getDb();
        console.log('[TrainingPipeline] Initialized with centralized database manager');
    }

    /**
     * Check if optimization should be triggered
     */
    async shouldOptimize() {
        // Check if enough time has passed
        const now = Date.now();
        if (this.lastOptimization && (now - this.lastOptimization) < this.optimizationInterval) {
            return false;
        }

        // Check if we have enough conversation data
        const conversationCount = await this.getConversationCount();
        if (conversationCount < this.minConversationsForOptimization) {
            console.log(`[TrainingPipeline] Not enough conversations for optimization: ${conversationCount}/${this.minConversationsForOptimization}`);
            return false;
        }

        // Check if current performance is below threshold
        const currentPerformance = await this.getCurrentPerformance();
        if (currentPerformance.averageScore >= this.minScoreThreshold) {
            console.log(`[TrainingPipeline] Performance is acceptable: ${currentPerformance.averageScore.toFixed(2)}`);
            return false;
        }

        return true;
    }

    /**
     * Run the complete training pipeline
     */
    async runTrainingCycle() {
        console.log('[TrainingPipeline] Starting training cycle...');

        try {
            // Step 1: Check if optimization is needed
            if (!(await this.shouldOptimize())) {
                console.log('[TrainingPipeline] No optimization needed at this time');
                return;
            }

            // Step 2: Analyze current performance
            console.log('[TrainingPipeline] Analyzing current performance...');
            const performanceAnalysis = await this.feedbackAnalyzer.analyzePerformance();
            
            // Step 3: Identify optimization opportunities
            console.log('[TrainingPipeline] Identifying optimization opportunities...');
            const optimizationOpportunities = await this.identifyOptimizationOpportunities(performanceAnalysis);

            if (optimizationOpportunities.length === 0) {
                console.log('[TrainingPipeline] No clear optimization opportunities found');
                return;
            }

            // Step 4: Generate optimized prompts
            console.log('[TrainingPipeline] Generating optimized prompts...');
            const optimizedPrompts = await this.generateOptimizedPrompts(optimizationOpportunities);

            // Step 5: A/B test new prompts
            if (this.skipSimulations) {
                console.log('[TrainingPipeline] Analyzing existing data for A/B tests (skipping simulations)...');
            } else {
                console.log('[TrainingPipeline] Running A/B tests...');
            }
            const abTestResults = await this.runABTests(optimizedPrompts, this.skipSimulations);

            // Step 6: Deploy best performing prompt
            if (abTestResults.winner) {
                console.log('[TrainingPipeline] Deploying winning prompt version...');
                await this.deployPromptVersion(abTestResults.winner);
            }

            // Step 7: Update optimization timestamp
            this.lastOptimization = Date.now();
            await this.saveOptimizationTimestamp();

            console.log('[TrainingPipeline] Training cycle completed successfully');

        } catch (error) {
            console.error('[TrainingPipeline] Training cycle failed:', error.message);
            throw error;
        }
    }

    /**
     * Get total conversation count
     */
    async getConversationCount() {
        return await trainingDb.getConversationCount(7);
    }

    /**
     * Get current performance metrics
     */
    async getCurrentPerformance() {
        return await trainingDb.getPerformanceMetrics(7);
    }

    /**
     * Identify optimization opportunities from performance analysis
     */
    async identifyOptimizationOpportunities(performanceAnalysis) {
        const opportunities = [];

        // Low scoring patterns
        if (performanceAnalysis.averageScore < 0.3) {
            opportunities.push({
                type: 'low_overall_score',
                priority: 'high',
                description: 'Overall performance is very low',
                targetMetric: 'averageScore'
            });
        }

        // Poor escalation handling
        if (performanceAnalysis.escalationEffectiveness < 0.5) {
            opportunities.push({
                type: 'poor_escalation',
                priority: 'high',
                description: 'Escalation handling needs improvement',
                targetMetric: 'escalationEffectiveness'
            });
        }

        // Low conversation quality
        if (performanceAnalysis.conversationQuality < 0.4) {
            opportunities.push({
                type: 'low_conversation_quality',
                priority: 'medium',
                description: 'Conversation quality needs improvement',
                targetMetric: 'conversationQuality'
            });
        }

        return opportunities;
    }

    /**
     * Generate optimized prompts based on opportunities
     */
    async generateOptimizedPrompts(opportunities) {
        const optimizedPrompts = [];

        // Load current unified prompt
        const promptsDir = path.join(__dirname, '../../../prompts');
        const unifiedPromptPath = path.join(promptsDir, 'unified_prompt.js');
        
        let currentPrompt;
        try {
            currentPrompt = await this.promptOptimizer.loadPrompt(unifiedPromptPath);
        } catch (error) {
            console.warn('[TrainingPipeline] Could not load current prompt:', error.message);
            return [];
        }

        // Get analysis report
        const analysisReport = await this.feedbackAnalyzer.generateReport();

        for (const opportunity of opportunities) {
            try {
                // Build focused analysis for this opportunity
                const focusedAnalysis = `Opportunity: ${opportunity.type}\nPriority: ${opportunity.priority}\nDescription: ${opportunity.description}\nTarget Metric: ${opportunity.targetMetric}\n\n${typeof analysisReport === 'string' ? analysisReport : analysisReport.aiAnalysis || JSON.stringify(analysisReport)}`;
                
                const optimizedPrompt = await this.promptOptimizer.optimizePrompt(currentPrompt, focusedAnalysis);

                if (optimizedPrompt && optimizedPrompt.length > 100) {
                    optimizedPrompts.push({
                        ...opportunity,
                        optimizedPrompt,
                        version: `v${Date.now()}`
                    });
                }
            } catch (error) {
                console.warn(`[TrainingPipeline] Failed to optimize for ${opportunity.type}:`, error.message);
            }
        }

        return optimizedPrompts;
    }

    /**
     * Run A/B tests on optimized prompts
     * @param {boolean} skipSimulations - If true, analyze existing data instead of running new simulations
     */
    async runABTests(optimizedPrompts, skipSimulations = false) {
        if (optimizedPrompts.length === 0) {
            console.log('[TrainingPipeline] No optimized prompts to test');
            return { tests: [], winner: null };
        }

        const results = {
            tests: [],
            winner: null
        };

        if (skipSimulations) {
            // Analyze existing feedback data instead of running simulations
            console.log('[TrainingPipeline] Skipping simulations - analyzing existing feedback data');
            for (const promptData of optimizedPrompts) {
                try {
                    const testResult = await this._analyzeExistingDataForABTest('current', promptData.version);
                    
                    results.tests.push({
                        ...promptData,
                        testResult
                    });

                    if (testResult.challengerScore > testResult.baselineScore) {
                        results.winner = promptData;
                    }
                } catch (error) {
                    console.warn(`[TrainingPipeline] Analysis failed for ${promptData.type}:`, error.message);
                }
            }
        } else {
            // Run new simulations with scenario diversity (not repetition)
            // Get all available scenarios for diversity
            const { SCENARIOS } = await import('../simulation/scenarios.js');
            const allScenarios = Object.keys(SCENARIOS);
            
            for (const promptData of optimizedPrompts) {
                try {
                    // Select diverse scenarios - each run gets a different random scenario
                    // This ensures we test the prompt across various contexts, not just repeated scenarios
                    const diverseScenarios = [];
                    const runsPerVersion = 5;
                    
                    // Ensure we have enough unique scenarios
                    if (allScenarios.length >= runsPerVersion) {
                        // Pick unique random scenarios (no repetition)
                        const shuffled = [...allScenarios].sort(() => Math.random() - 0.5);
                        diverseScenarios.push(...shuffled.slice(0, runsPerVersion));
                    } else {
                        // If we have fewer scenarios than runs, use all but minimize repetition
                        const scenarioCounts = {};
                        for (let i = 0; i < runsPerVersion; i++) {
                            // Prefer less-used scenarios
                            const available = allScenarios.filter(s => !scenarioCounts[s] || scenarioCounts[s] < 2);
                            const selected = available.length > 0 ? 
                                available[Math.floor(Math.random() * available.length)] :
                                allScenarios[Math.floor(Math.random() * allScenarios.length)];
                            diverseScenarios.push(selected);
                            scenarioCounts[selected] = (scenarioCounts[selected] || 0) + 1;
                        }
                    }
                    
                    const abTest = new ABTest({
                        baseline: 'current',
                        challenger: promptData.version,
                        runs: runsPerVersion,
                        scenarios: diverseScenarios // Diverse scenarios instead of repeated ones
                    });
                    
                    const testResult = await abTest.runTest(`Optimization: ${promptData.type}`);

                    results.tests.push({
                        ...promptData,
                        testResult
                    });

                    if (testResult.challengerScore > testResult.baselineScore) {
                        results.winner = promptData;
                    }
                } catch (error) {
                    console.warn(`[TrainingPipeline] A/B test failed for ${promptData.type}:`, error.message);
                }
            }
        }

        return results;
    }

    /**
     * Analyze existing feedback data for A/B test comparison
     * Reuses FeedbackAnalyzer to avoid code duplication
     */
    async _analyzeExistingDataForABTest(baselineVersion, challengerVersion) {
        // Reuse FeedbackAnalyzer's reward backpropagation method
        const rewardAnalysis = await this.feedbackAnalyzer.calculateRewardBackpropagation();
        
        // Extract baseline performance
        const baselinePerf = rewardAnalysis.prompt_performance[baselineVersion] || 
                           rewardAnalysis.prompt_performance['current'] ||
                           Object.values(rewardAnalysis.prompt_performance)[0]; // First available
        
        // Extract challenger performance
        const challengerPerf = rewardAnalysis.prompt_performance[challengerVersion];
        
        const baselineScore = baselinePerf?.reward_signal || baselinePerf?.avg_score || 0;
        const challengerScore = challengerPerf?.reward_signal || challengerPerf?.avg_score || 0;
        const baselineCount = baselinePerf?.total_interactions || 0;
        const challengerCount = challengerPerf?.total_interactions || 0;

        return {
            baselineScore,
            challengerScore,
            baselineCount,
            challengerCount,
            winner: challengerScore > baselineScore ? 'challenger' : 'baseline',
            rewardAnalysis // Include full analysis for context
        };
    }

    /**
     * Deploy a new prompt version
     */
    async deployPromptVersion(promptData) {
        // Save the new prompt version
        const promptPath = path.join(__dirname, '../../../prompts/unified_prompt.js');
        const backupPath = path.join(__dirname, '../../../prompts/unified_prompt.js.backup');
        
        // Backup current prompt
        await fs.copyFile(promptPath, backupPath);
        
        // Write new prompt
        await fs.writeFile(promptPath, promptData.optimizedPrompt);
        
        console.log(`[TrainingPipeline] ✓ Deployed ${promptData.version} (score: ${promptData.testResult?.challengerScore?.toFixed(2) || 'N/A'}, baseline: ${promptData.testResult?.baselineScore?.toFixed(2) || 'N/A'})`);
        
        // Update database with new version
        await this.db.run(`
            INSERT INTO prompt_versions (version, content, deployed_at, performance_score)
            VALUES (?, ?, datetime('now'), ?)
        `, [promptData.version, promptData.optimizedPrompt, promptData.testResult?.challengerScore || 0]);
    }

    /**
     * Save optimization timestamp
     */
    async saveOptimizationTimestamp() {
        await this.db.run(`
            INSERT OR REPLACE INTO training_metadata (key, value, updated_at)
            VALUES ('last_optimization', ?, datetime('now'))
        `, [this.lastOptimization.toString()]);
    }

    /**
     * Get training pipeline status
     */
    async getStatus() {
        const conversationCount = await this.getConversationCount();
        const performance = await this.getCurrentPerformance();
        
        return {
            conversationCount,
            performance,
            lastOptimization: this.lastOptimization,
            nextOptimization: this.lastOptimization ? 
                new Date(this.lastOptimization + this.optimizationInterval) : 
                new Date(Date.now() + this.optimizationInterval),
            shouldOptimize: await this.shouldOptimize()
        };
    }
}

// Export singleton instance
export const trainingPipeline = new TrainingPipeline();
