/**
 * @fileoverview Multi-Prompt Optimization System
 * Extends prompt optimization to handle all prompt types (unified, doctor, enrichment, etc.)
 * Reuses existing PromptOptimizer and TrainingPipeline code
 */

import { PromptOptimizer } from '../analysis/prompt_optimizer.js';
import { FeedbackAnalyzer } from '../analysis/feedback_analyzer.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Prompt configuration for all prompt types
 */
export const PROMPT_CONFIGS = {
    unified: {
        file: 'unified_prompt.js',
        name: 'Unified Agent Prompt',
        description: 'Main conversational agent for patients and caregivers',
        primary: true, // This is the main prompt we test
        optimizationPriority: 1
    },
    doctor_summary: {
        file: 'doctor_prompts.js',
        export: 'PROMPT_DOCTOR_SUMMARY',
        name: 'Doctor Summary Prompt',
        description: 'Clinical summary generation for doctors',
        primary: false,
        optimizationPriority: 2
    },
    doctor_probe: {
        file: 'doctor_prompts.js',
        export: 'PROMPT_DELEGATED_PROBE',
        name: 'Doctor Probe Prompt',
        description: 'Natural question generation from doctor requests',
        primary: false,
        optimizationPriority: 2
    },
    enrichment: {
        file: 'enrichment_prompt.js',
        export: 'PROMPT_CONTEXT_ENRICHMENT',
        name: 'Context Enrichment Prompt',
        description: 'Re-evaluation after entity resolution',
        primary: false,
        optimizationPriority: 3
    },
    intent: {
        file: 'intent_prompt.js',
        export: 'PROMPT_INTENT_CLASSIFICATION',
        name: 'Intent Classification Prompt',
        description: 'User intent classification',
        primary: false,
        optimizationPriority: 3
    }
};

/**
 * Multi-prompt optimizer that handles all prompt types
 */
export class MultiPromptOptimizer {
    constructor() {
        this.promptOptimizer = new PromptOptimizer();
        this.feedbackAnalyzer = new FeedbackAnalyzer();
        // From training/rl/ we need to go up 2 levels to reach project root
        this.promptsDir = path.join(__dirname, '../../prompts');
    }

    /**
     * Load a prompt from file (handles both unified and other prompts)
     */
    async loadPrompt(promptConfig) {
        const promptPath = path.join(this.promptsDir, promptConfig.file);
        const resolvedPath = path.resolve(promptPath);
        
        try {
            if (promptConfig.export) {
                // For prompts with specific exports (doctor, enrichment, etc.)
                const module = await import(`file:///${resolvedPath.replace(/\\/g, '/')}`);
                return module[promptConfig.export] || null;
            } else {
                // For unified prompt (default export)
                return await this.promptOptimizer.loadPrompt(resolvedPath);
            }
        } catch (error) {
            console.warn(`[MultiPromptOptimizer] Could not load ${promptConfig.name} from: ${resolvedPath}`);
            console.warn(`[MultiPromptOptimizer] Error: ${error.message}`);
            return null;
        }
    }

