#!/usr/bin/env node

/**
 * @fileoverview Prompt Management CLI
 * View and search prompt versions stored in the database
 */

import { getDb } from '../db/connection.js';
import { 
    getAllPromptVersions, 
    findPromptVersionsByName, 
    getCurrentDeployedPrompt,
    getPromptVersion
} from '../db/index.js';
import chalk from 'chalk';

async function main() {
    const command = process.argv[2];
    const arg = process.argv[3];
    
    try {
        const db = await getDb();
        
        switch (command) {
            case 'list':
            case 'ls':
                await listPrompts();
                break;
                
            case 'find':
            case 'search':
                if (!arg) {
                    console.log(chalk.red('❌ Please provide a search term'));
                    console.log('Usage: node cli/prompts.js find <name>');
                    process.exit(1);
                }
                await findPrompts(arg);
                break;
                
            case 'show':
            case 'view':
                if (!arg) {
                    console.log(chalk.red('❌ Please provide a prompt version'));
                    console.log('Usage: node cli/prompts.js show <version>');
                    process.exit(1);
                }
                await showPrompt(arg);
                break;
                
            case 'current':
            case 'deployed':
                await showCurrentPrompt();
                break;
                
            default:
                showUsage();
                break;
        }
    } catch (error) {
        console.error(chalk.red(`❌ Error: ${error.message}`));
        process.exit(1);
    }
}

async function listPrompts() {
    console.log(chalk.cyan('📝 All Prompt Versions\n'));
    
    const prompts = await getAllPromptVersions(100);
    
    if (prompts.length === 0) {
        console.log(chalk.yellow('No prompts found in database'));
        console.log(chalk.yellow('\nThis could mean:'));
        console.log(chalk.yellow('  - Prompts were only used in simulations (not saved to DB)'));
        console.log(chalk.yellow('  - Check feedback table for simulation prompt versions'));
        return;
    }
    
    console.log(chalk.bold('#'.padEnd(4)) + 
                chalk.bold('Version'.padEnd(18)) + 
                chalk.bold('Name/Description'.padEnd(40)) + 
                chalk.bold('Created'.padEnd(22)) + 
                chalk.bold('Score'.padEnd(8)) + 
                chalk.bold('Deployed'));
    console.log('-'.repeat(100));
    
    for (let i = 0; i < prompts.length; i++) {
        const prompt = prompts[i];
        const num = (i + 1).toString().padEnd(4);
        const version = (prompt.version || 'N/A').substring(0, 17).padEnd(18);
        const name = (prompt.name || 'Unnamed').substring(0, 38).padEnd(40);
        const created = new Date(prompt.created_at).toLocaleString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).padEnd(22);
        const score = (prompt.performance_score?.toFixed(2) || '0.00').padEnd(8);
        const deployed = prompt.deployed_at ? chalk.green('✓ ' + new Date(prompt.deployed_at).toLocaleDateString()) : '-';
        
        console.log(num + version + name + created + score + deployed);
        if (prompt.version) {
            console.log(chalk.gray(`    Use: node cli/prompts.js show ${prompt.version}`));
        }
    }
    
    console.log(`\nTotal: ${prompts.length} prompt versions`);
    console.log(chalk.yellow('\n💡 Tip: Use names/descriptions to identify prompts, not version codes!'));
    console.log(chalk.yellow('   Example: node cli/prompts.js find "optimization"'));
}

async function findPrompts(searchTerm) {
    console.log(chalk.cyan(`🔍 Searching for prompts matching: "${searchTerm}"\n`));
    
    const prompts = await findPromptVersionsByName(searchTerm);
    
    if (prompts.length === 0) {
        console.log(chalk.yellow('No matching prompts found'));
        return;
    }
    
    for (const prompt of prompts) {
        console.log(chalk.bold(`Version: ${prompt.version}`));
        if (prompt.name) console.log(`Name: ${prompt.name}`);
        console.log(`Score: ${prompt.performance_score?.toFixed(2) || '0.00'}`);
        console.log(`Created: ${new Date(prompt.created_at).toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
        })}`);
        if (prompt.deployed_at) {
            console.log(`Deployed: ${new Date(prompt.deployed_at).toLocaleString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short'
            })}`);
        }
        console.log('-'.repeat(60));
    }
}

