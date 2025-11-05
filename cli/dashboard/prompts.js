/**
 * @fileoverview Prompt Management Dashboard
 * Interactive prompt viewing, comparison, and diff functionality
 */

import chalk from 'chalk';
import { getAllPromptVersions, getPromptVersion, getCurrentDeployedPrompt } from '../../db/index.js';
import { readlineManager } from '../readline_manager.js';
import fs from 'fs/promises';
import path from 'path';

export class PromptDashboard {
    constructor() {
        this.prompts = [];
        this.currentPrompt = null;
    }

    async initialize() {
        // No database initialization needed - uses existing db/index.js
    }

    /**
     * Show main prompt management menu
     */
    async showMainMenu() {
        console.log(chalk.cyan.bold('\n📝 PROMPT MANAGEMENT'));
        console.log('-'.repeat(50));
        console.log('1. List All Prompts');
        console.log('2. View Prompt Details');
        console.log('3. Compare Prompts (Diff View)');
        console.log('4. View Current Deployed Prompt');
        console.log('5. Back to Main Dashboard');
        console.log('-'.repeat(50));

        const choice = await readlineManager.askQuestion('Select option (1-5): ');
        return choice.trim();
    }

    /**
     * List all prompt versions
     */
    async listPrompts() {
        try {
            this.prompts = await getAllPromptVersions(100);
            
            if (this.prompts.length === 0) {
                console.log(chalk.yellow('\nNo prompts found in database'));
                console.log(chalk.yellow('Prompts are saved when optimization runs'));
                return;
            }

            console.log(chalk.cyan.bold('\n📝 ALL PROMPT VERSIONS'));
            console.log('-'.repeat(100));
            console.log(
                chalk.bold('#'.padEnd(4)) +
                chalk.bold('Version'.padEnd(25)) +
                chalk.bold('Name/Description'.padEnd(40)) +
                chalk.bold('Score'.padEnd(8)) +
                chalk.bold('Deployed')
            );
            console.log('-'.repeat(100));

            this.prompts.forEach((prompt, index) => {
                const num = (index + 1).toString().padEnd(4);
                const version = (prompt.version || 'N/A').substring(0, 24).padEnd(25);
                const name = (prompt.name || 'Unnamed').substring(0, 39).padEnd(40);
                const score = (prompt.performance_score?.toFixed(2) || '0.00').padEnd(8);
                const deployed = prompt.deployed_at 
                    ? chalk.green('✓ ' + new Date(prompt.deployed_at).toLocaleDateString())
                    : '-';
                
                console.log(num + version + name + score + deployed);
            });

            console.log(`\n${chalk.bold('Total:')} ${this.prompts.length} prompt versions`);
        } catch (error) {
            console.error(chalk.red('Error fetching prompts:'), error.message);
        }
    }

    /**
     * View detailed prompt information
     */
    async viewPrompt() {
        await this.listPrompts();
        
        if (this.prompts.length === 0) {
            return;
        }

        const choice = await readlineManager.askQuestion('\nSelect prompt number to view (or Enter to go back): ');
        if (!choice.trim()) return;

        const index = parseInt(choice) - 1;
        if (isNaN(index) || index < 0 || index >= this.prompts.length) {
            console.log(chalk.red('Invalid selection'));
            return;
        }

        const prompt = this.prompts[index];
        this.currentPrompt = prompt;

        await this.displayPromptDetails(prompt);
    }

    /**
     * Display full prompt details
     */
    async displayPromptDetails(prompt) {
        console.log(chalk.cyan.bold('\n📄 PROMPT DETAILS'));
        console.log('-'.repeat(80));
        console.log(chalk.bold('Version:'), prompt.version);
        if (prompt.name) console.log(chalk.bold('Name:'), prompt.name);
        console.log(chalk.bold('Score:'), prompt.performance_score?.toFixed(2) || '0.00');
        console.log(chalk.bold('Created:'), new Date(prompt.created_at).toLocaleString());
        if (prompt.deployed_at) {
            console.log(chalk.bold('Deployed:'), new Date(prompt.deployed_at).toLocaleString());
        }
        console.log(chalk.bold('Length:'), `${prompt.content.length} characters`);
        
        console.log(chalk.cyan.bold('\n📝 CONTENT:'));
        console.log('-'.repeat(80));
        console.log(prompt.content);
        console.log('-'.repeat(80));
    }