    /**
     * Generate optimized versions for all configured prompts
     * Reuses existing optimization logic
     */
    async generateOptimizedPromptsForAll(opportunities, focusPrompts = ['unified']) {
        const optimizedPrompts = [];
        
        // Determine which prompts to optimize based on opportunities
        const promptsToOptimize = this._determinePromptsToOptimize(opportunities, focusPrompts);
        
        console.log(`[MultiPromptOptimizer] Optimizing ${promptsToOptimize.length} prompt types: ${promptsToOptimize.map(p => p.name).join(', ')}`);
        
        for (const promptConfig of promptsToOptimize) {
            try {
                // Load current prompt
                const currentPrompt = await this.loadPrompt(promptConfig);
                if (!currentPrompt) {
                    console.warn(`[MultiPromptOptimizer] Skipping ${promptConfig.name} - could not load`);
                    continue;
                }

                // Get relevant opportunities for this prompt type
                const relevantOpportunities = this._filterOpportunitiesForPrompt(opportunities, promptConfig);
                
                if (relevantOpportunities.length === 0) {
                    console.log(`[MultiPromptOptimizer] No relevant opportunities for ${promptConfig.name}`);
                    continue;
                }

                // Get analysis report
                const analysisReport = await this.feedbackAnalyzer.generateReport();

                for (const opportunity of relevantOpportunities) {
                    try {
                        // Build focused analysis
                        const focusedAnalysis = `Prompt Type: ${promptConfig.name}\nOpportunity: ${opportunity.type}\nPriority: ${opportunity.priority}\nDescription: ${opportunity.description}\nTarget Metric: ${opportunity.targetMetric}\n\n${typeof analysisReport === 'string' ? analysisReport : analysisReport.aiAnalysis || JSON.stringify(analysisReport)}`;
                        
                        const optimizedPrompt = await this.promptOptimizer.optimizePrompt(currentPrompt, focusedAnalysis);

                        if (optimizedPrompt && optimizedPrompt.length > 100) {
                            const version = `${promptConfig.file.replace('.js', '')}_v${Date.now()}`;
                            const timestamp = new Date().toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                            const promptName = `${promptConfig.name} - ${opportunity.type} - ${opportunity.description?.substring(0, 25) || 'optimization'} (${timestamp})`;
                            
                            // Save to database
                            try {
                                const { savePromptVersion } = await import('../../db/index.js');
                                await savePromptVersion(version, optimizedPrompt, promptName, 0);
                                console.log(`[MultiPromptOptimizer] Saved optimized ${promptConfig.name} ${version}: ${promptName}`);
                            } catch (error) {
                                console.warn(`[MultiPromptOptimizer] Could not save to DB:`, error.message);
                            }
                            
                            optimizedPrompts.push({
                                promptType: promptConfig.file.replace('.js', ''),
                                promptConfig,
                                ...opportunity,
                                optimizedPrompt,
                                version,
                                name: promptName
                            });
                        }
                    } catch (error) {
                        console.warn(`[MultiPromptOptimizer] Failed to optimize ${promptConfig.name} for ${opportunity.type}:`, error.message);
                    }
                }
            } catch (error) {
                console.warn(`[MultiPromptOptimizer] Error processing ${promptConfig.name}:`, error.message);
            }
        }

        return optimizedPrompts;
    }

    /**
     * Determine which prompts to optimize based on opportunities
     */
    _determinePromptsToOptimize(opportunities, focusPrompts) {
        const promptsToOptimize = [];
        
        // Always optimize unified (primary)
        if (focusPrompts.includes('unified')) {
            promptsToOptimize.push(PROMPT_CONFIGS.unified);
        }

        // Check opportunities for other prompt types
        for (const [key, config] of Object.entries(PROMPT_CONFIGS)) {
            if (key === 'unified') continue; // Already added
            
            // Check if any opportunity is relevant to this prompt type
            const relevant = this._hasRelevantOpportunity(opportunities, config);
            if (relevant && (focusPrompts.includes('all') || focusPrompts.includes(key))) {
                promptsToOptimize.push(config);
            }
        }

        // Sort by optimization priority
        return promptsToOptimize.sort((a, b) => a.optimizationPriority - b.optimizationPriority);
    }

    /**
     * Check if opportunities are relevant to a prompt type
     */
    _hasRelevantOpportunity(opportunities, promptConfig) {
        // For now, only optimize other prompts if there are specific issues
        // related to their functionality
        // Example: If there are issues with doctor summaries, optimize doctor prompts
        const relevantKeywords = {
            doctor_summary: ['doctor', 'summary', 'escalation', 'clinical'],
            doctor_probe: ['doctor', 'question', 'probe', 'delegate'],
            enrichment: ['entity', 'context', 'enrichment', 'resolution'],
            intent: ['intent', 'classification', 'misclassification']
        };

        const keywords = relevantKeywords[promptConfig.file.replace('.js', '')] || [];
        
        return opportunities.some(opp => 
            keywords.some(keyword => 
                (opp.description?.toLowerCase().includes(keyword) ||
                 opp.type?.toLowerCase().includes(keyword))
            )
        );
    }

    /**
     * Filter opportunities relevant to a specific prompt type
     */
    _filterOpportunitiesForPrompt(opportunities, promptConfig) {
        if (promptConfig.file === 'unified_prompt.js') {
            // Unified prompt gets all opportunities
            return opportunities;
        }

        // Other prompts get filtered opportunities
        return opportunities.filter(opp => {
            const desc = (opp.description || '').toLowerCase();
            const type = (opp.type || '').toLowerCase();
            
            if (promptConfig.file.includes('doctor')) {
                return desc.includes('doctor') || desc.includes('escalation') || desc.includes('clinical') ||
                       type.includes('doctor') || type.includes('escalation');
            }
            
            if (promptConfig.file.includes('enrichment')) {
                return desc.includes('context') || desc.includes('entity') || desc.includes('resolution');
            }
            
            if (promptConfig.file.includes('intent')) {
                return desc.includes('intent') || desc.includes('classification');
            }
            
            return false;
        });
    }
}

