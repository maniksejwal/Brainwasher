/**
 * @fileoverview Thompson Sampling for Multi-Armed Bandit Prompt Selection
 * Implements Thompson Sampling algorithm for adaptive prompt version selection
 * based on performance feedback.
 */

/**
 * Thompson Sampling for Multi-Armed Bandit
 * Balances exploration vs exploitation for prompt version selection
 */
export class ThompsonSampling {
    constructor(versions, options = {}) {
        this.versions = versions; // Array of prompt version identifiers
        this.successes = {}; // Track successes per version
        this.failures = {};  // Track failures per version
        this.totalSamples = {}; // Track total samples per version
        this.minSamples = options.minSamples || 20; // Minimum samples before using Thompson Sampling (increased from 10)
        this.minRunsBeforeDiscard = options.minRunsBeforeDiscard || 15; // Minimum runs before any version can be discarded
        this.explorationFactor = options.explorationFactor || 1.0; // Beta distribution parameter
        this.confidenceLevel = options.confidenceLevel || 0.95; // Confidence level for statistical significance

        // Initialize tracking for all versions
        this.versions.forEach(v => {
            this.successes[v] = 0;
            this.failures[v] = 0;
            this.totalSamples[v] = 0;
        });
    }

    /**
     * Select a version using Thompson Sampling
     * Returns version identifier
     */
    selectVersion() {
        // Check if we have minimum samples for all versions
        const allVersionsSampled = this.versions.every(v =>
            this.totalSamples[v] >= this.minSamples
        );

        if (!allVersionsSampled) {
            // Pure exploration: select version with least samples
            const leastSampled = this.versions.reduce((min, v) =>
                this.totalSamples[v] < this.totalSamples[min] ? v : min
            );
            return leastSampled;
        }

        // Thompson Sampling: sample from Beta distributions
        const samples = this.versions.map(version => {
            const alpha = this.successes[version] + this.explorationFactor;
            const beta = this.failures[version] + this.explorationFactor;

            // Sample from Beta distribution
            const sample = this._sampleBeta(alpha, beta);

            return { version, sample, alpha, beta };
        });

        // Sort by sample value (descending) and return best
        samples.sort((a, b) => b.sample - a.sample);

        return samples[0].version;
    }

    /**
     * Update reward for a version
     * @param {string} version - Version identifier
     * @param {boolean|number} reward - True/false for success/failure, or numeric score
     */
    updateReward(version, reward) {
        if (!this.versions.includes(version)) {
            console.warn(`[ThompsonSampling] Unknown version: ${version}`);
            return;
        }

        this.totalSamples[version]++;

        // Handle boolean reward
        if (typeof reward === 'boolean') {
            if (reward) {
                this.successes[version]++;
            } else {
                this.failures[version]++;
            }
        }
        // Handle numeric reward (0-1 scale)
        else if (typeof reward === 'number') {
            // Convert to success/failure proportionally
            // Score > 0.5 = success, < 0.5 = failure
            if (reward > 0.5) {
                this.successes[version]++;
            } else if (reward < 0.5) {
                this.failures[version]++;
            }
            // If exactly 0.5, don't update (neutral)
        }
    }

    /**
     * Get allocation probabilities for all versions
     * Returns object with version -> probability mapping
     */
    getAllocationProbabilities() {
        const totalSamples = this.versions.reduce((sum, v) =>
            sum + this.totalSamples[v], 0
        );

        if (totalSamples === 0) {
            // Equal allocation if no samples
            const equalProb = 1.0 / this.versions.length;
            return this.versions.reduce((acc, v) => {
                acc[v] = equalProb;
                return acc;
            }, {});
        }

        // Calculate probabilities based on Thompson Sampling
        // Run many samples and count wins
        const winCounts = {};
        this.versions.forEach(v => winCounts[v] = 0);

        const numSimulations = 1000;
        for (let i = 0; i < numSimulations; i++) {
            const samples = this.versions.map(version => {
                const alpha = this.successes[version] + this.explorationFactor;
                const beta = this.failures[version] + this.explorationFactor;
                return { version, sample: this._sampleBeta(alpha, beta) };
            });

            const winner = samples.sort((a, b) => b.sample - a.sample)[0].version;
            winCounts[winner]++;
        }

        // Convert to probabilities
        const probabilities = {};
        this.versions.forEach(v => {
            probabilities[v] = winCounts[v] / numSimulations;
        });

        return probabilities;
    }

    /**
     * Get statistics for all versions
     */
    getStatistics() {
        return this.versions.map(version => {
            const total = this.totalSamples[version];
            const successRate = total > 0
                ? this.successes[version] / total
                : 0;

            const alpha = this.successes[version] + this.explorationFactor;
            const beta = this.failures[version] + this.explorationFactor;
            const expectedValue = alpha / (alpha + beta); // Expected success rate

            return {
                version,
                totalSamples: total,
                successes: this.successes[version],
                failures: this.failures[version],
                successRate,
                expectedValue,
                alpha,
                beta
            };
        });
    }