    /**
     * Compare prompts with diff view
     */
    async comparePrompts() {
        await this.listPrompts();
        
        if (this.prompts.length === 0) {
            return;
        }

        console.log(chalk.yellow('\n💡 Compare any two prompts to see what changed'));
        
        const choice1 = await readlineManager.askQuestion('Select first prompt (number): ');
        const index1 = parseInt(choice1) - 1;
        if (isNaN(index1) || index1 < 0 || index1 >= this.prompts.length) {
            console.log(chalk.red('Invalid selection'));
            return;
        }

        const choice2 = await readlineManager.askQuestion('Select second prompt to compare (number, or "original" for original prompt): ');
        let prompt2;
        
        if (choice2.toLowerCase() === 'original') {
            // Get original prompt from file
            prompt2 = await this.getOriginalPrompt(this.prompts[index1]);
            if (!prompt2) {
                console.log(chalk.yellow('Could not find original prompt file'));
                return;
            }
        } else {
            const index2 = parseInt(choice2) - 1;
            if (isNaN(index2) || index2 < 0 || index2 >= this.prompts.length) {
                console.log(chalk.red('Invalid selection'));
                return;
            }
            prompt2 = this.prompts[index2];
        }

        const prompt1 = this.prompts[index1];
        await this.showDiff(prompt1, prompt2);
    }

