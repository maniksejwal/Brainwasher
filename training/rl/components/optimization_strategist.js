/**
 * @fileoverview Component for Organization Strategy (Opportunities & Prompts)
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class OptimizationStrategist {
    constructor(promptOptimizer, feedbackAnalyzer, options = {}) {
        this.promptOptimizer = promptOptimizer;
        this.feedbackAnalyzer = feedbackAnalyzer;
        this.optimizePrompts = options.optimizePrompts || 'all';
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
                targetMetric: 'escalationEffectiveness',
                tags: ['escalation']
            });
        }

        // Low conversation quality
        if (performanceAnalysis.conversationQuality < 0.4) {
            opportunities.push({
                type: 'low_conversation_quality',
                priority: 'medium',
                description: 'Conversation quality needs improvement',
                targetMetric: 'conversationQuality',
                tags: ['complex', 'emotional']
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
        // Need to navigate from training/rl/components to prompts dir
        // Path: ../../../prompts/unified_prompt.js
        const promptsDir = path.join(__dirname, '../../../prompts');
        const unifiedPromptPath = path.join(promptsDir, 'unified_prompt.js');

        let currentPrompt;
        try {
            const resolvedPath = path.resolve(unifiedPromptPath);
            currentPrompt = await this.promptOptimizer.loadPrompt(resolvedPath);
        } catch (error) {
            console.warn(`[OptimizationStrategist] Could not load current prompt from: ${path.resolve(unifiedPromptPath)}`);
            console.warn(`[OptimizationStrategist] Error: ${error.message}`);
            return [];
        }

        // Get analysis report
        const analysisReport = await this.feedbackAnalyzer.generateReport();

        console.log(`[OptimizationStrategist] Optimizing prompts: ${this.optimizePrompts === 'all' ? 'all prompt types' : Array.isArray(this.optimizePrompts) ? this.optimizePrompts.join(', ') : this.optimizePrompts}`);

        if (this.optimizePrompts === 'unified' || (Array.isArray(this.optimizePrompts) && this.optimizePrompts.includes('unified'))) {
            // Use unified prompt optimization
            for (const opportunity of opportunities) {
                try {
                    const focusedAnalysis = `Opportunity: ${opportunity.type}\nPriority: ${opportunity.priority}\nDescription: ${opportunity.description}\nTarget Metric: ${opportunity.targetMetric}\n\n${typeof analysisReport === 'string' ? analysisReport : analysisReport.aiAnalysis || JSON.stringify(analysisReport)}`;

                    const optimizedPrompt = await this.promptOptimizer.optimizePrompt(currentPrompt, focusedAnalysis);

                    if (optimizedPrompt && optimizedPrompt.length > 100) {
                        const versionData = await this._saveOptimizedPrompt(optimizedPrompt, opportunity);
                        optimizedPrompts.push(versionData);
                    }
                } catch (error) {
                    console.warn(`[OptimizationStrategist] Failed to optimize unified prompt for ${opportunity.type}:`, error.message);
                }
            }
        }

        if (this.optimizePrompts === 'all' || (Array.isArray(this.optimizePrompts) && this.optimizePrompts.some(p => p !== 'unified'))) {
            // Use multi-prompt optimizer for other prompts
            // Import dynamically to avoid circular dependencies
            const { MultiPromptOptimizer } = await import('../prompt_optimizer_multi.js');
            const multiOptimizer = new MultiPromptOptimizer();
            const otherPrompts = await multiOptimizer.generateOptimizedPromptsForAll(
                opportunities,
                this.optimizePrompts === 'all' ? ['unified', 'all'] : this.optimizePrompts
            );
            optimizedPrompts.push(...otherPrompts);
        }

        console.log(`[OptimizationStrategist] Generated ${optimizedPrompts.length} optimized prompt version(s) across ${new Set(optimizedPrompts.map(p => p.type)).size} prompt type(s)`);

        return optimizedPrompts;
    }

    async _saveOptimizedPrompt(optimizedPrompt, opportunity) {
        const version = `v${Date.now()}`;
        const timestamp = new Date().toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const promptName = `${opportunity.type || 'optimization'} - ${opportunity.description?.substring(0, 40) || 'optimization'} (${timestamp})`;

        let originalSimMode = process.env.SIMULATION_MODE;
        try {
            delete process.env.SIMULATION_MODE;
            const { savePromptVersion } = await import('../../../db/index.js');
            await savePromptVersion(version, optimizedPrompt, promptName, 0);
            console.log(`[OptimizationStrategist] Saved optimized prompt ${version}: ${promptName}`);
        } catch (error) {
            console.warn(`[OptimizationStrategist] Could not save prompt to DB:`, error.message);
        } finally {
            if (originalSimMode) process.env.SIMULATION_MODE = originalSimMode;
        }

        return {
            ...opportunity,
            optimizedPrompt,
            version,
            name: promptName
        };
    }
}
