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

            // Determine Context
            let context = { complexity: scenarioConfig.complexity || 1 };
            if (scenarioConfig.users && scenarioConfig.users.length > 0) {
                const user = scenarioConfig.users[0];
                context.personaCategory = user.personaKey || user.role || 'patient';
            }

            // Select version
            const selectedVersion = bandit.selectVersion(context);

            // Set prompt version Environment Variable (Serial execution is required here)
            process.env.PROMPT_VERSION = selectedVersion;

            let simulator;
            // Dynamically import to ensure fresh instance/config if needed, though class is exported
            const { SimulationDriver } = await import('../../simulation/simulator.js');
            simulator = new SimulationDriver(); // Will use centralized DB path from config now

            try {
                console.log(`[BanditManager] Testing version '${selectedVersion}' on scenario: ${scenario}`);
                await simulator.runScenario(scenarioConfig, scenario);

                // Feedback collection would typically happen here or be read from DB
                // For simplicity in this loop, we assume the DB was updated

                // We need to fetch the result to update the bandit reward
                // but since the simulator just ran, we can check the *latest* feedback for this conversation
                const { getDb } = await import('../../db/connection.js');
                const db = await getDb();

                // Get latest score for this scenario run
                const feedback = await db.get(`
                    SELECT AVG(score) as avg_score, COUNT(*) as count 
                    FROM feedback 
                    WHERE conversation_id LIKE ? 
                    ORDER BY timestamp DESC
                `, [`%${scenario}%`]); // Loose match on conversation ID which contains scenario key

                const success = feedback && feedback.avg_score > 0.5;
                bandit.updateReward(selectedVersion, success, context);

                if (!results.versionResults[selectedVersion]) {
                    results.versionResults[selectedVersion] = { successes: 0, failures: 0, total: 0 };
                }
                results.versionResults[selectedVersion].total++;
                if (success) results.versionResults[selectedVersion].successes++;
                else results.versionResults[selectedVersion].failures++;

            } catch (error) {
                console.warn(`[BanditManager] Simulation failed for ${scenario}:`, error.message);
                bandit.updateReward(selectedVersion, false, context);
            } finally {
                if (simulator && simulator.cleanup) await simulator.cleanup();
                delete process.env.PROMPT_VERSION;
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
