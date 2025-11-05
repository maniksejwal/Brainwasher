#!/usr/bin/env node

/**
 * Enhanced CLI Simulation Runner
 * Usage: node run_simulation.js [scenario] [turns]
 * 
 * Examples:
 *   node run_simulation.js                           # Interactive scenario selection
 *   node run_simulation.js random_single 5          # Specific scenario, 5 turns
 *   node run_simulation.js full_care_circle         # Multi-user scenario
 *   node run_simulation.js --list                   # List available scenarios
 *   node run_simulation.js --personas               # List available personas
 */

import { SimulationDriver } from '../training/simulation/simulator.js';
import { WorldSimulator } from '../training/world_simulation/world_simulator.js';
import { PERSONAS } from '../training/simulation/personas.js';
import { SCENARIOS, getRandomScenario } from '../training/simulation/scenarios.js';
import { WORLD_SCENARIOS, getRandomWorldScenario } from '../training/world_simulation/world_scenarios.js';
import { getScenarioCategories, displayScenariosByCategory, displayPersonasByCategory } from '../training/simulation/scenario_categories.js';
import { displayWorldScenariosByCategory } from '../training/world_simulation/world_scenarios.js';
import { getDb } from '../db/connection.js';
import fs from 'fs';
import { readlineManager } from './readline_manager.js';
import chalk from 'chalk';

// Parse command line arguments
const args = process.argv.slice(2);
const skipFeedback = args.includes('--skip-feedback');
const fromDashboard = args.includes('--from-dashboard');

// Parse flags
let scenarioKey = null;
let turns = null;

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--scenario' && i + 1 < args.length) {
        scenarioKey = args[i + 1];
        i++; // Skip next argument
    } else if (arg.startsWith('--scenario=')) {
        scenarioKey = arg.split('=')[1];
    } else if (arg === '--turns' && i + 1 < args.length) {
        turns = parseInt(args[i + 1]);
        i++; // Skip next argument
    } else if (arg.startsWith('--turns=')) {
        turns = parseInt(arg.split('=')[1]);
    } else if (!arg.startsWith('--')) {
        // Positional arguments (backward compatibility)
        if (!scenarioKey) scenarioKey = arg;
        else if (!turns) turns = parseInt(arg);
    }
}

// Show help
if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🧪 Enhanced CLI Simulation Runner

Usage:
  node run_simulation.js [scenario] [turns]

Examples:
  node run_simulation.js                           # Interactive scenario selection
  node run_simulation.js random_single 5          # Specific scenario, 5 turns
  node run_simulation.js full_care_circle         # Multi-user scenario
  node run_simulation.js patient_caregiver_swap   # World simulation (multi-circle)
  node run_simulation.js hiding_symptoms 3        # Privacy/deception scenario
  node run_simulation.js cancer_treatment         # Multi-session scenario

Options:
  --list, -l        List all available scenarios (regular + world)
  --personas, -p    List all available personas
  --help, -h        Show this help message
  --world-only      Show only world scenarios
  --regular-only    Show only regular scenarios

Scenario Types:
  🎲 Basic: Single user conversations
  🔺 Complex: Multi-user interactions
  🚨 Privacy: Consent violations & breaches
  📉 Longitudinal: Multi-session tracking
  ⚡ Stress: Edge cases & rapid interactions
  🌍 World: Multi-care circle dynamics (role inversions, family networks)
