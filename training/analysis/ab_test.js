/**
 * @fileoverview training/ab_test.js
 * A/B testing framework for comparing prompt versions.
 * Runs simulations with both versions and compares performance.
 */

import { SimulationDriver } from '../simulation/simulator.js';
import { FeedbackAnalyzer } from './feedback_analyzer.js';
import { SCENARIOS } from '../simulation/scenarios.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class ABTest {
    constructor(options = {}) {
        this.baselineVersion = options.baseline;
        this.challengerVersion = options.challenger;
        this.runsPerVersion = options.runs || 10;
        this.scenarios = options.scenarios || [];
        this.results = {
            baseline: [],
            challenger: []
        };
    }

    /**
     * Run A/B test comparing two prompt versions
     */
    async runTest(testName) {
        // Get descriptive names for prompt versions
        const baselineName = this._getPromptVersionName(this.baselineVersion);
        const challengerName = this._getPromptVersionName(this.challengerVersion);
        
        console.log('\n' + '█'.repeat(80));
        console.log(`  A/B TEST: ${testName}`);
        console.log('█'.repeat(80));
        console.log(`\nBaseline Prompt:`);
        console.log(`  Name: ${baselineName}`);
        console.log(`  Version: ${this.baselineVersion}`);
        console.log(`\nChallenger Prompt:`);
        console.log(`  Name: ${challengerName}`);
        console.log(`  Version: ${this.challengerVersion}`);
        console.log(`Runs: ${this.runsPerVersion} simulations per prompt version`);
        console.log(`Scenarios: ${this.scenarios.length > 0 ? this.scenarios.join(', ') : 'Random selection'}`);
        console.log('\n' + '─'.repeat(80) + '\n');

        // Run baseline
        console.log('🔵 Running BASELINE version...\n');
        const baselineResults = await this._runVersion('baseline', this.baselineVersion);
        
        // Run challenger
        console.log('\n🟢 Running CHALLENGER version...\n');
        const challengerResults = await this._runVersion('challenger', this.challengerVersion);

        // Compare results
        console.log('\n' + '─'.repeat(80));
        const comparison = await this._compareResults(baselineResults, challengerResults);
        
        // Generate report
        await this._generateReport(testName, baselineResults, challengerResults, comparison);

        return comparison;
    }

    /**
     * Run simulations for a specific version
     */
    async _runVersion(versionName, promptVersion) {
        const results = {
            version: versionName,
            promptVersion: promptVersion,
            runs: [],
            totalDuration: 0,
            successCount: 0,
            failureCount: 0
        };

        // Map scenario names (strings) to actual scenario objects
        const scenarioObjects = [];
        for (let i = 0; i < this.scenarios.length; i++) {
            const scenarioName = this.scenarios[i];
            const scenarioObj = SCENARIOS[scenarioName];
            if (scenarioObj) {
                scenarioObjects.push(scenarioObj);
            } else {
                console.warn(`Warning: Scenario "${scenarioName}" not found in SCENARIOS`);
            }
        }

        for (let i = 0; i < this.runsPerVersion; i++) {
            console.log(`  [${i + 1}/${this.runsPerVersion}] Running simulation...`);
            
            // Select scenario: random from SCENARIOS if none provided, otherwise use provided scenarios
            let scenario, scenarioKey;
            if (scenarioObjects.length > 0) {
                scenario = scenarioObjects[i % scenarioObjects.length];
                scenarioKey = this.scenarios[i % this.scenarios.length];
            } else {
                // Pick scenario from provided list (ensuring diversity across runs)
                // If scenarios array was provided, cycle through them for diversity
                if (this.scenarios && this.scenarios.length > 0) {
                    // Cycle through scenarios to maximize diversity
                    const scenarioIndex = i % this.scenarios.length;
                    scenarioKey = this.scenarios[scenarioIndex];
                    scenario = SCENARIOS[scenarioKey];
                    
                    if (!scenario) {
                        // Fallback to random if scenario not found
                        const allScenarioKeys = Object.keys(SCENARIOS);
                        const randomKey = allScenarioKeys[Math.floor(Math.random() * allScenarioKeys.length)];
                        scenario = SCENARIOS[randomKey];
                        scenarioKey = randomKey;
                    }
                } else {
                    // No scenarios specified - pick random for diversity
                    const allScenarioKeys = Object.keys(SCENARIOS);
                    const randomKey = allScenarioKeys[Math.floor(Math.random() * allScenarioKeys.length)];
                    scenario = SCENARIOS[randomKey];
                    scenarioKey = randomKey;
                }
            }
            
            const simulator = new SimulationDriver({ 
                logResults: true,
                promptVersion: promptVersion
            });

            try {
                const startTime = Date.now();
                
                await simulator.runScenario(scenario, scenarioKey);
                
                const duration = Date.now() - startTime;
                results.totalDuration += duration;
                results.successCount++;
                
                results.runs.push({
                    runId: i + 1,
                    scenario: scenario.name,
                    success: true,
                    duration,
                    timestamp: Date.now()
                });

                console.log(`    ✓ Complete (${(duration / 1000).toFixed(1)}s)\n`);
            } catch (error) {
                console.error(`    ✗ Failed: ${error.message}\n`);
                results.failureCount++;
                results.runs.push({
                    runId: i + 1,
                    scenario: scenario?.name || 'unknown',
                    success: false,
                    error: error.message,
                    timestamp: Date.now()
                });
            } finally {
                await simulator.cleanup();
            }
        }

        results.averageDuration = results.totalDuration / Math.max(results.successCount, 1);
        
        return results;
    }

    /**
     * Get default scenario for testing
     */
    _getDefaultScenario(index) {
        const personas = ['medication_nonadherent', 'anxious_patient', 'denial_prone', 'elderly_cognitive'];
        const persona = personas[index % personas.length];
        
        return {
            name: `Test Scenario ${index + 1}`,
            users: [
                { userId: `test_patient_${index}`, role: 'patient', personaKey: persona }
            ],
            circle: {
                patientId: `test_patient_${index}`,
                caregiverIds: []
            },
            turns: 5
        };
    }

    /**
     * Compare results between baseline and challenger
     * Includes quality metrics from feedback analysis
     */
    async _compareResults(baseline, challenger) {
        const comparison = {
            winner: null,
            confidence: 0,
            metrics: {},
            qualityMetrics: {}
        };

        // Get quality metrics from feedback database
        const { FeedbackAnalyzer } = await import('./feedback_analyzer.js');
        const feedbackAnalyzer = new FeedbackAnalyzer();
        
        // Get feedback scores for each version
        const baselineQuality = await this._getQualityMetrics(baseline.promptVersion);
        const challengerQuality = await this._getQualityMetrics(challenger.promptVersion);

        // Success rate (simulation completion)
        const baselineSuccessRate = baseline.successCount / this.runsPerVersion;
        const challengerSuccessRate = challenger.successCount / this.runsPerVersion;
        
        comparison.metrics.successRate = {
            baseline: baselineSuccessRate,
            challenger: challengerSuccessRate,
            improvement: baselineSuccessRate > 0 ? 
                (((challengerSuccessRate - baselineSuccessRate) / baselineSuccessRate * 100).toFixed(1) + '%') : 
                'N/A',
            winner: challengerSuccessRate > baselineSuccessRate ? 'challenger' : 
                    challengerSuccessRate < baselineSuccessRate ? 'baseline' : 'tie',
            description: 'Percentage of simulations that completed successfully without errors'
        };

        // Average duration
        comparison.metrics.avgDuration = {
            baseline: baseline.averageDuration,
            challenger: challenger.averageDuration,
            improvement: baseline.averageDuration > 0 ? 
                (((baseline.averageDuration - challenger.averageDuration) / baseline.averageDuration * 100).toFixed(1) + '%') : 
                'N/A',
            winner: challenger.averageDuration < baseline.averageDuration ? 'challenger' : 
                    challenger.averageDuration > baseline.averageDuration ? 'baseline' : 'tie',
            description: 'Average time per simulation (lower is better for latency)'
        };

        // Quality metrics from feedback
        comparison.qualityMetrics = {
            averageScore: {
                baseline: baselineQuality.avgScore || 0,
                challenger: challengerQuality.avgScore || 0,
                improvement: baselineQuality.avgScore !== 0 ? 
                    (((challengerQuality.avgScore - baselineQuality.avgScore) / Math.abs(baselineQuality.avgScore) * 100).toFixed(1) + '%') : 
                    'N/A',
                winner: challengerQuality.avgScore > baselineQuality.avgScore ? 'challenger' : 
                        challengerQuality.avgScore < baselineQuality.avgScore ? 'baseline' : 'tie',
                description: 'Average feedback score from simulation scoring (-2 to +2)'
            },
            criticalFailures: {
                baseline: baselineQuality.criticalFailures || 0,
                challenger: challengerQuality.criticalFailures || 0,
                improvement: `${challengerQuality.criticalFailures - baselineQuality.criticalFailures}`,
                winner: challengerQuality.criticalFailures < baselineQuality.criticalFailures ? 'challenger' : 
                        challengerQuality.criticalFailures > baselineQuality.criticalFailures ? 'baseline' : 'tie',
                description: 'Number of critical failures detected (lower is better)'
            },
            feedbackCount: {
                baseline: baselineQuality.count || 0,
                challenger: challengerQuality.count || 0,
                description: 'Number of feedback entries analyzed'
            }
        };

        // Determine overall winner using quality-weighted scoring
        // Quality metrics are more important than duration
        const qualityWeight = 0.7;
        const durationWeight = 0.1;
        const successWeight = 0.2;
        
        const baselineQualityScore = (baselineQuality.avgScore || 0) * qualityWeight;
        const challengerQualityScore = (challengerQuality.avgScore || 0) * qualityWeight;
        
        const baselineDurationPenalty = (baseline.averageDuration / 10000) * durationWeight;
        const challengerDurationPenalty = (challenger.averageDuration / 10000) * durationWeight;
        
        const baselineSuccessScore = baselineSuccessRate * successWeight;
        const challengerSuccessScore = challengerSuccessRate * successWeight;
        
        comparison.baselineScore = baselineQualityScore + baselineSuccessScore - baselineDurationPenalty;
        comparison.challengerScore = challengerQualityScore + challengerSuccessScore - challengerDurationPenalty;
        
        // Count metric wins
        const challengerWins = [
            comparison.metrics.successRate.winner === 'challenger',
            comparison.metrics.avgDuration.winner === 'challenger',
            comparison.qualityMetrics.averageScore.winner === 'challenger',
            comparison.qualityMetrics.criticalFailures.winner === 'challenger'
        ].filter(Boolean).length;
        
        const baselineWins = [
            comparison.metrics.successRate.winner === 'baseline',
            comparison.metrics.avgDuration.winner === 'baseline',
            comparison.qualityMetrics.averageScore.winner === 'baseline',
            comparison.qualityMetrics.criticalFailures.winner === 'baseline'
        ].filter(Boolean).length;
        
        // Determine winner based on quality score (primary) and metric wins (secondary)
        if (Math.abs(comparison.challengerScore - comparison.baselineScore) < 0.01) {
            // Scores are very close, use metric wins
            if (challengerWins > baselineWins) {
                comparison.winner = 'challenger';
                comparison.confidence = challengerWins / (challengerWins + baselineWins + 0.001);
            } else if (baselineWins > challengerWins) {
                comparison.winner = 'baseline';
                comparison.confidence = baselineWins / (challengerWins + baselineWins + 0.001);
            } else {
                comparison.winner = 'tie';
                comparison.confidence = 0.5;
            }
        } else if (comparison.challengerScore > comparison.baselineScore) {
            comparison.winner = 'challenger';
            const scoreDiff = comparison.challengerScore - comparison.baselineScore;
            comparison.confidence = Math.min(0.5 + (scoreDiff * 10), 1.0); // Scale to 0.5-1.0
        } else {
            comparison.winner = 'baseline';
            const scoreDiff = comparison.baselineScore - comparison.challengerScore;
            comparison.confidence = Math.min(0.5 + (scoreDiff * 10), 1.0); // Scale to 0.5-1.0
        }

        return comparison;
    }

    /**
     * Get quality metrics for a prompt version from feedback database
     */
    async _getQualityMetrics(promptVersion) {
        try {
            const { getDb } = await import('../../db/connection.js');
            const db = await getDb();
            
            // Query feedback for this prompt version
            const result = await db.get(`
                SELECT 
                    AVG(score) as avg_score,
                    COUNT(*) as count,
                    SUM(CASE WHEN critical_failure = 1 THEN 1 ELSE 0 END) as critical_failures
                FROM feedback 
                WHERE prompt_version = ? 
                AND source = 'simulation'
                AND timestamp > datetime('now', '-1 day')
            `, [promptVersion]);
            
            return {
                avgScore: result?.avg_score || 0,
                count: result?.count || 0,
                criticalFailures: result?.critical_failures || 0
            };
        } catch (error) {
            console.warn(`[ABTest] Failed to get quality metrics for ${promptVersion}:`, error.message);
            return { avgScore: 0, count: 0, criticalFailures: 0 };
        }
    }

    /**
     * Generate detailed report
     */
    async _generateReport(testName, baseline, challenger, comparison) {
        const timestamp = new Date().toISOString();
        
        const report = `# A/B Test Report: ${testName}

Generated: ${timestamp}

---

## Test Configuration

- **Baseline Version**: ${baseline.promptVersion}
- **Challenger Version**: ${challenger.promptVersion}
- **Runs Per Version**: ${this.runsPerVersion}
- **Total Simulations**: ${this.runsPerVersion * 2}

---

## Results Summary

### Winner: ${comparison.winner.toUpperCase()} 🏆
**Confidence**: ${(comparison.confidence * 100).toFixed(1)}%

**Baseline**: ${this._getPromptVersionName(baseline.promptVersion)} (${baseline.promptVersion})
**Challenger**: ${this._getPromptVersionName(challenger.promptVersion)} (${challenger.promptVersion})

---

## Quality Metrics (Primary)

### Average Score

| Version | Avg Score | Improvement | Description |
|---------|-----------|-------------|-------------|
| Baseline | ${comparison.qualityMetrics.averageScore.baseline.toFixed(2)} | - | ${comparison.qualityMetrics.averageScore.description} |
| Challenger | ${comparison.qualityMetrics.averageScore.challenger.toFixed(2)} | ${comparison.qualityMetrics.averageScore.improvement} | ${comparison.qualityMetrics.averageScore.description} |

**Winner**: ${comparison.qualityMetrics.averageScore.winner === 'challenger' ? '🟢 Challenger' : comparison.qualityMetrics.averageScore.winner === 'baseline' ? '🔵 Baseline' : '🤝 Tie'}

### Critical Failures

| Version | Critical Failures | Improvement | Description |
|---------|-------------------|-------------|-------------|
| Baseline | ${comparison.qualityMetrics.criticalFailures.baseline} | - | ${comparison.qualityMetrics.criticalFailures.description} |
| Challenger | ${comparison.qualityMetrics.criticalFailures.challenger} | ${comparison.qualityMetrics.criticalFailures.improvement} | ${comparison.qualityMetrics.criticalFailures.description} |

**Winner**: ${comparison.qualityMetrics.criticalFailures.winner === 'challenger' ? '🟢 Challenger' : comparison.qualityMetrics.criticalFailures.winner === 'baseline' ? '🔵 Baseline' : '🤝 Tie'}

**Feedback Entries Analyzed**: Baseline: ${comparison.qualityMetrics.feedbackCount.baseline}, Challenger: ${comparison.qualityMetrics.feedbackCount.challenger}

---

## Operational Metrics (Secondary)

### Success Rate

| Version | Success Rate | Improvement | Description |
|---------|-------------|-------------|-------------|
| Baseline | ${(comparison.metrics.successRate.baseline * 100).toFixed(1)}% | - | ${comparison.metrics.successRate.description} |
| Challenger | ${(comparison.metrics.successRate.challenger * 100).toFixed(1)}% | ${comparison.metrics.successRate.improvement} | ${comparison.metrics.successRate.description} |

**Winner**: ${comparison.metrics.successRate.winner === 'challenger' ? '🟢 Challenger' : comparison.metrics.successRate.winner === 'baseline' ? '🔵 Baseline' : '🤝 Tie'}

### Average Duration

| Version | Avg Duration | Improvement | Description |
|---------|-------------|-------------|-------------|
| Baseline | ${(baseline.averageDuration / 1000).toFixed(2)}s | - | ${comparison.metrics.avgDuration.description} |
| Challenger | ${(challenger.averageDuration / 1000).toFixed(2)}s | ${comparison.metrics.avgDuration.improvement} | ${comparison.metrics.avgDuration.description} |

**Winner**: ${comparison.metrics.avgDuration.winner === 'challenger' ? '🟢 Challenger' : comparison.metrics.avgDuration.winner === 'baseline' ? '🔵 Baseline' : '🤝 Tie'}

---

## Confidence Calculation

**Quality Score (70% weight)**:
- Baseline: ${comparison.baselineScore.toFixed(3)}
- Challenger: ${comparison.challengerScore.toFixed(3)}

**Final Confidence**: ${(comparison.confidence * 100).toFixed(1)}% based on quality-weighted scoring

---

## Detailed Results

### Baseline (${baseline.promptVersion})

- Successful runs: ${baseline.successCount}/${this.runsPerVersion}
- Failed runs: ${baseline.failureCount}/${this.runsPerVersion}
- Total duration: ${(baseline.totalDuration / 1000).toFixed(1)}s
- Average duration: ${(baseline.averageDuration / 1000).toFixed(2)}s

### Challenger (${challenger.promptVersion})

- Successful runs: ${challenger.successCount}/${this.runsPerVersion}
- Failed runs: ${challenger.failureCount}/${this.runsPerVersion}
- Total duration: ${(challenger.totalDuration / 1000).toFixed(1)}s
- Average duration: ${(challenger.averageDuration / 1000).toFixed(2)}s

---

## Recommendation

${this._generateRecommendation(comparison)}

---

## Statistical Notes

- This is a preliminary A/B test based on ${this.runsPerVersion} runs per version
- For production deployment, consider running more iterations (50-100+)
- Consider analyzing user feedback scores for qualitative comparison
- Monitor real-world performance after deployment

---

*This report is automatically generated by the A/B Testing Framework*
`;

        const reportPath = path.join(__dirname, `../ab_test_${testName.replace(/\s+/g, '_')}_${Date.now()}.md`);
        await fs.writeFile(reportPath, report, 'utf8');
        
        // Get descriptive names
        const baselineName = this._getPromptVersionName(baseline.promptVersion);
        const challengerName = this._getPromptVersionName(challenger.promptVersion);
        
        console.log('\n📊 RESULTS\n');
        console.log('─'.repeat(80));
        console.log(`Winner: ${comparison.winner.toUpperCase()} (${(comparison.confidence * 100).toFixed(1)}% confidence)`);
        console.log('─'.repeat(80));
        console.log(`\n📋 BASELINE: ${baselineName}`);
        console.log(`   Version: ${baseline.promptVersion}`);
        console.log(`\n🆕 CHALLENGER: ${challengerName}`);
        console.log(`   Version: ${challenger.promptVersion}`);
        console.log('\n─'.repeat(80));
        console.log('\n📈 QUALITY METRICS (from feedback analysis):');
        console.log(`  Average Score:`);
        console.log(`    Baseline:   ${comparison.qualityMetrics.averageScore.baseline.toFixed(2)}`);
        console.log(`    Challenger: ${comparison.qualityMetrics.averageScore.challenger.toFixed(2)}`);
        console.log(`    Change:     ${comparison.qualityMetrics.averageScore.improvement} (${comparison.qualityMetrics.averageScore.description})`);
        console.log(`    Winner:     ${comparison.qualityMetrics.averageScore.winner === 'challenger' ? '🟢 Challenger' : comparison.qualityMetrics.averageScore.winner === 'baseline' ? '🔵 Baseline' : '🤝 Tie'}`);
        console.log(`\n  Critical Failures:`);
        console.log(`    Baseline:   ${comparison.qualityMetrics.criticalFailures.baseline}`);
        console.log(`    Challenger: ${comparison.qualityMetrics.criticalFailures.challenger}`);
        console.log(`    Change:     ${comparison.qualityMetrics.criticalFailures.improvement} (${comparison.qualityMetrics.criticalFailures.description})`);
        console.log(`    Winner:     ${comparison.qualityMetrics.criticalFailures.winner === 'challenger' ? '🟢 Challenger' : comparison.qualityMetrics.criticalFailures.winner === 'baseline' ? '🔵 Baseline' : '🤝 Tie'}`);
        console.log(`\n  Feedback Entries Analyzed:`);
        console.log(`    Baseline:   ${comparison.qualityMetrics.feedbackCount.baseline}`);
        console.log(`    Challenger: ${comparison.qualityMetrics.feedbackCount.challenger}`);
        console.log('\n─'.repeat(80));
        console.log('\n⚙️  OPERATIONAL METRICS:');
        console.log(`\n  Success Rate (${comparison.metrics.successRate.description}):`);
        console.log(`    Baseline:   ${(comparison.metrics.successRate.baseline * 100).toFixed(1)}%`);
        console.log(`    Challenger: ${(comparison.metrics.successRate.challenger * 100).toFixed(1)}%`);
        console.log(`    Change:     ${comparison.metrics.successRate.improvement} ${comparison.metrics.successRate.improvement !== 'N/A' && parseFloat(comparison.metrics.successRate.improvement) > 0 ? '⬆️' : parseFloat(comparison.metrics.successRate.improvement) < 0 ? '⬇️' : ''}`);
        console.log(`    Winner:     ${comparison.metrics.successRate.winner === 'challenger' ? '🟢 Challenger' : comparison.metrics.successRate.winner === 'baseline' ? '🔵 Baseline' : '🤝 Tie'}`);
        console.log(`\n  Avg Duration (${comparison.metrics.avgDuration.description}):`);
        console.log(`    Baseline:   ${(baseline.averageDuration / 1000).toFixed(2)}s`);
        console.log(`    Challenger: ${(challenger.averageDuration / 1000).toFixed(2)}s`);
        console.log(`    Change:     ${comparison.metrics.avgDuration.improvement} ${comparison.metrics.avgDuration.improvement !== 'N/A' && parseFloat(comparison.metrics.avgDuration.improvement) > 0 ? '⬆️' : parseFloat(comparison.metrics.avgDuration.improvement) < 0 ? '⬇️' : ''}`);
        console.log(`    Winner:     ${comparison.metrics.avgDuration.winner === 'challenger' ? '🟢 Challenger' : comparison.metrics.avgDuration.winner === 'baseline' ? '🔵 Baseline' : '🤝 Tie'}`);
        // Calculate metric wins for display
        const challengerWins = [
            comparison.metrics.successRate.winner === 'challenger',
            comparison.metrics.avgDuration.winner === 'challenger',
            comparison.qualityMetrics.averageScore.winner === 'challenger',
            comparison.qualityMetrics.criticalFailures.winner === 'challenger'
        ].filter(Boolean).length;
        
        const baselineWins = [
            comparison.metrics.successRate.winner === 'baseline',
            comparison.metrics.avgDuration.winner === 'baseline',
            comparison.qualityMetrics.averageScore.winner === 'baseline',
            comparison.qualityMetrics.criticalFailures.winner === 'baseline'
        ].filter(Boolean).length;
        
        console.log('\n─'.repeat(80));
        console.log(`\n📊 CONFIDENCE CALCULATION:`);
        console.log(`   Quality Score (70% weight): Baseline ${comparison.baselineScore.toFixed(3)}, Challenger ${comparison.challengerScore.toFixed(3)}`);
        console.log(`   Metric Wins: Baseline ${baselineWins}, Challenger ${challengerWins}`);
        console.log(`   Final Confidence: ${(comparison.confidence * 100).toFixed(1)}% based on quality-weighted scoring`);
        console.log('─'.repeat(80));
        console.log(`\n✓ Full report saved to: ${reportPath}\n`);
    }

    /**
     * Get descriptive name for prompt version
     * Returns both version code and human-readable name
     */
    _getPromptVersionName(version) {
        let name, description;
        
        if (version === 'current' || !version) {
            name = 'Current Production Prompt';
            description = 'unified_prompt.js (active)';
        } else if (/^\d+$/.test(version)) {
            // Timestamp-based version
            name = `Optimized Version v${version.substring(0, 10)}...`;
            description = `Version code: ${version}`;
        } else if (version.startsWith('v')) {
            name = `Optimized Version ${version}`;
            description = `Prompt version identifier`;
        } else if (version.includes('unified_prompt') || version.includes('v')) {
            name = version;
            description = 'Custom prompt version';
        } else {
            name = version;
            description = 'Prompt version';
        }
        
        return `${name} [${description}]`;
    }

    /**
     * Generate recommendation based on results
     */
    _generateRecommendation(comparison) {
        if (comparison.winner === 'challenger' && comparison.confidence > 0.6) {
            return `✅ **RECOMMEND DEPLOYMENT**\n\nThe challenger version shows measurable improvements over the baseline with ${(comparison.confidence * 100).toFixed(1)}% confidence. Consider deploying the challenger version to production.\n\n**Next Steps:**\n1. Review the optimized prompt manually\n2. Run extended testing with more scenarios\n3. Deploy to a small percentage of users initially\n4. Monitor real-world performance`;
        } else if (comparison.winner === 'baseline' && comparison.confidence > 0.6) {
            return `⚠️ **KEEP BASELINE**\n\nThe baseline version outperforms the challenger. Do not deploy the challenger version.\n\n**Next Steps:**\n1. Review why optimization didn't improve performance\n2. Analyze specific failure cases\n3. Iterate on the optimization approach\n4. Re-run optimization with adjusted parameters`;
        } else {
            return `⚖️ **INCONCLUSIVE - MORE DATA NEEDED**\n\nThe results are too close to make a confident recommendation. Consider:\n\n**Options:**\n1. Run more iterations (50-100+) for statistical significance\n2. Test with more diverse scenarios\n3. Collect human feedback on both versions\n4. Analyze specific use cases where one version excels`;
        }
    }
}

