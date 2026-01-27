
/**
 * @fileoverview Contextual Bandit Implementation (Segmented)
 * Manages multiple Multi-Armed Bandits (Thompson Sampling), one for each context segment.
 * This allows the agent to learn different optimal policies for different user personas/contexts.
 */

import { ThompsonSampling } from './thompson_sampling.js';

export class ContextualBandit {
    /**
     * @param {Array<string>} versions - List of available prompt versions
     * @param {Object} options - Configuration options
     * @param {Object} options.priorStatsByType - Historical stats grouped by context key
     */
    constructor(versions, options = {}) {
        this.versions = versions;
        this.options = options;

        // Map of contextKey -> ThompsonSampling instance
        // Example keys: "persona:anxious", "complexity:high", "combined:anxious_high"
        this.bandits = new Map();

        // Fallback global bandit if context is unknown or new
        this.globalBandit = new ThompsonSampling(versions, {
            ...options,
            initialStats: options.priorStatsByType ? options.priorStatsByType['global'] : null
        });
    }

    /**
     * Get or create a bandit for a specific context
     * @param {string} contextKey - Unique key for the context (e.g., "persona:denial_prone")
     * @returns {ThompsonSampling}
     */
    getBandit(contextKey) {
        if (!contextKey) return this.globalBandit;

        if (!this.bandits.has(contextKey)) {
            // Initialize new bandit for this context
            // check if we have prior stats for this specific context
            const priorStats = this.options.priorStatsByType ? this.options.priorStatsByType[contextKey] : null;

            this.bandits.set(contextKey, new ThompsonSampling(this.versions, {
                ...this.options,
                initialStats: priorStats
            }));
        }
        return this.bandits.get(contextKey);
    }

    /**
     * Select a version based on context
     * @param {Object} context - Context object
     * @param {string} context.personaCategory - User persona category (e.g., "anxious", "denial")
     * @param {number} context.complexity - Scenario complexity
     * @returns {string} Selected version
     */
    selectVersion(context) {
        const key = this._generateContextKey(context);
        const bandit = this.getBandit(key);
        return bandit.selectVersion();
    }

    /**
     * Update reward for a specific context
     * @param {string} version - Version identifier
     * @param {boolean|number} reward - Reward value
     * @param {Object} context - Context object
     */
    updateReward(version, reward, context) {
        const key = this._generateContextKey(context);
        const bandit = this.getBandit(key);
        bandit.updateReward(version, reward);

        // Also update global bandit for aggregate tracking (optional, but good for fallback data)
        this.globalBandit.updateReward(version, reward);
    }

    /**
     * Generate a string key from context object
     * Strategy: Coarse-grained segmentation to avoid sparse data
     * @private
     */
    _generateContextKey(context) {
        if (!context) return 'global';

        const parts = [];

        // Primary segmentation: Persona Category
        if (context.personaCategory) {
            parts.push(`persona:${context.personaCategory}`);
        }

        // Secondary segmentation: Complexity (only if high)
        // We group 1-2 as low/normal, 3+ as high to reduce fragmentation
        if (context.complexity && context.complexity >= 3) {
            parts.push('complex');
        }

        return parts.length > 0 ? parts.join('_') : 'global';
    }

    /**
     * Get statistics for a specific context
     */
    getStatistics(context) {
        const key = this._generateContextKey(context);
        return this.getBandit(key).getStatistics();
    }

    /**
     * Get all statistics grouped by context
     */
    getAllStatistics() {
        const stats = {
            global: this.globalBandit.getStatistics()
        };

        for (const [key, bandit] of this.bandits.entries()) {
            stats[key] = bandit.getStatistics();
        }

        return stats;
    }
}