`);
    process.exit(0);
}

// List scenarios
if (args.includes('--list') || args.includes('-l')) {
    console.log(chalk.cyan.bold('\n📋 Available Regular Scenarios:\n'));
    displayScenariosByCategory();
    
    if (!args.includes('--regular-only')) {
        console.log(chalk.cyan.bold('\n🌍 Available World Scenarios:\n'));
        displayWorldScenariosByCategory();
    }
    
    console.log('');
    process.exit(0);
}

// List world scenarios only
if (args.includes('--world-only')) {
    console.log(chalk.cyan.bold('\n🌍 Available World Scenarios:\n'));
    displayWorldScenariosByCategory();
    console.log('');
    process.exit(0);
}

// List personas
if (args.includes('--personas') || args.includes('-p')) {
    console.log('\n👤 Available Personas:\n');
    displayPersonasByCategory();
    console.log('');
    process.exit(0);
}

// Get scenario and turns from parsed arguments

async function runSimulation() {
    console.log(chalk.cyan.bold('🧪 Starting Enhanced CLI Simulation...\n'));
    
    // Set simulation mode for database connection
    process.env.SIMULATION_MODE = 'true';
    
    // Select scenario (check both regular and world)
    let selectedScenario;
    let isWorldScenario = false;
    
    if (!scenarioKey) {
        // Interactive scenario selection
        selectedScenario = await selectScenarioInteractively();
        isWorldScenario = selectedScenario.isWorld || false;
    } else if (scenarioKey === 'random') {
        // Random regular scenario (backward compatibility)
        const randomKey = getRandomScenario();
        selectedScenario = { key: randomKey, ...SCENARIOS[randomKey], isWorld: false };
        console.log(chalk.green(`🎲 Random scenario selected: ${selectedScenario.name}`));
        isWorldScenario = false;
    } else {
        // Check both regular and world scenarios
        if (SCENARIOS[scenarioKey]) {
            selectedScenario = { key: scenarioKey, ...SCENARIOS[scenarioKey], isWorld: false };
            isWorldScenario = false;
        } else if (WORLD_SCENARIOS[scenarioKey]) {
            selectedScenario = { ...WORLD_SCENARIOS[scenarioKey], isWorld: true };
            isWorldScenario = true;
        } else {
            console.error(chalk.red(`❌ Scenario '${scenarioKey}' not found. Use --list to see available scenarios.`));
            process.exit(1);
        }
        console.log(chalk.green(`🎯 Scenario from CLI: ${selectedScenario.name}${isWorldScenario ? ' (World Simulation)' : ''}`));
    }
    
    // Auto-detect world scenario if not explicitly set
    if (!isWorldScenario && checkIsWorldScenario(selectedScenario)) {
        isWorldScenario = true;
        selectedScenario.isWorld = true;
    }
    
    // Route to appropriate simulator
    if (isWorldScenario) {
        await runWorldSimulation(selectedScenario, turns);
        return;
    }
    
    // Regular simulation
    console.log(chalk.gray(`📊 Using simulation database: ./care_circle_simulation.db`));
    const sim = new SimulationDriver({ autoFeedback: true, logResults: true });
    
    console.log(chalk.cyan.bold(`📋 Scenario: ${selectedScenario.name}`));
    console.log(chalk.gray(`📝 Description: ${selectedScenario.description}`));
    console.log(chalk.gray(`🏷️ Category: ${selectedScenario.category}`));
    console.log(chalk.gray(`⭐ Complexity: ${'★'.repeat(selectedScenario.complexity)}`));
    console.log(chalk.gray(`👥 Users: ${selectedScenario.users.length}`));
    
    if (selectedScenario.multiSession) {
        console.log(chalk.gray(`📅 Multi-session: ${selectedScenario.sessions} sessions (${selectedScenario.sessionGap} apart)`));
    }
    
    if (selectedScenario.circles) {
        console.log(chalk.gray(`🌍 Circles: ${selectedScenario.circles.length}`));
    }
    
    if (selectedScenario.instructions) {
        console.log(chalk.gray(`💡 Instructions: ${selectedScenario.instructions}`));
    }
    
    // Use specified turns or scenario default
    const defaultTurns = selectedScenario.multiSession ? selectedScenario.sessions : (selectedScenario.turns || 5);
    const finalTurns = turns || defaultTurns;
    console.log(chalk.gray(`🔄 Turns: ${finalTurns}\n`));
    
    // Build user configurations
    const userConfigs = selectedScenario.users.map((user, index) => ({
        userId: `cli_${user.role}_${index + 1}`,
        role: user.role,
        personaKey: user.personaKey,
        relationship: user.relationship,
        consent: user.consent,
        specialty: user.specialty
    }));
    
    const config = {
        name: selectedScenario.name,
        users: userConfigs,
        turns: finalTurns,
        complexity: selectedScenario.complexity,
        instructions: selectedScenario.instructions || `CLI simulation: ${selectedScenario.name}`,
        multiSession: selectedScenario.multiSession,
        sessions: selectedScenario.sessions,
        sessionGap: selectedScenario.sessionGap
    };
    
    try {
        console.log('=' .repeat(80));
        await sim.runScenario(config, selectedScenario.key);
        console.log('=' .repeat(80));
        console.log('\n✅ Simulation completed successfully!');
        
        // Show summary
        console.log(chalk.cyan.bold('\n📊 Summary:'));
        console.log(`   Scenario: ${selectedScenario.name}`);
        console.log(`   Users: ${userConfigs.length} (${userConfigs.map(u => `${u.role}:${u.personaKey}`).join(', ')})`);
        console.log(`   Turns: ${finalTurns}`);
        console.log(`   Feedback: Auto-generated (see above)`);
        
        // Offer per-message feedback
        if (skipFeedback) {
            console.log('\n⏭️ Skipping feedback collection (--skip-feedback flag)');
            // Skip post-simulation menu and exit cleanly
            if (!fromDashboard) {
                console.log('\n✅ Simulation completed successfully!');
                readlineManager.cleanup();
                process.exit(0);
            }
            return;
        }
        
        try {
            readlineManager.initialize();
        
        console.log('\n💬 Feedback Options:');
        console.log('   Press ENTER to skip feedback');
        console.log('   Type message number (e.g., "1", "2") to give feedback on that turn');
        console.log('   Type "all" to give overall feedback');
        console.log('   Type "q" to quit');
        
        const choice = await readlineManager.askQuestion('\n❓ Provide feedback? (enter/1/2/all/q): ');
            
            if (choice && choice.toLowerCase() === 'q') {
                console.log('👋 Exiting feedback collection...');
                readlineManager.cleanup();
                process.exit(0); // Exit completely when user quits feedback
            }
        
        if (choice && choice !== '') {
            const db = await getDb();
            
                if (choice.toLowerCase() === 'all') {
                // Overall feedback
                const score = await readlineManager.askQuestion('Overall quality (-1/0/1): ');
                const comment = await readlineManager.askQuestion('What should improve? ');
                
                const feedbackScore = parseInt(score);
                if (!isNaN(feedbackScore) && feedbackScore >= -1 && feedbackScore <= 1) {
                    try {
                    await db.run(`
                        INSERT INTO feedback (conversation_id, user_id, circle_id, score, comment, timestamp)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [
                        `cli_sim_${Date.now()}`,
                            `cli_user_1`,
                            `cli_circle_1`,
                        feedbackScore,
                        `[Overall] ${comment}`,
                        Date.now()
                    ]);
                    console.log('✅ Overall feedback saved!');
                    } catch (error) {
                        console.log(`❌ Error saving feedback: ${error.message}`);
                }
            } else {
                    console.log('❌ Invalid score. Please enter -1, 0, or 1.');
                }
                
                // Exit after feedback collection
                readlineManager.cleanup();
                process.exit(0);
            }
        } else if (choice && choice !== '') {
                // Specific turn feedback
                const turnNum = parseInt(choice);
                if (!isNaN(turnNum) && turnNum >= 1 && turnNum <= finalTurns) {
                    console.log(`\n📝 Feedback for Turn ${turnNum}:`);
                    const score = await new Promise(resolve => {
                        rl.question('Quality (-1/0/1): ', resolve);
                    });
                    const comment = await new Promise(resolve => {
                        rl.question('What was wrong/right? ', resolve);
                    });
                    
                    const feedbackScore = parseInt(score);
                    if (!isNaN(feedbackScore) && feedbackScore >= -1 && feedbackScore <= 1) {
                        await db.run(`
                            INSERT INTO feedback (conversation_id, user_id, circle_id, score, comment, timestamp)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `, [
                            `cli_sim_${Date.now()}_turn${turnNum}`,
                            `cli_user_1`,
                            `cli_circle_1`,
                            feedbackScore,
                            `[Turn ${turnNum}] ${comment}`,
                            Date.now()
                        ]);
                        console.log(`✅ Turn ${turnNum} feedback saved!`);
                    }
                }
                
                // Exit after specific turn feedback
                readlineManager.cleanup();
                process.exit(0);
            }
        } finally {
            // No need to cleanup readline - managed by readlineManager
        }
        
        // Show post-simulation menu (skip if running from dashboard)
        if (!fromDashboard) {
            await showPostSimulationMenu();
        }
        
    } catch (error) {
        console.error('\n❌ Simulation failed:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    } finally {
        await sim.cleanup();
        
        // Keep simulation database for training pipeline analysis
        console.log(`📊 Simulation database preserved for training analysis`);
        
        // Clear simulation mode
        delete process.env.SIMULATION_MODE;
    }
}