/**
 * Quick test function
 */
async function runQuickTest(baseline, challenger) {
    const test = new ABTest({
        baseline: baseline || 'unified_prompt_v1.0',
        challenger: challenger || 'unified_prompt_v1.1',
        runs: 5,
        scenarios: []
    });

    await test.runTest('Quick Test');
}

/**
 * CLI interface
 */
async function main() {
    const args = process.argv.slice(2);

    // Parse arguments
    const baselineIdx = args.indexOf('--baseline');
    const challengerIdx = args.indexOf('--challenger');
    const runsIdx = args.indexOf('--runs');

    const baseline = baselineIdx !== -1 && args[baselineIdx + 1] ? args[baselineIdx + 1] : 'unified_prompt_v1.0';
    const challenger = challengerIdx !== -1 && args[challengerIdx + 1] ? args[challengerIdx + 1] : 'unified_prompt_v1.1';
    const runs = runsIdx !== -1 && args[runsIdx + 1] ? parseInt(args[runsIdx + 1]) : 10;

    console.log('\n🧪 A/B Testing Framework\n');

    if (args.includes('--help')) {
        console.log('Usage: node training/ab_test.js [options]\n');
        console.log('Options:');
        console.log('  --baseline <version>    Baseline prompt version (default: unified_prompt_v1.0)');
        console.log('  --challenger <version>  Challenger prompt version (default: unified_prompt_v1.1)');
        console.log('  --runs <number>         Number of runs per version (default: 10)');
        console.log('  --help                  Show this help message');
        console.log('\nExample:');
        console.log('  node training/ab_test.js --baseline v1.0 --challenger v1.2 --runs 20\n');
        return;
    }

    const test = new ABTest({
        baseline,
        challenger,
        runs
    });

    await test.runTest(`${baseline} vs ${challenger}`);
}

// Run if called directly
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || 
    process.argv[1].includes('ab_test')) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

export { ABTest, runQuickTest };