async function showPrompt(version) {
    console.log(chalk.cyan(`📄 Prompt Version: ${version}\n`));
    
    // Handle numeric input (from list)
    let lookupVersion = version;
    if (/^\d+$/.test(version)) {
        const prompts = await getAllPromptVersions(100);
        const index = parseInt(version) - 1;
        if (index >= 0 && index < prompts.length) {
            lookupVersion = prompts[index].version;
            console.log(chalk.gray(`Using prompt #${version}: ${lookupVersion}`));
        }
    }
    
    // Try multiple lookup strategies
    let prompt = await getPromptVersion(lookupVersion);
    
    // If not found, try partial match (for timestamp versions)
    if (!prompt && version.startsWith('v')) {
        const timestamp = version.substring(1);
        const prompts = await findPromptVersionsByName(timestamp);
        if (prompts.length > 0) {
            prompt = prompts[0]; // Use first match
            console.log(chalk.yellow(`⚠️  Exact match not found, using closest match: ${prompt.version}`));
        }
    }
    
    // If still not found, try searching in feedback table for simulation versions
    if (!prompt) {
        try {
            const { getDb } = await import('../db/connection.js');
            const db = await getDb();
            
            // Check if prompt_version column exists
            const tableInfo = await db.all(`
                PRAGMA table_info(feedback)
            `);
            const hasPromptVersion = tableInfo.some(col => col.name === 'prompt_version');
            
            if (hasPromptVersion) {
                const feedbackRow = await db.get(`
                    SELECT DISTINCT prompt_version 
                    FROM feedback 
                    WHERE prompt_version LIKE ?
                    LIMIT 1
                `, [`%${version}%`]);
                
                if (feedbackRow && feedbackRow.prompt_version) {
                    console.log(chalk.yellow(`⚠️  Found in feedback table: ${feedbackRow.prompt_version}`));
                    console.log(chalk.yellow(`   This prompt may exist only in simulations, not in prompt_versions table.`));
                    console.log(chalk.yellow(`   The prompt content is not stored - only feedback data exists.`));
                    return;
                }
            }
        } catch (error) {
            // Silently ignore if feedback table doesn't exist or column is missing
            // This is expected for older databases
        }
    }
    
    if (!prompt) {
        console.log(chalk.red(`Prompt version "${version}" not found in database`));
        console.log(chalk.yellow('\nThis could mean:'));
        console.log(chalk.yellow('  1. Prompt was used in simulations before the recent fix (optimized prompts are now saved)'));
        console.log(chalk.yellow('  2. Prompt version exists only in feedback table (simulation-only version)'));
        console.log(chalk.yellow('  3. Version format mismatch (e.g., "simulation_v1762081806470_scenario" vs "v1762081806470")'));
        console.log(chalk.yellow('\nNote: Optimized prompts ARE now automatically saved to database when created.'));
        console.log(chalk.yellow('      Old simulation-only prompts can still be analyzed via feedback table.'));
        console.log(chalk.yellow('\nTry:'));
        console.log('  node cli/prompts.js list');
        console.log(`  node cli/analyze_prompts.js feedback ${version}`);
        return;
    }
    
    console.log(chalk.bold('Version:'), prompt.version);
    if (prompt.name) console.log(chalk.bold('Name:'), prompt.name);
    console.log(chalk.bold('Score:'), prompt.performance_score?.toFixed(2) || '0.00');
    console.log(chalk.bold('Created:'), new Date(prompt.created_at).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    }));
    if (prompt.deployed_at) {
        console.log(chalk.bold('Deployed:'), new Date(prompt.deployed_at).toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
        }));
    }
    console.log('\n' + chalk.bold('Content:'));
    console.log('-'.repeat(80));
    console.log(prompt.content.substring(0, 500) + (prompt.content.length > 500 ? '...' : ''));
    console.log('-'.repeat(80));
    console.log(`\nFull length: ${prompt.content.length} characters`);
}

async function showCurrentPrompt() {
    console.log(chalk.cyan('📄 Currently Deployed Prompt\n'));
    
    const prompt = await getCurrentDeployedPrompt();
    
    if (!prompt) {
        console.log(chalk.yellow('No deployed prompt found'));
        return;
    }
    
    console.log(chalk.bold('Version:'), prompt.version);
    if (prompt.name) console.log(chalk.bold('Name:'), prompt.name);
    console.log(chalk.bold('Score:'), prompt.performance_score?.toFixed(2) || '0.00');
    console.log(chalk.bold('Deployed:'), new Date(prompt.deployed_at).toLocaleString());
    console.log('\n' + chalk.bold('Content (first 500 chars):'));
    console.log('-'.repeat(80));
    console.log(prompt.content.substring(0, 500) + '...');
}

function showUsage() {
    console.log(chalk.cyan('📝 Prompt Management CLI\n'));
    console.log('Usage: node cli/prompts.js <command> [arguments]\n');
    console.log('Commands:');
    console.log('  list, ls              List all prompt versions');
    console.log('  find, search <term>    Search prompts by name or version');
    console.log('  show, view <version>   Show full prompt content by version');
    console.log('  current, deployed      Show currently deployed prompt\n');
    console.log('Examples:');
    console.log('  node cli/prompts.js list');
    console.log('  node cli/prompts.js find "optimized"');
    console.log('  node cli/prompts.js show v1762012142761');
    console.log('  node cli/prompts.js current');
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
    process.argv[1]?.includes('prompts.js')) {
    main().catch(console.error);
}

export { listPrompts, findPrompts, showPrompt, showCurrentPrompt };

