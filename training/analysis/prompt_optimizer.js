/**
 * @fileoverview training/prompt_optimizer.js
 * Uses AI meta-prompting to automatically optimize system prompts based on feedback analysis.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import config from '../../config.js';
import { FeedbackAnalyzer } from './feedback_analyzer.js';
import { OPTIMIZATION_SYSTEM_PROMPT, PROMPT_OPTIMIZATION_TEMPLATE } from '../config/analysis_prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class PromptOptimizer {
    constructor() {
        // Initialize LLM for optimization
        if (config.CHAT_GPT_KEY) {
            this.openai = new OpenAI({ apiKey: config.CHAT_GPT_KEY });
            this.useOpenAI = true;
        } else if (config.API_KEYS && config.API_KEYS.length > 0) {
            this.genAI = new GoogleGenerativeAI(config.API_KEYS[0]);
            this.useOpenAI = false;
        } else {
            throw new Error('No AI API keys configured for prompt optimization');
        }
    }

    /**
     * Load current prompt from file
     */
    async loadPrompt(promptPath) {
        try {
            const content = await fs.readFile(promptPath, 'utf8');
            
            // Extract the actual prompt content (looking for exported strings/templates)
            const match = content.match(/export\s+(?:const|let|var)\s+\w+\s*=\s*`([^`]+)`/s) ||
                         content.match(/export\s+(?:const|let|var)\s+\w+\s*=\s*"([^"]+)"/s) ||
                         content.match(/export\s+(?:const|let|var)\s+\w+\s*=\s*'([^']+)'/s);
            
            if (match) {
                return match[1];
            }
            
            // If no match, return whole file
            return content;
        } catch (error) {
            console.error('[PromptOptimizer] Error loading prompt:', error.message);
            return null;
        }
    }

    /**
     * Optimize prompts based on simulation feedback analysis
     * This is the main integration point with our new feedback system
     */
    async optimizeFromSimulationFeedback(promptPath, promptVersion = 'simulation_v1.0') {
        try {
            console.log(`[PromptOptimizer] Starting optimization for ${promptPath} (${promptVersion})`);
            
            // 1. Load current prompt
            const currentPrompt = await this.loadPrompt(promptPath);
            if (!currentPrompt) {
                throw new Error('Failed to load current prompt');
            }
            
            // 2. Get feedback analysis
            const analyzer = new FeedbackAnalyzer();
            const analysis = await analyzer.calculateRewardBackpropagation();
            
            if (!analysis || !analysis.prompt_performance[promptVersion]) {
                console.log('[PromptOptimizer] No feedback data available for optimization');
                return null;
            }
            
            // 3. Get failure pattern analysis
            const { IssueAnalyzer } = await import('./issue_analyzer.js');
            const issueAnalyzer = new IssueAnalyzer();
            const failureReport = await issueAnalyzer.generateFailurePatternReport();
            
            // 4. Create comprehensive analysis report
            const analysisReport = this._createAnalysisReport(analysis, failureReport, promptVersion);
            
            // 5. Generate optimized prompt
            const optimizedPrompt = await this.optimizePrompt(currentPrompt, analysisReport);
            
            if (!optimizedPrompt) {
                throw new Error('Failed to generate optimized prompt');
            }
            
            // 6. Save optimized prompt
            const newVersion = this._incrementVersion(promptVersion);
            const optimizedPath = await this._saveOptimizedPrompt(promptPath, optimizedPrompt, newVersion);
            
            console.log(`[PromptOptimizer] Generated optimized prompt: ${optimizedPath}`);
            
            return {
                originalPath: promptPath,
                optimizedPath: optimizedPath,
                originalVersion: promptVersion,
                newVersion: newVersion,
                analysisReport: analysisReport,
                optimizationSummary: this._generateOptimizationSummary(analysisReport)
            };
            
        } catch (error) {
            console.error('[PromptOptimizer] Error optimizing from simulation feedback:', error.message);
            return null;
        }
    }

    /**
     * Create comprehensive analysis report for prompt optimization
     */
    _createAnalysisReport(rewardAnalysis, failureReport, promptVersion) {
        const promptPerf = rewardAnalysis.prompt_performance[promptVersion];
        
        return {
            promptVersion: promptVersion,
            performance: {
                avgScore: promptPerf.avg_score,
                rewardSignal: promptPerf.reward_signal,
                failureRate: promptPerf.failure_rate,
                totalInteractions: promptPerf.total_interactions,
                goalScores: {
                    adherence: promptPerf.avg_adherence,
                    history: promptPerf.avg_history,
                    conversation: promptPerf.avg_conversation
                }
            },
            rewardSignals: rewardAnalysis.reward_signals.filter(s => s.prompt_version === promptVersion),
            optimizationOpportunities: rewardAnalysis.optimization_opportunities,
            failurePatterns: failureReport?.summary?.patterns || [],
            criticalFailures: failureReport?.summary?.total_failures || 0,
            recommendations: failureReport?.recommendations || []
        };
    }

    /**
     * Generate optimization summary
     */
    _generateOptimizationSummary(analysisReport) {
        const summary = {
            issues: [],
            improvements: [],
            priority: 'medium'
        };
        
        // Analyze performance issues
        if (analysisReport.performance.rewardSignal < -0.3) {
            summary.issues.push('Poor overall performance');
            summary.priority = 'high';
        }
        
        if (analysisReport.performance.failureRate > 0.1) {
            summary.issues.push('High critical failure rate');
            summary.priority = 'high';
        }
        
        if (analysisReport.performance.goalScores.adherence < 0.6) {
            summary.issues.push('Poor adherence goal performance');
        }
        
        // Analyze failure patterns
        analysisReport.failurePatterns.forEach(pattern => {
            if (pattern.severity === 'high') {
                summary.issues.push(`Frequent ${pattern.pattern} issues`);
                summary.priority = 'high';
            }
        });
        
        // Generate improvement suggestions
        analysisReport.recommendations.forEach(rec => {
            if (rec.priority === 'high') {
                summary.improvements.push(rec.description);
            }
        });
        
        return summary;
    }

    /**
     * Increment prompt version
     */
    _incrementVersion(currentVersion) {
        const versionMatch = currentVersion.match(/v(\d+)\.(\d+)/);
        if (versionMatch) {
            const major = parseInt(versionMatch[1]);
            const minor = parseInt(versionMatch[2]);
            return `v${major}.${minor + 1}`;
        }
        return 'v1.1';
    }

    /**
     * Save optimized prompt with new version
     */
    async _saveOptimizedPrompt(originalPath, optimizedPrompt, newVersion) {
        const pathParts = originalPath.split('/');
        const fileName = pathParts[pathParts.length - 1];
        const fileNameParts = fileName.split('.');
        const baseName = fileNameParts[0];
        const extension = fileNameParts[1] || 'js';
        
        const newFileName = `${baseName}_${newVersion}.${extension}`;
        const newPath = originalPath.replace(fileName, newFileName);
        
        // Create the optimized prompt content
        const promptContent = `/**
 * @fileoverview Optimized prompt version ${newVersion}
 * Generated by PromptOptimizer based on simulation feedback analysis
 * 
 * Original: ${originalPath}
 * Generated: ${new Date().toISOString()}
 */

export const OPTIMIZED_PROMPT = \`${optimizedPrompt}\`;

export const PROMPT_VERSION = '${newVersion}';
export const GENERATED_AT = '${new Date().toISOString()}';
export const ORIGINAL_PATH = '${originalPath}';
`;

        await fs.writeFile(newPath, promptContent, 'utf8');
        return newPath;
    }

    /**
     * Extract prompt content from AI response
     */
    _extractPromptContent(response) {
        // Look for the optimized prompt section
        const markers = [
            /OPTIMIZED PROMPT:\s*\n([\s\S]+)/i,
            /```\s*\n([\s\S]+?)\n```/,
            /^\s*(.+)/s
        ];

        for (const marker of markers) {
            const match = response.match(marker);
            if (match) {
                return match[1].trim();
            }
        }

        return response.trim();
    }

    /**
     * Save optimized prompt to new version file
     */
    async saveOptimizedPrompt(promptPath, optimizedContent, analysis) {
        // Parse current version number
        const fileName = path.basename(promptPath, '.js');
        const versionMatch = fileName.match(/_v(\d+)\.(\d+)$/);
        
        let newVersion;
        if (versionMatch) {
            const major = parseInt(versionMatch[1]);
            const minor = parseInt(versionMatch[2]);
            newVersion = `_v${major}.${minor + 1}`;
        } else {
            newVersion = '_v1.1';
        }

        const newFileName = fileName.replace(/_v\d+\.\d+$/, '') + newVersion + '.js';
        const newFilePath = path.join(path.dirname(promptPath), newFileName);

        // Generate file content
        const fileContent = `/**
 * Optimized prompt - Auto-generated by PromptOptimizer
 * Generated: ${new Date().toISOString()}
 * Base version: ${fileName}
 * 
 * Changes made:
${this._generateChangeLog(analysis)}
 */

export const optimizedPrompt = \`${optimizedContent}\`;

export default optimizedPrompt;
`;

        await fs.writeFile(newFilePath, fileContent, 'utf8');
        console.log(`\n✓ Optimized prompt saved to: ${newFilePath}`);

        return newFilePath;
    }

    /**
     * Generate changelog from analysis
     */
    _generateChangeLog(analysis) {
        if (typeof analysis === 'string') {
            // Extract key recommendations
            const lines = analysis.split('\n')
                .filter(l => l.includes('P1') || l.includes('P2') || l.includes('Recommendation'))
                .slice(0, 5)
                .map(l => ' * - ' + l.trim());
            return lines.join('\n') || ' * - General improvements based on feedback';
        }
        
        return ' * - Improvements based on performance analysis';
    }

    /**
     * Optimize a specific prompt file
     */
    async optimizePromptFile(promptPath, analysisReportPath = null) {
        console.log('[PromptOptimizer] Starting prompt optimization...\n');
        console.log(`Source prompt: ${promptPath}`);

        // Load current prompt
        const currentPrompt = await this.loadPrompt(promptPath);
        if (!currentPrompt) {
            console.error('Failed to load current prompt');
            return null;
        }

        console.log(`✓ Loaded current prompt (${currentPrompt.length} characters)\n`);

        // Get analysis report
        let analysis;
        if (analysisReportPath) {
            analysis = await fs.readFile(analysisReportPath, 'utf8');
            console.log(`✓ Loaded analysis report\n`);
        } else {
            console.log('Generating fresh analysis...');
            const analyzer = new FeedbackAnalyzer();
            const result = await analyzer.generateReport();
            analysis = result.aiAnalysis;
            console.log('✓ Analysis complete\n');
        }

        // Generate optimized prompt
        console.log('Generating optimized prompt (this may take a moment)...');
        const optimizedPrompt = await this.optimizePrompt(currentPrompt, analysis);
        
        if (!optimizedPrompt) {
            console.error('Failed to generate optimized prompt');
            return null;
        }

        console.log(`✓ Generated optimized prompt (${optimizedPrompt.length} characters)\n`);

        // Show diff preview
        this._showDiffPreview(currentPrompt, optimizedPrompt);

        // Save new version
        const newPath = await this.saveOptimizedPrompt(promptPath, optimizedPrompt, analysis);

        console.log('\n✅ Optimization complete!\n');
        console.log('Next steps:');
        console.log('  1. Review the new prompt file');
        console.log('  2. Test with simulations');
        console.log('  3. Run A/B test against current version');
        console.log('  4. Deploy if performance improves\n');

        return newPath;
    }

    /**
     * Show diff preview
     */
    _showDiffPreview(current, optimized) {
        console.log('─'.repeat(80));
        console.log('DIFF PREVIEW');
        console.log('─'.repeat(80));
        
        const currentLines = current.split('\n').length;
        const optimizedLines = optimized.split('\n').length;
        const currentWords = current.split(/\s+/).length;
        const optimizedWords = optimized.split(/\s+/).length;

        console.log(`Lines:      ${currentLines} → ${optimizedLines} (${optimizedLines > currentLines ? '+' : ''}${optimizedLines - currentLines})`);
        console.log(`Words:      ${currentWords} → ${optimizedWords} (${optimizedWords > currentWords ? '+' : ''}${optimizedWords - currentWords})`);
        console.log(`Characters: ${current.length} → ${optimized.length} (${optimized.length > current.length ? '+' : ''}${optimized.length - current.length})`);
        console.log('─'.repeat(80) + '\n');
    }

    /**
     * Batch optimize all prompts in prompts/ directory
     */
    async optimizeAllPrompts() {
        console.log('[PromptOptimizer] Batch optimization mode\n');

        const promptsDir = path.join(__dirname, '../../prompts');
        const files = await fs.readdir(promptsDir);
        const promptFiles = files.filter(f => f.endsWith('.js') && !f.includes('_v'));

        console.log(`Found ${promptFiles.length} base prompt files\n`);

        const results = [];

        for (const file of promptFiles) {
            const filePath = path.join(promptsDir, file);
            console.log(`\n${'═'.repeat(80)}`);
            console.log(`Optimizing: ${file}`);
            console.log('═'.repeat(80));

            try {
                const newPath = await this.optimizePromptFile(filePath);
                results.push({ file, success: true, newPath });
            } catch (error) {
                console.error(`Error optimizing ${file}:`, error.message);
                results.push({ file, success: false, error: error.message });
            }
        }

        // Summary
        console.log('\n' + '═'.repeat(80));
        console.log('BATCH OPTIMIZATION SUMMARY');
        console.log('═'.repeat(80));
        
        const successful = results.filter(r => r.success).length;
        console.log(`Successful: ${successful}/${results.length}`);
        
        if (successful > 0) {
            console.log('\nOptimized files:');
            results.filter(r => r.success).forEach(r => {
                console.log(`  ✓ ${r.file} → ${path.basename(r.newPath)}`);
            });
        }
        
        if (successful < results.length) {
            console.log('\nFailed:');
            results.filter(r => !r.success).forEach(r => {
                console.log(`  ✗ ${r.file}: ${r.error}`);
            });
        }
        
        console.log('═'.repeat(80) + '\n');
    }
}

/**
 * CLI interface
 */
async function main() {
    const args = process.argv.slice(2);
    const optimizer = new PromptOptimizer();

    // Check for specific prompt file
    const promptIdx = args.indexOf('--prompt');
    if (promptIdx !== -1 && args[promptIdx + 1]) {
        const promptPath = args[promptIdx + 1];
        await optimizer.optimizePromptFile(promptPath);
    }
    // Check for batch mode
    else if (args.includes('--all')) {
        await optimizer.optimizeAllPrompts();
    }
    // Default: optimize unified prompt
    else {
        await optimizer.optimizePromptFile('./prompts/unified_prompt.js');
    }
}

// Run if called directly
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || 
    process.argv[1].includes('prompt_optimizer')) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

export { PromptOptimizer };

