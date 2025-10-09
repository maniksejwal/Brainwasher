/**
 * @fileoverview training/ab_test.js
 * A/B testing framework for comparing prompt versions.
 * Runs simulations with both versions and compares performance.
 */

import { SimulationDriver } from '../simulation/simulator.js';
import { FeedbackAnalyzer } from './feedback_analyzer.js';
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
        console.log('\n' + '█'.repeat(80));
        console.log(`  A/B TEST: ${testName}`);
        console.log('█'.repeat(80));
        console.log(`\nBaseline:   ${this.baselineVersion}`);
        console.log(`Challenger: ${this.challengerVersion}`);
        console.log(`Runs per version: ${this.runsPerVersion}`);
        console.log(`Scenarios: ${this.scenarios.length}`);
        console.log('\n' + '─'.repeat(80) + '\n');

        // Run baseline
        console.log('🔵 Running BASELINE version...\n');
        const baselineResults = await this._runVersion('baseline', this.baselineVersion);
        
        // Run challenger
        console.log('\n🟢 Running CHALLENGER version...\n');
        const challengerResults = await this._runVersion('challenger', this.challengerVersion);

        // Compare results
        console.log('\n' + '─'.repeat(80));
        const comparison = this._compareResults(baselineResults, challengerResults);
        
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

        for (let i = 0; i < this.runsPerVersion; i++) {
            console.log(`  [${i + 1}/${this.runsPerVersion}] Running simulation...`);
            
            // Create a test scenario
            const scenario = this.scenarios[i % this.scenarios.length] || this._getDefaultScenario(i);
            
            const simulator = new SimulationDriver({ 
                logResults: true,
                promptVersion: promptVersion
            });

            try {
                const startTime = Date.now();
                
                // Run simulation
                await simulator.runScenario(scenario);
                
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
                    scenario: scenario.name,
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
     */
    _compareResults(baseline, challenger) {
        const comparison = {
            winner: null,
            confidence: 0,
            metrics: {}
        };

        // Success rate
        const baselineSuccessRate = baseline.successCount / this.runsPerVersion;
        const challengerSuccessRate = challenger.successCount / this.runsPerVersion;
        
        comparison.metrics.successRate = {
            baseline: baselineSuccessRate,
            challenger: challengerSuccessRate,
            improvement: ((challengerSuccessRate - baselineSuccessRate) / baselineSuccessRate * 100).toFixed(1) + '%',
            winner: challengerSuccessRate > baselineSuccessRate ? 'challenger' : 
                    challengerSuccessRate < baselineSuccessRate ? 'baseline' : 'tie'
        };

        // Average duration
        comparison.metrics.avgDuration = {
            baseline: baseline.averageDuration,
            challenger: challenger.averageDuration,
            improvement: ((baseline.averageDuration - challenger.averageDuration) / baseline.averageDuration * 100).toFixed(1) + '%',
            winner: challenger.averageDuration < baseline.averageDuration ? 'challenger' : 
                    challenger.averageDuration > baseline.averageDuration ? 'baseline' : 'tie'
        };

        // Determine overall winner (simple heuristic - can be made more sophisticated)
        const challengerWins = Object.values(comparison.metrics).filter(m => m.winner === 'challenger').length;
        const baselineWins = Object.values(comparison.metrics).filter(m => m.winner === 'baseline').length;
        
        if (challengerWins > baselineWins) {
            comparison.winner = 'challenger';
            comparison.confidence = challengerWins / (challengerWins + baselineWins);
        } else if (baselineWins > challengerWins) {
            comparison.winner = 'baseline';
            comparison.confidence = baselineWins / (challengerWins + baselineWins);
        } else {
            comparison.winner = 'tie';
            comparison.confidence = 0.5;
        }

        return comparison;
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

---

## Performance Metrics

### Success Rate

| Version | Success Rate | Improvement |
|---------|-------------|-------------|
| Baseline | ${(comparison.metrics.successRate.baseline * 100).toFixed(1)}% | - |
| Challenger | ${(comparison.metrics.successRate.challenger * 100).toFixed(1)}% | ${comparison.metrics.successRate.improvement} |

**Winner**: ${comparison.metrics.successRate.winner === 'challenger' ? '🟢 Challenger' : comparison.metrics.successRate.winner === 'baseline' ? '🔵 Baseline' : '🤝 Tie'}

### Average Duration

| Version | Avg Duration | Improvement |
|---------|-------------|-------------|
| Baseline | ${(baseline.averageDuration / 1000).toFixed(2)}s | - |
| Challenger | ${(challenger.averageDuration / 1000).toFixed(2)}s | ${comparison.metrics.avgDuration.improvement} |

**Winner**: ${comparison.metrics.avgDuration.winner === 'challenger' ? '🟢 Challenger' : comparison.metrics.avgDuration.winner === 'baseline' ? '🔵 Baseline' : '🤝 Tie'}

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
        
        console.log('\n📊 RESULTS\n');
        console.log('─'.repeat(80));
        console.log(`Winner: ${comparison.winner.toUpperCase()} (${(comparison.confidence * 100).toFixed(1)}% confidence)`);
        console.log('─'.repeat(80));
        console.log('\nSuccess Rate:');
        console.log(`  Baseline:   ${(comparison.metrics.successRate.baseline * 100).toFixed(1)}%`);
        console.log(`  Challenger: ${(comparison.metrics.successRate.challenger * 100).toFixed(1)}%`);
        console.log(`  Change:     ${comparison.metrics.successRate.improvement}`);
        console.log('\nAvg Duration:');
        console.log(`  Baseline:   ${(baseline.averageDuration / 1000).toFixed(2)}s`);
        console.log(`  Challenger: ${(challenger.averageDuration / 1000).toFixed(2)}s`);
        console.log(`  Change:     ${comparison.metrics.avgDuration.improvement}`);
        console.log('─'.repeat(80));
        console.log(`\n✓ Full report saved to: ${reportPath}\n`);
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