/**
 * Check if scenario is a world scenario (has circles array and users with circles property)
 */
function checkIsWorldScenario(scenario) {
    return scenario && Array.isArray(scenario.circles) && 
           scenario.users && scenario.users.some(u => Array.isArray(u.circles));
}

/**
 * Interactive scenario selection (includes both regular and world scenarios)
 */
async function selectScenarioInteractively() {
    readlineManager.initialize();

    console.log(chalk.cyan.bold('\n🎯 Interactive Scenario Selection\n'));
    
    // Show regular scenarios first
    console.log(chalk.bold('📋 Regular Scenarios:'));
    const regularOptions = displayScenariosByCategory(true);
    let optionNumber = regularOptions.length + 1;
    
    // Show world scenarios
    console.log(chalk.bold('\n🌍 World Scenarios:'));
    const worldOptions = displayWorldScenariosByCategory(true);
    const allOptions = [...regularOptions.map(o => ({ ...o, isWorld: false })), 
                        ...worldOptions.map(o => ({ ...o, isWorld: true }))];
    
    // Add random options
    console.log(chalk.bold(`\n🎲 Random Options:`));
    console.log(`  ${optionNumber.toString().padStart(2)}. 🎲 Random regular scenario`);
    allOptions.push({ key: 'random_regular', isWorld: false });
    optionNumber++;
    
    console.log(`  ${optionNumber.toString().padStart(2)}. 🌍 Random world scenario`);
    allOptions.push({ key: 'random_world', isWorld: true });
    optionNumber++;

    const choice = await readlineManager.askQuestion(`\nSelect scenario (1-${allOptions.length}): `);

    const choiceNum = parseInt(choice);
    if (isNaN(choiceNum) || choiceNum < 1 || choiceNum > allOptions.length) {
        console.log(chalk.yellow('Invalid choice. Using random regular scenario.'));
        const randomKey = getRandomScenario();
        return { key: randomKey, ...SCENARIOS[randomKey], isWorld: false };
    }

    const selected = allOptions[choiceNum - 1];
    
    if (selected.key === 'random_regular') {
        const randomKey = getRandomScenario();
        return { key: randomKey, ...SCENARIOS[randomKey], isWorld: false };
    } else if (selected.key === 'random_world') {
        const randomScenario = getRandomWorldScenario();
        return { ...randomScenario, isWorld: true };
    } else if (selected.isWorld) {
        return { ...selected, isWorld: true };
    } else {
        return { key: selected.key, ...selected.scenario, isWorld: false };
    }
}

