/**
 * @fileoverview Component for Multi-Arm Bandit logic (Thompson Sampling)
 */

import { ContextualBandit } from '../contextual_bandit.js';

export class BanditManager {
    constructor(db) {
        this.db = db;
        this.maxRunsPerTest = 5; // Default reference, can be overridden
    }

    setDb(db) {
        this.db = db;
    }

    /**
     * Run multi-arm bandit with Thompson Sampling
     */
    async runMultiArmBandit(optimizedPrompts, pipeline, skipSimulations = false) {
        if (optimizedPrompts.length === 0) {
            console.log('[BanditManager] No optimized prompts to test');
            return { tests: [], winner: null };
        }

        const results = {
            tests: [],
            winner: null
        };

        if (skipSimulations) {
            console.log('[BanditManager] Skipping simulations - analyzing existing feedback data with Thompson Sampling');
            // This would call a method to analyze existing data - implementing simplified placeholder or moving logic here
            // For now assuming simulation path is primary
        } else {
            // Get scenarios via pipeline or directly
            const { getScenarios } = await import('../../simulation/scenarios.js');
            const allScenarioMap = getScenarios({ includeGenerated: true });
            const allScenarios = Object.keys(allScenarioMap);

            for (const promptData of optimizedPrompts) {
                try {
                    // Determine target scenarios
                    let targetTags = [];
                    if (promptData.targetMetric === 'escalationEffectiveness' || (promptData.description && promptData.description.toLowerCase().includes('escalat'))) {
                        targetTags.push('escalation');
                    }
                    if (promptData.type === 'low_conversation_quality') {
                        targetTags.push('complex');
                    }

                    // Select Scenarios using pipeline's helper or internal logic if moved
                    // Accessing pipeline helper for mix mode to respect compilation
                    const runsPerVersion = pipeline.maxRunsPerTest || this.maxRunsPerTest;
                    const maxScenariosToUse = pipeline.maxScenariosPerTest || allScenarios.length;

                    const limitedScenarios = maxScenariosToUse < allScenarios.length ?
                        allScenarios.slice(0, maxScenariosToUse) : allScenarios;

                    const mixedSelection = pipeline._selectMixedScenarios(
                        limitedScenarios,
                        targetTags,
                        Math.min(runsPerVersion, limitedScenarios.length)
                    );
                    const diverseScenarios = mixedSelection.all;

                    console.log(`[BanditManager] Using ${diverseScenarios.length} diverse scenarios for multi-arm bandit`);

                    // Contextual Bandit Setup
                    const versions = ['current', promptData.version];
                    console.log('[BanditManager] Fetching historical stats for Contextual Bandit...');
                    const initialStatsByType = await this._getHistoricalStatsByContext(versions);

                    const bandit = new ContextualBandit(versions, {
                        minSamples: runsPerVersion || 2,
                        priorStatsByType: initialStatsByType
                    });

                    // Run simulations
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

                    // Determine Winner
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
                    console.warn(`[BanditManager] Multi-arm bandit test failed for ${promptData.type}:`, error.message);
                }
            }
        }

        return results;
    }

    /**
     * Run Contextual Bandit test
     */
    async _runContextualBanditTest(bandit, versions, scenarios, promptData) {
        const results = {
            versionResults: {},
            totalRuns: 0
        };

        const originalSimulationMode = process.env.SIMULATION_MODE;
        process.env.SIMULATION_MODE = 'true';

        for (const scenario of scenarios) {
            // Get config
            const { getScenarios } = await import('../../simulation/scenarios.js');
            const scenarioMap = getScenarios({ includeGenerated: true });
            const scenarioConfig = scenarioMap[scenario];
            const isWorldScenario = false; // logic simplified for component

            // Determine Context
            let context = { complexity: scenarioConfig.complexity || 1 };
            if (scenarioConfig.users && scenarioConfig.users.length > 0) {
                const user = scenarioConfig.users[0];
                context.personaCategory = user.personaKey || user.role || 'patient';
            }

            // Select version
            const selectedVersion = bandit.selectVersion(context);

            // Set prompt version
            const originalEnv = process.env.PROMPT_VERSION;
            process.env.PROMPT_VERSION = selectedVersion === 'current' ? null : selectedVersion;

            let simulator;
            // Dynamic import to avoid circular dependency issues at top level if any
            const { SimulationDriver } = await import('../../simulation/simulator.js');
            simulator = new SimulationDriver();

            try {
                await simulator.runScenario(scenarioConfig, scenario);

                // Get Feedback Score
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

                // Weighted score
                const weightedScore = avgScore * 0.6 +
                    (feedback.length > 0 ? feedback.reduce((sum, f) =>
                        sum + (f.goal_adherence_score || 0) + (f.goal_history_score || 0) + (f.goal_conversation_score || 0), 0) / feedback.length / 3 : 0) * 0.4;

                const reward = weightedScore > 0;

                // Update Bandit
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
                console.warn(`[BanditManager] Simulation failed for ${scenario}:`, error.message);
                bandit.updateReward(selectedVersion, false, context);
            } finally {
                if (originalEnv !== undefined) process.env.PROMPT_VERSION = originalEnv;
                else delete process.env.PROMPT_VERSION;
            }
        }

        if (originalSimulationMode !== undefined) process.env.SIMULATION_MODE = originalSimulationMode;
        else delete process.env.SIMULATION_MODE;

        const stats = bandit.getAllStatistics().global;
        return {
            stats: stats,
            versionResults: results.versionResults
        };
    }

    /**
     * Get historical statistics grouped by context
     */
    async _getHistoricalStatsByContext(versions) {
        if (!versions || versions.length === 0) return {};

        try {
            const placeholders = versions.map(() => '?').join(',');
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
                let contextKey = 'global';
                if (row.category) {
                    contextKey = `persona:${row.category}`;
                }

                if (!statsByType[contextKey]) statsByType[contextKey] = {};

                const version = (row.prompt_version === 'current' || row.prompt_version === null) ? 'current' : row.prompt_version;

                statsByType[contextKey][version] = {
                    successes: row.successes,
                    failures: row.failures,
                    totalSamples: row.total
                };
            });

            // Also fetch GLOBAL stats
            const globalStats = await this._getHistoricalStats(versions);
            statsByType['global'] = globalStats;

            return statsByType;
        } catch (error) {
            console.warn('[BanditManager] Failed to get historical stats by context:', error.message);
            return {};
        }
    }

    /**
     * Get historical statistics (Global)
     */
    async _getHistoricalStats(versions) {
        if (!versions || versions.length === 0) return {};
        try {
            const placeholders = versions.map(() => '?').join(',');
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
            console.warn('[BanditManager] Failed to get historical stats:', error.message);
            return {};
        }
    }
}