    /**
     * Sample from Beta distribution
     * Uses Gamma distribution approximation
     */
    _sampleBeta(alpha, beta) {
        // Sample from Gamma distributions
        const x = this._sampleGamma(alpha, 1);
        const y = this._sampleGamma(beta, 1);

        // Beta(a, b) = Gamma(a, 1) / (Gamma(a, 1) + Gamma(b, 1))
        return x / (x + y);
    }

    /**
     * Sample from Gamma distribution
     * Uses rejection sampling for simplicity
     */
    _sampleGamma(shape, scale) {
        // Simple approximation using normal distribution
        // For more accuracy, use proper Gamma sampling
        if (shape < 1) {
            // For shape < 1, use transformation
            return Math.pow(Math.random(), 1 / shape) * this._sampleGamma(shape + 1, scale);
        }

        // For shape >= 1, use normal approximation
        const mean = shape * scale;
        const variance = shape * scale * scale;
        const stddev = Math.sqrt(variance);

        // Box-Muller transform for normal distribution
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

        const sample = mean + stddev * z;
        return Math.max(0, sample); // Ensure non-negative
    }

    /**
     * Get best version based on current statistics
     * Only returns a version if it has minimum required runs
     */
    getBestVersion() {
        const stats = this.getStatistics();

        // Filter out versions that don't have minimum runs
        const eligibleStats = stats.filter(s => s.totalSamples >= this.minRunsBeforeDiscard);

        if (eligibleStats.length === 0) {
            // If no version has minimum runs yet, return the one with most samples
            const mostSampled = stats.sort((a, b) => b.totalSamples - a.totalSamples)[0];
            return mostSampled.version;
        }

        const best = eligibleStats.sort((a, b) => b.expectedValue - a.expectedValue)[0];
        return best.version;
    }

    /**
     * Check if a version should be discarded
     * Returns true only if version has minimum runs AND is statistically worse than best
     */
    shouldDiscardVersion(version) {
        const stats = this.getStatistics();
        const versionStats = stats.find(s => s.version === version);

        // Never discard if hasn't reached minimum runs
        if (!versionStats || versionStats.totalSamples < this.minRunsBeforeDiscard) {
            return false;
        }

        // Get best version
        const bestStats = stats.sort((a, b) => b.expectedValue - a.expectedValue)[0];

        // Don't discard if this IS the best version
        if (versionStats.version === bestStats.version) {
            return false;
        }

        // Check if statistically significantly worse
        const [vLower, vUpper] = this.getConfidenceInterval(version, this.confidenceLevel);
        const [bLower, bUpper] = this.getConfidenceInterval(bestStats.version, this.confidenceLevel);

        // Discard only if upper bound of this version is below lower bound of best
        return vUpper < bLower;
    }

    /**
     * Get confidence interval for a version
     */
    getConfidenceInterval(version, confidence = 0.95) {
        const alpha = this.successes[version] + this.explorationFactor;
        const beta = this.failures[version] + this.explorationFactor;

        // Approximate CI using normal distribution
        const n = alpha + beta;
        if (n === 0) return [0, 1];

        const p = alpha / n;
        const z = 1.96; // For 95% confidence
        const se = Math.sqrt(p * (1 - p) / n);

        const lower = Math.max(0, p - z * se);
        const upper = Math.min(1, p + z * se);

        return [lower, upper];
    }
}

/**
 * Multi-challenger A/B test with Thompson Sampling
 */
export class MultiChallengerABTest {
    constructor(baseline, challengers, options = {}) {
        this.baseline = baseline;
        this.challengers = challengers; // Array of challenger versions
        this.allVersions = [baseline, ...challengers];
        this.thompsonSampling = new ThompsonSampling(this.allVersions, options);
        this.results = {};
        this.allVersions.forEach(v => {
            this.results[v] = {
                runs: [],
                totalDuration: 0,
                successCount: 0,
                failureCount: 0
            };
        });
    }

    /**
     * Select next version to test using Thompson Sampling
     */
    selectNextVersion() {
        return this.thompsonSampling.selectVersion();
    }

    /**
     * Record result for a version
     */
    recordResult(version, success, duration, score = null) {
        if (!this.results[version]) {
            this.results[version] = {
                runs: [],
                totalDuration: 0,
                successCount: 0,
                failureCount: 0
            };
        }

        this.results[version].runs.push({ success, duration, score });
        this.results[version].totalDuration += duration;

        if (success) {
            this.results[version].successCount++;
        } else {
            this.results[version].failureCount++;
        }

        // Update Thompson Sampling
        const reward = score !== null ? score : success;
        this.thompsonSampling.updateReward(version, reward);
    }

    /**
     * Get allocation recommendations
     */
    getAllocationRecommendations() {
        return this.thompsonSampling.getAllocationProbabilities();
    }

    /**
     * Get ranked versions by performance
     */
    getRankedVersions() {
        const stats = this.thompsonSampling.getStatistics();
        return stats.sort((a, b) => b.expectedValue - a.expectedValue);
    }

    /**
     * Get winner (best performing version)
     */
    getWinner() {
        return this.thompsonSampling.getBestVersion();
    }
}