/**
 * Run world simulation
 */
async function runWorldSimulation(selectedScenario, turnsOverride) {
    console.log(chalk.cyan.bold('🌍 Starting World Simulation...\n'));
    
    const worldSim = new WorldSimulator({
        logResults: true,
        autoFeedback: true
    });
    
    try {
        console.log('='.repeat(80));
        await worldSim.runWorldScenario(selectedScenario.key);
        console.log('='.repeat(80));
        console.log(chalk.green.bold('\n✅ World simulation completed successfully!'));
        
        // Show summary
        console.log(chalk.cyan.bold('\n📊 Summary:'));
        console.log(`   Scenario: ${selectedScenario.name}`);
        console.log(`   Users: ${selectedScenario.users.length}`);
        console.log(`   Circles: ${selectedScenario.circles?.length || 0}`);
        console.log(`   Turns: ${selectedScenario.turns}`);
        console.log(`   Feedback: Auto-generated`);
        
    } catch (error) {
        console.error(chalk.red('\n❌ World simulation failed:'), error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    } finally {
        await worldSim.cleanup();
        delete process.env.SIMULATION_MODE;
        
        // Exit if skipFeedback flag is set (non-interactive mode)
        const args = process.argv.slice(2);
        if (args.includes('--skip-feedback')) {
            // Force immediate exit
            process.exit(0);
        }
    }
}

/**
 * Interactive menu after simulation completion
 */
async function showPostSimulationMenu() {
    readlineManager.initialize();

    const question = (prompt) => readlineManager.askQuestion(prompt);

    try {
        console.log('\n🎯 Simulation Complete! What would you like to do next?');
        console.log('1. Run another simulation');
        console.log('2. List available scenarios');
        console.log('3. List available personas');
        console.log('4. Collect human feedback');
        console.log('5. Exit');
        
        const choice = await question('\nEnter your choice (1-5): ');
        
        switch (choice.trim()) {
            case '1':
                console.log('\n🔄 Starting new simulation...\n');
                await runSimulation(); // Recursive call
                break;
                
            case '2':
                console.log('\n📋 Available Scenarios:');
                displayScenariosByCategory();
                await showPostSimulationMenu(); // Show menu again
                break;
                
            case '3':
                console.log('\n👥 Available Personas:');
                displayPersonasByCategory();
                await showPostSimulationMenu(); // Show menu again
                break;
                
            case '4':
                console.log('\n🎯 Opening Human Feedback Collection...');
                // Import and run the feedback collector
                const { spawn } = await import('child_process');
                const feedbackProcess = spawn('node', ['cli/collect_feedback.js', '--recent'], { 
                    stdio: 'inherit',
                    shell: true 
                });
                feedbackProcess.on('close', async () => {
                    await showPostSimulationMenu(); // Return to menu after feedback
                });
                break;
                
            case '5':
                console.log('\n👋 Goodbye!');
                readlineManager.cleanup();
                process.exit(0);
                break;
                
            default:
                console.log('\n❌ Invalid choice. Please enter 1-5.');
                await showPostSimulationMenu(); // Show menu again
        }
    } catch (error) {
        console.error(`❌ Menu error: ${error.message}`);
        process.exit(1);
    }
}

// Run the simulation
runSimulation().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
