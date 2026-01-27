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
import { ThompsonSampling } from './thompson_sampling.js';
import { ContextualBandit } from './contextual_bandit.js';
import { trainingDb } from '../core/database_manager.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class TrainingPipeline {
    constructor(options = {}) {
        this.minConversationsForOptimization = options.minConversations || 5; // Reduced default for testing (was 50)
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

        /**
         * mixModeRatio: Ratio of targeted vs random scenarios (prevents overfitting)
         * - targeted: Scenarios matching optimization opportunities (e.g., escalation scenarios for escalation improvements)
         * - random: Randomly selected scenarios for general coverage
         * Default: 10% targeted, 90% random (mostly random to ensure generalization)
         */
        this.mixModeRatio = options.mixModeRatio || { targeted: 0.1, random: 0.9 };

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

            // Step 2: Analyze current performance (uses EXISTING feedback from past simulations)
            // This generates a report BEFORE running new simulations - it analyzes past data to identify what needs optimization
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
            // MULTI-PROMPT OPTIMIZATION APPROACH:
            // - The system optimizes MULTIPLE prompts in PARALLEL (not one at a time)
            // - Each prompt type (unified, doctor_summary, companion_*, etc.) gets its own optimization
            // - Each optimized prompt is tested independently with Thompson Sampling
            // - ALL winners are shown (one per prompt type that outperformed baseline)
            // - This allows simultaneous optimization of different parts of the system
            // - Use --prompts "all" to optimize all prompts, or --prompts "unified,doctor_summary" for specific ones
            console.log('[TrainingPipeline] Generating optimized prompts...');
            console.log(`[TrainingPipeline] Optimizing prompts: ${this.optimizePrompts === 'all' ? 'all prompt types' : Array.isArray(this.optimizePrompts) ? this.optimizePrompts.join(', ') : this.optimizePrompts}`);
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

            console.log(`[TrainingPipeline] Generated ${optimizedPrompts.length} optimized prompt version(s) across ${new Set(optimizedPrompts.map(p => p.type)).size} prompt type(s)`);

            // Step 5: Multi-arm bandit testing with Thompson Sampling (replaces A/B testing)
            if (this.skipSimulations) {
                console.log('[TrainingPipeline] Analyzing existing data for multi-arm bandit (skipping simulations)...');
            } else {
                console.log('[TrainingPipeline] Running multi-arm bandit with Thompson Sampling...');
            }
            const banditResults = await this.runMultiArmBandit(optimizedPrompts, this.skipSimulations);

            // Step 6: Deploy best performing prompts (MANUAL APPROVAL REQUIRED)
            // Show ALL winners (one per prompt type tested)
            const winners = [];
            if (banditResults.winner) {
                winners.push(banditResults.winner);
            }
            // Also check test results for other prompt types that outperformed baseline
            for (const test of banditResults.tests || []) {
                if (test.testResult && test.testResult.score > 0 && test.version !== 'current') {
                    // Check if this version outperformed baseline
                    const stats = test.testResult.stats || [];
                    const baselineStats = stats.find(s => s.version === 'current');
                    const challengerStats = stats.find(s => s.version === test.version);
                    if (challengerStats && baselineStats && challengerStats.expectedValue > baselineStats.expectedValue) {
                        // Only add if not already in winners (avoid duplicates)
                        if (!winners.find(w => w.version === test.version)) {
                            winners.push({
                                ...test,
                                testResult: {
                                    score: challengerStats.expectedValue,
                                    stats: stats
                                }
                            });
                        }
                    }
                }
            }

            if (winners.length > 0) {
                console.log('\n⚠️  DEPLOYMENT CANDIDATES DETECTED ⚠️');
                console.log(`Found ${winners.length} optimized prompt(s) that outperformed baseline:\n`);

                for (const winner of winners) {
                    console.log(`📝 ${winner.name || winner.type || 'Unknown Prompt'}:`);
                    console.log(`   Version: ${winner.version}`);
                    console.log(`   Performance: ${winner.testResult?.score?.toFixed(2) || 'N/A'}`);
                    console.log(`   Type: ${winner.type || 'N/A'}`);
                    console.log(`\n   To view this prompt:`);
                    console.log(`     node cli/prompts.js show ${winner.version}`);
                    console.log(`\n   To deploy this prompt:`);
                    console.log(`     node cli/train.js deploy --version ${winner.version}`);
                    console.log('');
                }

                console.log('⚠️  Auto-deployment is DISABLED. Review prompts and deploy manually. ⚠️');
                console.log('\n💡 Note: Prompts are stored in the PRODUCTION database (care_circle.db)');
                console.log('   They can be viewed from any database using: node cli/prompts.js list');
                // await this.deployPromptVersion(banditResults.winner); // DISABLED - requires manual approval
            } else {
                console.log('\n📊 No deployment candidates - all prompts performed similarly or baseline was better');
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
        // Poor escalation handling
        if (performanceAnalysis.escalationEffectiveness < 0.5) {
            opportunities.push({
                type: 'poor_escalation',
                priority: 'high',
                description: 'Escalation handling needs improvement',
                targetMetric: 'escalationEffectiveness',
                tags: ['escalation'] // Tag for scenario targetting
            });
        }

        // Low conversation quality
        if (performanceAnalysis.conversationQuality < 0.4) {
            opportunities.push({
                type: 'low_conversation_quality',
                priority: 'medium',
                description: 'Conversation quality needs improvement',
                targetMetric: 'conversationQuality',
                tags: ['complex', 'emotional'] // Tag for scenario targetting
            });
        }

        return opportunities;
    }

    /**
     * Select mixed scenarios using Mix Mode (targeted + random)
     * Prevents overfitting by ensuring general coverage alongside targeted testing
     * @param {Array} allScenarios - All available scenarios
     * @param {Array} targetTags - Tags for targeted scenario selection
     * @param {number} totalNeeded - Total number of scenarios to select
     * @returns {Object} { all: Array, targeted: Array, random: Array }
     * @private
     */
    _selectMixedScenarios(allScenarios, targetTags, totalNeeded) {
        const targetedCount = Math.ceil(totalNeeded * this.mixModeRatio.targeted);
        const randomCount = totalNeeded - targetedCount;

        let targetedScenarios = [];
        let randomScenarios = [];

        // Step 1: Select targeted scenarios if tags are provided
        if (targetTags.length > 0) {
            const matchingScenarios = allScenarios.filter(s => {
                const name = s.toLowerCase();
                return targetTags.some(t => name.includes(t));
            });

            if (matchingScenarios.length > 0) {
                // Shuffle and take required count
                const shuffled = [...matchingScenarios].sort(() => Math.random() - 0.5);
                targetedScenarios = shuffled.slice(0, Math.min(targetedCount, shuffled.length));
                console.log(`[TrainingPipeline] Mix Mode: Selected ${targetedScenarios.length}/${targetedCount} targeted scenarios matching tags [${targetTags.join(',')}]`);
            } else {
                console.log(`[TrainingPipeline] Mix Mode: No scenarios found matching tags [${targetTags.join(',')}], using random selection`);
            }
        }

        // Step 2: Select random scenarios from remaining pool
        const remainingScenarios = allScenarios.filter(s => !targetedScenarios.includes(s));
        const shuffledRemaining = [...remainingScenarios].sort(() => Math.random() - 0.5);

        // If we didn't get enough targeted scenarios, compensate with more random ones
        const additionalNeeded = totalNeeded - targetedScenarios.length;
        randomScenarios = shuffledRemaining.slice(0, additionalNeeded);

        console.log(`[TrainingPipeline] Mix Mode: Selected ${randomScenarios.length} random scenarios for general coverage`);
        console.log(`[TrainingPipeline] Mix Mode: Total ${targetedScenarios.length + randomScenarios.length} scenarios (${Math.round(targetedScenarios.length / totalNeeded * 100)}% targeted, ${Math.round(randomScenarios.length / totalNeeded * 100)}% random)`);

        return {
            all: [...targetedScenarios, ...randomScenarios],
            targeted: targetedScenarios,
            random: randomScenarios
        };
    }

    /**
     * Get historical statistics for versions
     * @private
     */
    async _getHistoricalStats(versions) {
        if (!versions || versions.length === 0) return {};

        try {
            const placeholders = versions.map(() => '?').join(',');
            // Query DB for aggregate stats
            // Note: score > 0.5 counts as success for boolean approx
            const rows = await this.db.all(`
                SELECT 
                    prompt_version,
                    COUNT(*) as total,
                    SUM(CASE WHEN score > 0.5 THEN 1 ELSE 0 END) as successes,
                    SUM(CASE WHEN score <= 0.5 THEN 1 ELSE 0 END) as failures
                FROM feedback
                WHERE prompt_version IN (${placeholders})
                GROUP BY prompt_version
            `, versions);

            const stats = {};
            rows.forEach(row => {
                stats[row.prompt_version] = {
                    successes: row.successes,
                    failures: row.failures,
                    totalSamples: row.total
                };
            });

            // Also get 'current' stats (which might represent NULL version in DB or specific base version)
            if (versions.includes('current')) {
                const currentStats = await this.db.get(`
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN score > 0.5 THEN 1 ELSE 0 END) as successes,
                        SUM(CASE WHEN score <= 0.5 THEN 1 ELSE 0 END) as failures
                    FROM feedback
                    WHERE prompt_version IS NULL OR prompt_version = 'current'
                `);

                if (currentStats && currentStats.total > 0) {
                    stats['current'] = {
                        successes: currentStats.successes,
                        failures: currentStats.failures,
                        totalSamples: currentStats.total
                    };
                }
            }

            return stats;
        } catch (error) {
            console.warn('[TrainingPipeline] Failed to get historical stats:', error.message);
            return {};
        }
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

                    // Save to database immediately for tracking (ALWAYS to production DB)
                    let originalSimMode = process.env.SIMULATION_MODE;
                    try {
                        // Force use of production database for prompt storage
                        delete process.env.SIMULATION_MODE; // Temporarily disable simulation mode

                        const { savePromptVersion } = await import('../../db/index.js');
                        await savePromptVersion(version, optimizedPrompt, promptName, 0);
                        console.log(`[TrainingPipeline] Saved optimized prompt ${version}: ${promptName}`);
                    } catch (error) {
                        console.warn(`[TrainingPipeline] Could not save prompt to DB:`, error.message);
                    } finally {
                        // Restore simulation mode if it was set
                        if (originalSimMode) {
                            process.env.SIMULATION_MODE = originalSimMode;
                        }
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
     * Run multi-arm bandit with Thompson Sampling (replaces A/B testing)
     * @param {boolean} skipSimulations - If true, analyze existing data instead of running new simulations
     */
    async runMultiArmBandit(optimizedPrompts, skipSimulations = false) {
        if (optimizedPrompts.length === 0) {
            console.log('[TrainingPipeline] No optimized prompts to test');
            return { tests: [], winner: null };
        }

        const results = {
            tests: [],
            winner: null
        };

        if (skipSimulations) {
            // Analyze existing feedback data using Thompson Sampling
            console.log('[TrainingPipeline] Skipping simulations - analyzing existing feedback data with Thompson Sampling');
            for (const promptData of optimizedPrompts) {
                try {
                    const testResult = await this._analyzeExistingDataForBandit('current', promptData.version);

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
            // Get all available scenarios for diversity (including generated ones)
            const { getScenarios } = await import('../simulation/scenarios.js');
            const allScenarioMap = getScenarios({ includeGenerated: true });
            const allScenarios = Object.keys(allScenarioMap);

            for (const promptData of optimizedPrompts) {
                try {
                    // Determine target scenarios for this optimization
                    // If the opportunity specifies a target metric or description that links to a scenario type
                    let targetTags = [];
                    if (promptData.targetMetric === 'escalationEffectiveness' || (promptData.description && promptData.description.toLowerCase().includes('escalat'))) {
                        targetTags.push('escalation'); // Use scenarios with 'escalation' in name/desc
                    }
                    if (promptData.type === 'low_conversation_quality') {
                        // General improvements should be tested broadly, maybe 'complex' scenarios
                        targetTags.push('complex');
                    }

                    // Calculate total scenarios needed
                    const runsPerVersion = this.maxRunsPerTest || 2; // Configurable via constructor
                    const maxScenariosToUse = this.maxScenariosPerTest || allScenarios.length; // Limit scenarios if needed

                    // Use Mix Mode to select scenarios (10% targeted, 90% random by default)
                    const limitedScenarios = maxScenariosToUse < allScenarios.length ?
                        allScenarios.slice(0, maxScenariosToUse) : allScenarios;

                    const mixedSelection = this._selectMixedScenarios(
                        limitedScenarios,
                        targetTags,
                        Math.min(runsPerVersion, limitedScenarios.length)
                    );

                    const diverseScenarios = mixedSelection.all;

                    console.log(`[TrainingPipeline] Using ${diverseScenarios.length} diverse scenarios for multi-arm bandit (from ${limitedScenarios.length} available, filtered from ${allScenarios.length} total)`);

                    // Multi-arm bandit with Thompson Sampling (Contextual)
                    const versions = ['current', promptData.version];

                    // Fetch historical stats for persistence (Segmented by context)
                    console.log('[TrainingPipeline] Fetching historical stats for Contextual Bandit...');
                    const initialStatsByType = await this._getHistoricalStatsByContext(versions);

                    const bandit = new ContextualBandit(versions, {
                        minSamples: runsPerVersion || 2,
                        priorStatsByType: initialStatsByType
                    });

                    // Run simulations and update Bandit
                    const testResult = await this._runContextualBanditTest(
                        bandit,
                        versions,
                        diverseScenarios,
                        promptData
                    );

                    results.tests.push({
                        ...promptData,
                        testResult
                    });

                    // Determine winner based on Global statistics (Overall Performance)
                    const stats = bandit.getAllStatistics().global;
                    const bestVersion = stats.sort((a, b) => b.expectedValue - a.expectedValue)[0];

                    if (bestVersion.version === promptData.version) {
                        results.winner = {
                            ...promptData,
                            testResult: {
                                score: bestVersion.expectedValue,
                                stats: stats
                            }
                        };
                    }
                } catch (error) {
                    console.warn(`[TrainingPipeline] Multi-arm bandit test failed for ${promptData.type}:`, error.message);
                }
            }
        }

        return results;
    }

    /**
     * Get historical statistics grouped by context (category)
     * @private
     */
    async _getHistoricalStatsByContext(versions) {
        if (!versions || versions.length === 0) return {};

        try {
            const placeholders = versions.map(() => '?').join(',');
            // Query DB for aggregate stats grouped by category (context)
            // Note: category column in feedback table stores personaKey (context)
            const rows = await this.db.all(`
                SELECT 
                    category,
                    prompt_version,
                    COUNT(*) as total,
                    SUM(CASE WHEN score > 0.5 THEN 1 ELSE 0 END) as successes,
                    SUM(CASE WHEN score <= 0.5 THEN 1 ELSE 0 END) as failures
                FROM feedback
                WHERE prompt_version IN (${placeholders}) OR prompt_version IS NULL OR prompt_version = 'current'
                GROUP BY category, prompt_version
            `, versions);

            const statsByType = {};

            rows.forEach(row => {
                // Construct context key for ContextualBandit
                // We assume category in DB maps to "persona:KEY" part of context key
                // ContextualBandit expects keys like "persona:anxious_patient" or "global"

                // Determine context key:
                // If category is present, prefix with "persona:" (unless it's already structured)
                // For now, let's assume category IS the personaKey.
                // ContextualBandit _generateContextKey output for {personaCategory: 'foo'} is "persona:foo"
                let contextKey = 'global';
                if (row.category) {
                    contextKey = `persona:${row.category}`;
                }

                if (!statsByType[contextKey]) {
                    statsByType[contextKey] = {};
                }

                // Map 'current' or NULL to 'current' version
                const version = (row.prompt_version === 'current' || row.prompt_version === null) ? 'current' : row.prompt_version;

                statsByType[contextKey][version] = {
                    successes: row.successes,
                    failures: row.failures,
                    totalSamples: row.total
                };
            });

            // Also fetch GLOBAL stats (aggregated across all categories)
            const globalStats = await this._getHistoricalStats(versions);
            statsByType['global'] = globalStats;

            return statsByType;
        } catch (error) {
            console.warn('[TrainingPipeline] Failed to get historical stats by context:', error.message);
            return {};
        }
    }

    /**
     * Run Contextual Bandit test (replaces _runThompsonSamplingTest)
     * @private
     */
    async _runContextualBanditTest(bandit, versions, scenarios, promptData) {
        const results = {
            versionResults: {},
            totalRuns: 0
        };

        const originalSimulationMode = process.env.SIMULATION_MODE;
        process.env.SIMULATION_MODE = 'true';

        for (const scenario of scenarios) {
            // Get scenario config
            const { config: scenarioConfig, isWorld: isWorldScenario } = await this._getScenarioConfig(scenario);

            // Determine Context
            // We need to extract persona info to build the context object
            // Scenario config has 'users' array. We take the first user's persona or role.
            let context = { complexity: scenarioConfig.complexity || 1 };

            if (scenarioConfig.users && scenarioConfig.users.length > 0) {
                const user = scenarioConfig.users[0];
                // Use personaKey if available, otherwise role
                context.personaCategory = user.personaKey || user.role || 'patient';
            }

            // Select version using Contextual Bandit
            const selectedVersion = bandit.selectVersion(context);

            // Set prompt version
            const originalEnv = process.env.PROMPT_VERSION;
            process.env.PROMPT_VERSION = selectedVersion === 'current' ? null : selectedVersion;

            let simulator;
            if (isWorldScenario) {
                const { WorldSimulator } = await import('../world_simulation/world_simulator.js');
                simulator = new WorldSimulator();
            } else {
                const { SimulationDriver } = await import('../simulation/simulator.js');
                simulator = new SimulationDriver();
            }

            try {
                await simulator.runScenario(scenarioConfig, scenario);

                // Get Feedback Score (Reuse logic from _runThompsonSamplingTest)
                const db = simulator.db;
                let conversationIds = [simulator.conversationId];
                if (simulator.conversationIds?.length > 0) conversationIds = simulator.conversationIds;

                const placeholders = conversationIds.map(() => '?').join(',');
                const feedback = await db.all(`
                    SELECT score, goal_adherence_score, goal_history_score, goal_conversation_score
                    FROM feedback
                    WHERE conversation_id IN (${placeholders}) 
                    AND (prompt_version = ? OR prompt_version IS NULL)
                    ORDER BY timestamp DESC
                    LIMIT 50
                `, [...conversationIds, selectedVersion === 'current' ? null : selectedVersion]);

                const avgScore = feedback.length > 0
                    ? feedback.reduce((sum, f) => sum + (f.score || 0), 0) / feedback.length
                    : 0;

                const weightedScore = avgScore * 0.6 +
                    (feedback.length > 0 ? feedback.reduce((sum, f) =>
                        sum + (f.goal_adherence_score || 0) + (f.goal_history_score || 0) + (f.goal_conversation_score || 0), 0) / feedback.length / 3 : 0) * 0.4;

                // Comparative Score Logic
                const comparativeScore = await this._calculateComparativeScore(conversationIds[0], db);
                const comparativeWeight = 0.2;
                const finalScore = weightedScore * (1 - comparativeWeight) +
                    (comparativeScore.relativeIntelligence * weightedScore) * comparativeWeight;

                const reward = finalScore > 0 ? true : false;

                // Update Contextual Bandit
                bandit.updateReward(selectedVersion, reward, context);

                // Track results
                if (!results.versionResults[selectedVersion]) {
                    results.versionResults[selectedVersion] = { runs: 0, successes: 0, totalScore: 0 };
                }
                results.versionResults[selectedVersion].runs++;
                results.versionResults[selectedVersion].totalScore += weightedScore;
                if (reward) results.versionResults[selectedVersion].successes++;
                results.totalRuns++;

                if (simulator.cleanup) await simulator.cleanup();

            } catch (error) {
                console.warn(`[TrainingPipeline] Simulation failed for ${scenario}:`, error.message);
                bandit.updateReward(selectedVersion, false, context);
            } finally {
                if (originalEnv !== undefined) process.env.PROMPT_VERSION = originalEnv;
                else delete process.env.PROMPT_VERSION;
            }
        }

        if (originalSimulationMode !== undefined) process.env.SIMULATION_MODE = originalSimulationMode;
        else delete process.env.SIMULATION_MODE;

        // Return standardized results based on GLOBAL stats for compatibility
        const stats = bandit.getAllStatistics().global;
        return {
            stats: stats,
            versionResults: results.versionResults
        };
    }

    /**
     * Select mixed scenarios using Mix Mode (targeted + random split)
     * Implements 10/90 split by default to prevent overfitting
     * @param {Array} allScenarios - All available scenario keys
     * @param {Array} targetTags - Tags for targeted scenario selection
     * @param {number} totalScenarios - Total number of scenarios to select
     * @returns {Object} { targeted: [...], random: [...], all: [...], allScenarios: Object }
     * @private
     */
    _selectMixedScenarios(allScenarios, targetTags, totalScenarios) {
        const targetedCount = Math.ceil(totalScenarios * this.mixModeRatio.targeted);
        const randomCount = totalScenarios - targetedCount;

        const result = {
            targeted: [],
            random: [],
            all: []
        };

        // Step 1: Select targeted scenarios if tags are provided
        if (targetTags.length > 0) {
            const taggedScenarios = allScenarios.filter(s => {
                const name = s.toLowerCase();
                return targetTags.some(t => name.includes(t));
            });

            if (taggedScenarios.length > 0) {
                // Randomly select from tagged scenarios
                const shuffled = [...taggedScenarios].sort(() => Math.random() - 0.5);
                result.targeted = shuffled.slice(0, Math.min(targetedCount, taggedScenarios.length));
            }
        }

        // Step 2: Select random scenarios from the full pool (excluding already selected targeted ones)
        const availableForRandom = allScenarios.filter(s => !result.targeted.includes(s));
        const shuffledRandom = [...availableForRandom].sort(() => Math.random() - 0.5);
        result.random = shuffledRandom.slice(0, randomCount);

        // Step 3: Combine both sets
        result.all = [...result.targeted, ...result.random];

        console.log(`[TrainingPipeline] Mix Mode: ${result.targeted.length} targeted + ${result.random.length} random = ${result.all.length} total scenarios`);
        if (result.targeted.length > 0) {
            console.log(`[TrainingPipeline] Targeted scenarios (${targetTags.join(', ')}): ${result.targeted.join(', ')}`);
        }

        return result;
    }

    /**
     * Get scenario config from unified SCENARIOS (including generated ones)
     * Returns both the config and whether it's a world scenario (based on circles field)
     * @private
     */
    async _getScenarioConfig(scenarioKey) {
        const { getScenarios, isWorldScenario } = await import('../simulation/scenarios.js');

        // We need to fetch all scenarios including generated ones to lookup the key
        const allScenarios = getScenarios({ includeGenerated: true });

        const config = allScenarios[scenarioKey];
        if (!config) {
            throw new Error(`Scenario ${scenarioKey} not found in SCENARIOS`);
        }

        return { config, isWorld: isWorldScenario(config) };
    }

    /**
     * Run Thompson Sampling test for a prompt
     * @private
     */
    async _runThompsonSamplingTest(thompsonSampling, versions, scenarios, promptData) {
        const results = {
            versionResults: {},
            totalRuns: 0
        };

        // Set simulation mode for all simulations
        const originalSimulationMode = process.env.SIMULATION_MODE;
        process.env.SIMULATION_MODE = 'true';

        // Run simulations for each scenario, using Thompson Sampling to select versions
        for (const scenario of scenarios) {
            // Get scenario config and type
            const { config: scenarioConfig, isWorld: isWorldScenario } = await this._getScenarioConfig(scenario);

            // Select version using Thompson Sampling
            const selectedVersion = thompsonSampling.selectVersion();

            // Set prompt version for this simulation
            const originalEnv = process.env.PROMPT_VERSION;
            process.env.PROMPT_VERSION = selectedVersion === 'current' ? null : selectedVersion;

            // Create appropriate simulator for this scenario
            let simulator;
            if (isWorldScenario) {
                const { WorldSimulator } = await import('../world_simulation/world_simulator.js');
                simulator = new WorldSimulator();
            } else {
                const { SimulationDriver } = await import('../simulation/simulator.js');
                simulator = new SimulationDriver();
            }

            try {
                const startTime = Date.now();

                await simulator.runScenario(scenarioConfig, scenario);

                const duration = Date.now() - startTime;

                // Get score from feedback (simulation stores feedback in database)
                // Query feedback table for this conversation
                const db = simulator.db;

                // For world simulations, we need to query all conversation IDs
                let conversationIds = [simulator.conversationId];
                if (simulator.conversationIds && simulator.conversationIds.length > 0) {
                    // World simulation has multiple circles = multiple conversation IDs
                    conversationIds = simulator.conversationIds;
                }

                // Query feedback for all conversation IDs in this simulation
                const placeholders = conversationIds.map(() => '?').join(',');
                const feedback = await db.all(`
                    SELECT score, goal_adherence_score, goal_history_score, goal_conversation_score
                    FROM feedback
                    WHERE conversation_id IN (${placeholders}) 
                    AND (prompt_version = ? OR prompt_version IS NULL)
                    ORDER BY timestamp DESC
                    LIMIT 50
                `, [...conversationIds, selectedVersion === 'current' ? null : selectedVersion]);

                // Calculate average score from feedback
                const avgScore = feedback.length > 0
                    ? feedback.reduce((sum, f) => sum + (f.score || 0), 0) / feedback.length
                    : 0;

                // Use weighted score: feedback score + goal scores
                const weightedScore = avgScore * 0.6 +
                    (feedback.length > 0 ? feedback.reduce((sum, f) =>
                        sum + (f.goal_adherence_score || 0) + (f.goal_history_score || 0) + (f.goal_conversation_score || 0), 0) / feedback.length / 3 : 0) * 0.4;

                // Calculate Comparative Score (Relative Intelligence: Agent vs Synthetic User)
                const comparativeScore = await this._calculateComparativeScore(conversationIds[0], db);

                // Log comparative metrics
                if (comparativeScore.relativeIntelligence !== 1.0) {
                    console.log(`[TrainingPipeline] Comparative Score: Agent=${comparativeScore.agentEffectiveness.toFixed(2)}, User=${comparativeScore.syntheticUserEffectiveness.toFixed(2)}, Relative Intelligence=${comparativeScore.relativeIntelligence.toFixed(2)}`);
                }

                // Integrate comparative score into final weighted score
                // If Relative Intelligence > 1.0, Agent is outperforming Synthetic User (boost score)
                // If Relative Intelligence < 1.0, Synthetic User is outperforming Agent (penalize score)
                const comparativeWeight = 0.2; // 20% weight for comparative scoring
                const finalScore = weightedScore * (1 - comparativeWeight) +
                    (comparativeScore.relativeIntelligence * weightedScore) * comparativeWeight;

                const reward = finalScore > 0 ? true : false; // Convert to boolean for Thompson Sampling

                // Update Thompson Sampling
                thompsonSampling.updateReward(selectedVersion, reward);

                // Track results
                if (!results.versionResults[selectedVersion]) {
                    results.versionResults[selectedVersion] = {
                        runs: 0,
                        successes: 0,
                        totalScore: 0
                    };
                }
                results.versionResults[selectedVersion].runs++;
                results.versionResults[selectedVersion].totalScore += weightedScore;
                if (reward) {
                    results.versionResults[selectedVersion].successes++;
                }
                results.totalRuns++;

                // Cleanup simulator
                if (simulator.cleanup) {
                    await simulator.cleanup();
                }

            } catch (error) {
                console.warn(`[TrainingPipeline] Simulation failed for ${scenario}:`, error.message);
                // Update as failure
                thompsonSampling.updateReward(selectedVersion, false);
            } finally {
                // Restore original prompt version
                if (originalEnv !== undefined) {
                    process.env.PROMPT_VERSION = originalEnv;
                } else {
                    delete process.env.PROMPT_VERSION;
                }
            }
        }

        // Restore original simulation mode
        if (originalSimulationMode !== undefined) {
            process.env.SIMULATION_MODE = originalSimulationMode;
        } else {
            delete process.env.SIMULATION_MODE;
        }

        // Calculate final scores
        const stats = thompsonSampling.getStatistics();
        const baselineStats = stats.find(s => s.version === 'current');
        const challengerStats = stats.find(s => s.version === promptData.version);

        return {
            baselineScore: baselineStats?.expectedValue || 0,
            challengerScore: challengerStats?.expectedValue || 0,
            score: challengerStats?.expectedValue || 0, // For compatibility
            stats: stats,
            versionResults: results.versionResults
        };
    }

    /**
     * Calculate Comparative Score (Relative Intelligence: Agent vs Synthetic User)
     * Measures how effective the Agent is compared to the Synthetic User in achieving goals
     * @param {string} conversationId - The conversation ID to analyze
     * @param {Object} db - Database connection
     * @returns {Promise<Object>} Comparative score metrics
     * @private
     */
    async _calculateComparativeScore(conversationId, db) {
        try {
            // Query messages to get Agent and Synthetic User turns
            const messages = await db.all(`
                SELECT role, message, timestamp
                FROM messages
                WHERE circle_id = ?
                ORDER BY timestamp ASC
            `, [conversationId]);

            if (messages.length === 0) {
                return {
                    agentEffectiveness: 0,
                    syntheticUserEffectiveness: 0,
                    relativeIntelligence: 1.0, // Neutral if no data
                    agentTurns: 0,
                    userTurns: 0
                };
            }

            // Separate Agent and Synthetic User messages
            const agentMessages = messages.filter(m => m.role.includes('agent'));
            const userMessages = messages.filter(m => !m.role.includes('agent'));

            // Query feedback scores for this conversation
            const feedback = await db.all(`
                SELECT score, goal_adherence_score, goal_history_score, goal_conversation_score
                FROM feedback
                WHERE conversation_id = ?
            `, [conversationId]);

            // Calculate Agent effectiveness (based on feedback scores)
            const avgFeedbackScore = feedback.length > 0
                ? feedback.reduce((sum, f) => sum + (f.score || 0), 0) / feedback.length
                : 0;

            const avgGoalScore = feedback.length > 0
                ? feedback.reduce((sum, f) =>
                    sum + (f.goal_adherence_score || 0) + (f.goal_history_score || 0) + (f.goal_conversation_score || 0), 0
                ) / feedback.length / 3
                : 0;

            const agentEffectiveness = (avgFeedbackScore + avgGoalScore) / 2;

            // Calculate Synthetic User effectiveness (based on message quality heuristics)
            // Heuristics:
            // 1. Message length variation (good conversations have varied message lengths)
            // 2. Response relevance (measured by lack of repetition)
            // 3. Engagement (number of turns)

            const userMessageLengths = userMessages.map(m => m.message.length);
            const avgUserLength = userMessageLengths.reduce((sum, len) => sum + len, 0) / userMessageLengths.length || 0;
            const userLengthVariance = userMessageLengths.reduce((sum, len) =>
                sum + Math.pow(len - avgUserLength, 2), 0) / userMessageLengths.length || 0;

            // Normalize variance to 0-1 scale (higher variance = more natural conversation)
            const normalizedVariance = Math.min(userLengthVariance / 10000, 1.0);

            // Check for repetition (simple heuristic: unique messages / total messages)
            const uniqueUserMessages = new Set(userMessages.map(m => m.message.toLowerCase().trim()));
            const repetitionScore = uniqueUserMessages.size / userMessages.length || 0;

            // Engagement score (more turns = better engagement, capped at 1.0)
            const engagementScore = Math.min(userMessages.length / 10, 1.0);

            // Combine heuristics for Synthetic User effectiveness
            const syntheticUserEffectiveness = (normalizedVariance * 0.3 + repetitionScore * 0.4 + engagementScore * 0.3);

            // Calculate Relative Intelligence (Agent / Synthetic User)
            // Values > 1.0 mean Agent is more effective than Synthetic User
            // Values < 1.0 mean Synthetic User is more effective (Agent needs improvement)
            const relativeIntelligence = syntheticUserEffectiveness > 0
                ? agentEffectiveness / syntheticUserEffectiveness
                : agentEffectiveness; // If no user effectiveness, use agent score directly

            return {
                agentEffectiveness: agentEffectiveness,
                syntheticUserEffectiveness: syntheticUserEffectiveness,
                relativeIntelligence: relativeIntelligence,
                agentTurns: agentMessages.length,
                userTurns: userMessages.length,
                feedbackCount: feedback.length
            };
        } catch (error) {
            console.warn(`[TrainingPipeline] Failed to calculate comparative score for ${conversationId}:`, error.message);
            return {
                agentEffectiveness: 0,
                syntheticUserEffectiveness: 0,
                relativeIntelligence: 1.0,
                agentTurns: 0,
                userTurns: 0,
                error: error.message
            };
        }
    }

    /**
     * Analyze existing feedback data for multi-arm bandit comparison
     * Reuses FeedbackAnalyzer to avoid code duplication
     */
    async _analyzeExistingDataForBandit(baselineVersion, challengerVersion) {
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
