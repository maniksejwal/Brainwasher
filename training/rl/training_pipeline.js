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
        /**
         * optimizePrompts: Which prompts to optimize
         * - 'all' (default): Optimize all prompts (unified, doctor, enrichment, etc.)
         * - 'unified': Only optimize unified_prompt.js
         * - Array: Specific prompt types to optimize (e.g., ['unified', 'doctor_summary'])
         */
        this.optimizePrompts = options.optimizePrompts || 'all';
        this.maxRunsPerTest = options.maxRunsPerTest || 5; // Configurable via constructor
        this.maxScenariosPerTest = options.maxScenariosPerTest || null; // Configurable via constructor
        
        // Conversation count calculation:
        // For each optimized prompt: maxRunsPerTest × 2 (baseline + challenger) = conversations per prompt
        // Example: 2 prompts, 5 runs each = 2 × 5 × 2 = 20 conversations total
        
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
            let optimizedPrompts = [];
            
            if (this.optimizePrompts === 'unified' || (Array.isArray(this.optimizePrompts) && this.optimizePrompts.includes('unified'))) {
                // Use existing unified prompt optimization (reuse code)
                const unifiedPrompts = await this.generateOptimizedPrompts(optimizationOpportunities);
                optimizedPrompts.push(...unifiedPrompts);
            }
            
            if (this.optimizePrompts === 'all' || (Array.isArray(this.optimizePrompts) && this.optimizePrompts.some(p => p !== 'unified'))) {
                // Use multi-prompt optimizer for other prompts
                const { MultiPromptOptimizer } = await import('./prompt_optimizer_multi.js');
                const multiOptimizer = new MultiPromptOptimizer();
                const otherPrompts = await multiOptimizer.generateOptimizedPromptsForAll(
                    optimizationOpportunities,
                    this.optimizePrompts === 'all' ? ['unified', 'all'] : this.optimizePrompts
                );
                optimizedPrompts.push(...otherPrompts);
            }

            // Step 5: A/B test new prompts
            if (this.skipSimulations) {
                console.log('[TrainingPipeline] Analyzing existing data for A/B tests (skipping simulations)...');
            } else {
                console.log('[TrainingPipeline] Running A/B tests...');
            }
            const abTestResults = await this.runABTests(optimizedPrompts, this.skipSimulations);

            // Step 6: Deploy best performing prompt (MANUAL APPROVAL REQUIRED)
            if (abTestResults.winner) {
                console.log('\n⚠️  DEPLOYMENT CANDIDATE DETECTED ⚠️');
                console.log(`Winner: ${abTestResults.winner.version}`);
                console.log(`Performance: ${abTestResults.winner.testResult?.challengerScore?.toFixed(2) || 'N/A'}`);
                console.log('\n⚠️  Auto-deployment is DISABLED. Review prompts and deploy manually. ⚠️');
                console.log(`\nTo deploy, review the prompts and run:`);
                console.log(`  node cli/train.js deploy --version ${abTestResults.winner.version}`);
                // await this.deployPromptVersion(abTestResults.winner); // DISABLED - requires manual approval
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
        // From training/rl/ we need to go up 2 levels to reach project root
        const promptsDir = path.join(__dirname, '../../prompts');
        const unifiedPromptPath = path.join(promptsDir, 'unified_prompt.js');
        
        let currentPrompt;
        try {
            // Resolve to absolute path for better error messages
            const resolvedPath = path.resolve(unifiedPromptPath);
            currentPrompt = await this.promptOptimizer.loadPrompt(resolvedPath);
        } catch (error) {
            console.warn(`[TrainingPipeline] Could not load current prompt from: ${path.resolve(unifiedPromptPath)}`);
            console.warn(`[TrainingPipeline] Error: ${error.message}`);
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
                    const version = `v${Date.now()}`;
                    const timestamp = new Date().toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    const promptName = `${opportunity.type || 'optimization'} - ${opportunity.description?.substring(0, 40) || 'optimization'} (${timestamp})`;
                    
                    // Save to database immediately for tracking
                    try {
                        const { savePromptVersion } = await import('../../db/index.js');
                        await savePromptVersion(version, optimizedPrompt, promptName, 0);
                        console.log(`[TrainingPipeline] Saved optimized prompt ${version}: ${promptName}`);
                    } catch (error) {
                        console.warn(`[TrainingPipeline] Could not save prompt to DB:`, error.message);
                    }
                    
                    optimizedPrompts.push({
                        ...opportunity,
                        optimizedPrompt,
                        version,
                        name: promptName
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
                    const runsPerVersion = this.maxRunsPerTest || 2; // Configurable via constructor
                    const maxScenariosToUse = this.maxScenariosPerTest || allScenarios.length; // Limit scenarios if needed
                    
                    // Limit scenarios if configured
                    const scenariosToChooseFrom = maxScenariosToUse < allScenarios.length ? 
                        allScenarios.slice(0, maxScenariosToUse) : allScenarios;
                    
                    // Ensure we have enough unique scenarios
                    if (scenariosToChooseFrom.length >= runsPerVersion) {
                        // Pick unique random scenarios (no repetition)
                        const shuffled = [...scenariosToChooseFrom].sort(() => Math.random() - 0.5);
                        diverseScenarios.push(...shuffled.slice(0, runsPerVersion));
                    } else {
                        // If we have fewer scenarios than runs, use all but minimize repetition
                        const scenarioCounts = {};
                        for (let i = 0; i < runsPerVersion; i++) {
                            // Prefer less-used scenarios
                            const available = scenariosToChooseFrom.filter(s => !scenarioCounts[s] || scenarioCounts[s] < 2);
                            const selected = available.length > 0 ? 
                                available[Math.floor(Math.random() * available.length)] :
                                scenariosToChooseFrom[Math.floor(Math.random() * scenariosToChooseFrom.length)];
                            diverseScenarios.push(selected);
                            scenarioCounts[selected] = (scenarioCounts[selected] || 0) + 1;
                        }
                    }
                    
                    console.log(`[TrainingPipeline] Using ${diverseScenarios.length} diverse scenarios for A/B test (from ${scenariosToChooseFrom.length} available, ${allScenarios.length} total)`);
                    
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
        // Use path.resolve to get absolute paths from relative __dirname
        const projectRoot = path.resolve(__dirname, '../../../');
        const promptPath = path.join(projectRoot, 'prompts/unified_prompt.js');
        const backupPath = path.join(projectRoot, 'prompts/unified_prompt.js.backup');
        
        console.log(`[TrainingPipeline] Deploying to: ${promptPath}`);
        
        // Check if prompt file exists
        try {
            await fs.access(promptPath);
        } catch (error) {
            throw new Error(`Prompt file not found at ${promptPath}. Cannot deploy.`);
        }
        
        // Backup current prompt
        await fs.copyFile(promptPath, backupPath);
        console.log(`[TrainingPipeline] Backed up to: ${backupPath}`);
        
        // Wrap optimized prompt in proper export format
        const wrappedPrompt = `/**
 * @fileoverview prompts/unified_prompt.js
 * The primary prompt for the unified conversational agent. This is the core "brain"
 * for patient and caregiver agents, now with a dedicated intent classification task.
 * 
 * Version: ${promptData.version}
 * Deployed: ${new Date().toISOString()}
 * Optimization Type: ${promptData.type || 'unknown'}
 * Performance: Baseline ${promptData.testResult?.baselineScore?.toFixed(2) || 'N/A'} -> Challenger ${promptData.testResult?.challengerScore?.toFixed(2) || 'N/A'}
 */

export const PROMPT_UNIFIED_AGENT_WITH_STATE = \`${promptData.optimizedPrompt}\`;
`;
        
        // Write new prompt
        await fs.writeFile(promptPath, wrappedPrompt, 'utf8');
        
        console.log(`[TrainingPipeline] ✓ Deployed ${promptData.version} (score: ${promptData.testResult?.challengerScore?.toFixed(2) || 'N/A'}, baseline: ${promptData.testResult?.baselineScore?.toFixed(2) || 'N/A'})`);
        
        // Update database with new version
        try {
            const { savePromptVersion } = await import('../../db/index.js');
            const promptName = `Optimized ${promptData.type || 'prompt'} - ${promptData.version}`;
            await savePromptVersion(
                promptData.version,
                promptData.optimizedPrompt,
                promptName,
                promptData.testResult?.challengerScore || 0
            );
        } catch (error) {
            console.warn('[TrainingPipeline] Could not update prompt_versions table:', error.message);
        }
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