    /**
     * Get original prompt from file
     */
    async getOriginalPrompt(optimizedPrompt) {
        try {
            // Extract prompt file from version (e.g., "doctor_prompts_v..." -> "doctor_prompts.js")
            const versionMatch = optimizedPrompt.version.match(/^([^_]+(?:_[^_]+)?)_v\d+$/);
            if (!versionMatch) return null;

            const promptFile = versionMatch[1] + '.js';
            const promptPath = path.join(process.cwd(), 'prompts', promptFile);
            
            const content = await fs.readFile(promptPath, 'utf8');
            
            // Determine which export based on name
            let exportName = null;
            if (optimizedPrompt.name) {
                if (optimizedPrompt.name.toLowerCase().includes('probe')) {
                    exportName = 'PROMPT_DELEGATED_PROBE';
                } else if (optimizedPrompt.name.toLowerCase().includes('summary')) {
                    exportName = 'PROMPT_DOCTOR_SUMMARY';
                } else if (optimizedPrompt.name.toLowerCase().includes('unified')) {
                    exportName = 'PROMPT_UNIFIED_AGENT_WITH_STATE';
                } else if (optimizedPrompt.name.toLowerCase().includes('enrichment')) {
                    exportName = 'PROMPT_CONTEXT_ENRICHMENT';
                }
            }

            // Extract specific export if known
            if (exportName) {
                const specificExport = new RegExp(`export\\s+(?:const|let|var)\\s+${exportName}\\s*=\\s*\`([^\`]+)\``, 's');
                const match = content.match(specificExport);
                if (match) {
                    return {
                        version: 'original',
                        name: `Original ${exportName}`,
                        content: match[1],
                        created_at: Date.now()
                    };
                }
            }

            // Fallback: extract first prompt export
            const exportMatch = content.match(/export\s+(?:const|let|var)\s+PROMPT_\w+\s*=\s*`([^`]+)`/s);
            if (exportMatch) {
                return {
                    version: 'original',
                    name: 'Original Prompt',
                    content: exportMatch[1],
                    created_at: Date.now()
                };
            }

            return null;
        } catch (error) {
            console.warn(chalk.yellow(`Could not read original prompt: ${error.message}`));
            return null;
        }
    }

    /**
     * Show diff between two prompts
     */
    async showDiff(prompt1, prompt2) {
        console.log(chalk.cyan.bold('\n📊 PROMPT DIFF'));
        console.log('-'.repeat(80));
        console.log(chalk.bold('Prompt 1:'), prompt1.name || prompt1.version);
        console.log(chalk.bold('Prompt 2:'), prompt2.name || prompt2.version);
        console.log('-'.repeat(80));

        const diff = this.computeDiff(prompt1.content, prompt2.content);
        
        console.log(chalk.cyan.bold('\n📝 CHANGES:'));
        console.log('-'.repeat(80));
        
        if (diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0) {
            console.log(chalk.green('No changes - prompts are identical'));
        } else {
            if (diff.removed.length > 0) {
                console.log(chalk.red.bold('\n➖ REMOVED:'));
                diff.removed.forEach(line => {
                    console.log(chalk.red('- ' + line));
                });
            }

            if (diff.modified.length > 0) {
                console.log(chalk.yellow.bold('\n🔄 MODIFIED:'));
                diff.modified.forEach(({ old, new: newLine }) => {
                    console.log(chalk.red('- ' + old));
                    console.log(chalk.green('+ ' + newLine));
                });
            }

            if (diff.added.length > 0) {
                console.log(chalk.green.bold('\n➕ ADDED:'));
                diff.added.forEach(line => {
                    console.log(chalk.green('+ ' + line));
                });
            }

            console.log(chalk.cyan.bold('\n📊 SUMMARY:'));
            console.log(`  Added: ${chalk.green(diff.added.length + ' lines')}`);
            console.log(`  Removed: ${chalk.red(diff.removed.length + ' lines')}`);
            console.log(`  Modified: ${chalk.yellow(diff.modified.length + ' lines')}`);
            const lengthDiff = prompt1.content.length - prompt2.content.length;
            const lengthColor = lengthDiff > 0 ? chalk.red : lengthDiff < 0 ? chalk.green : chalk.gray;
            console.log(`  Length change: ${lengthColor(lengthDiff + ' characters')}`);
        }
        console.log('-'.repeat(80));
    }

    /**
     * Enhanced diff algorithm with context and word-level changes
     */
    computeDiff(text1, text2) {
        const lines1 = text1.split('\n');
        const lines2 = text2.split('\n');
        
        const added = [];
        const removed = [];
        const modified = [];
        
        // Use longest common subsequence approach for better diff
        const maxLen = Math.max(lines1.length, lines2.length);
        const seen1 = new Set();
        const seen2 = new Set();
        
        // First pass: find exact matches
        for (let i = 0; i < lines1.length; i++) {
            for (let j = 0; j < lines2.length; j++) {
                if (lines1[i] === lines2[j] && !seen2.has(j)) {
                    seen1.add(i);
                    seen2.add(j);
                    break;
                }
            }
        }
        
        // Second pass: find removed lines
        for (let i = 0; i < lines1.length; i++) {
            if (!seen1.has(i)) {
                removed.push(lines1[i]);
            }
        }
        
        // Third pass: find added lines
        for (let j = 0; j < lines2.length; j++) {
            if (!seen2.has(j)) {
                added.push(lines2[j]);
            }
        }
        
        // Fourth pass: find modified lines (similar but not identical)
        for (let i = 0; i < lines1.length; i++) {
            if (!seen1.has(i)) {
                // Try to find a similar line in text2
                for (let j = 0; j < lines2.length; j++) {
                    if (!seen2.has(j)) {
                        const similarity = this.lineSimilarity(lines1[i], lines2[j]);
                        if (similarity > 0.5 && similarity < 1.0) {
                            modified.push({
                                old: lines1[i],
                                new: lines2[j],
                                similarity: similarity
                            });
                            seen2.add(j);
                            break;
                        }
                    }
                }
            }
        }
        
        return { added, removed, modified };
    }

    /**
     * Calculate similarity between two lines (0-1)
     */
    lineSimilarity(line1, line2) {
        if (line1 === line2) return 1.0;
        if (!line1 || !line2) return 0.0;
        
        const words1 = line1.toLowerCase().split(/\s+/);
        const words2 = line2.toLowerCase().split(/\s+/);
        
        const allWords = new Set([...words1, ...words2]);
        let commonWords = 0;
        
        words1.forEach(word => {
            if (words2.includes(word)) {
                commonWords++;
            }
        });
        
        return allWords.size > 0 ? commonWords / allWords.size : 0.0;
    }

    /**
     * View currently deployed prompt
     */
    async viewDeployedPrompt() {
        try {
            const deployed = await getCurrentDeployedPrompt();
            
            if (!deployed) {
                console.log(chalk.yellow('\nNo deployed prompt found'));
                return;
            }

            await this.displayPromptDetails(deployed);
        } catch (error) {
            console.error(chalk.red('Error fetching deployed prompt:'), error.message);
        }
    }

    /**
     * Main run loop
     */
    async run() {
        try {
            await this.initialize();
            
            while (true) {
                const choice = await this.showMainMenu();
                
                switch (choice) {
                    case '1':
                        await this.listPrompts();
                        break;
                    case '2':
                        await this.viewPrompt();
                        break;
                    case '3':
                        await this.comparePrompts();
                        break;
                    case '4':
                        await this.viewDeployedPrompt();
                        break;
                    case '5':
                        return; // Back to main dashboard
                    default:
                        console.log(chalk.red('Invalid choice. Please enter 1-5.'));
                }
                
                await readlineManager.askQuestion('\nPress Enter to continue...');
            }
        } catch (error) {
            console.error(chalk.red('Prompt dashboard error:'), error.message);
        }
    }
}

