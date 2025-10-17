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

import { SimulationDriver } from '../training/simulation/simulator_clean.js';
import { PERSONAS } from '../training/simulation/personas.js';
import { SCENARIOS, getRandomScenario } from '../training/simulation/scenarios.js';
import { getDb } from '../db/connection.js';
import fs from 'fs';
import readline from 'readline';

// Parse command line arguments
const args = process.argv.slice(2);

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
  node run_simulation.js hiding_symptoms 3        # Privacy/deception scenario
  node run_simulation.js cancer_treatment         # Multi-session scenario

Options:
  --list, -l        List all available scenarios
  --personas, -p    List all available personas
  --help, -h        Show this help message

Scenario Types:
  🎲 Basic: Single user conversations
  🔺 Complex: Multi-user interactions
  🚨 Privacy: Consent violations & breaches
  📉 Longitudinal: Multi-session tracking
  ⚡ Stress: Edge cases & rapid interactions
`);
    process.exit(0);
}

// List scenarios
if (args.includes('--list') || args.includes('-l')) {
    console.log('\n📋 Available Scenarios:\n');
    
    const categories = {
        '🎲 Basic Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'basic'),
        '🔺 Complex Multi-User': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'complex'),
        '🚨 Privacy & Consent': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'privacy'),
        '⚠️ Conflict Resolution': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'conflict'),
        '📉 Longitudinal': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'longitudinal'),
        '⚡ Stress Testing': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'stress_test'),
        '🤐 Deception': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'deception'),
        '🚑 Escalation': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'escalation')
    };
    
    for (const [category, scenarios] of Object.entries(categories)) {
        if (scenarios.length > 0) {
            console.log(`\n${category}:`);
            scenarios.forEach(([key, scenario]) => {
                const complexity = '★'.repeat(scenario.complexity);
                const multiUser = scenario.users.length > 1 ? '👥' : '👤';
                const multiSession = scenario.multiSession ? '📅' : '';
                console.log(`  ${key.padEnd(25)} - ${scenario.name} ${multiUser}${multiSession} ${complexity}`);
            });
        }
    }
    console.log('');
    process.exit(0);
}

// List personas
if (args.includes('--personas') || args.includes('-p')) {
    console.log('\n👤 Available Personas:\n');
    
    const categories = {
        'Patient Personas': Object.keys(PERSONAS).filter(k => 
            k.includes('patient') || ['medication_nonadherent', 'recently_diagnosed', 'complex_comorbid', 'terminal_acceptance'].includes(k)
        ),
        'Caregiver Personas': Object.keys(PERSONAS).filter(k => k.includes('caregiver')),
        'Doctor Personas': Object.keys(PERSONAS).filter(k => k.includes('doctor')),
        'Verbosity Variations': Object.keys(PERSONAS).filter(k => 
            ['minimal_words_patient', 'poor_grammar_patient', 'non_english_patient', 'verbose_patient', 'rambling_caregiver'].includes(k)
        )
    };
    
    for (const [category, personas] of Object.entries(categories)) {
        if (personas.length > 0) {
            console.log(`\n${category}:`);
            personas.forEach(persona => {
                const info = PERSONAS[persona];
                console.log(`  ${persona.padEnd(25)} - ${info.name}`);
            });
        }
    }
    console.log('');
    process.exit(0);
}

// Get scenario and turns from arguments
const scenarioKey = args[0];
const turns = parseInt(args[1]) || null; // Will use scenario default if not specified

async function runSimulation() {
    console.log('🧪 Starting Enhanced CLI Simulation...\n');
    
    // Set simulation mode for database connection
    process.env.SIMULATION_MODE = 'true';
    
    // Clean up any existing simulation DB (with retry for Windows)
    const dbPath = './care_circle_simulation.db';
    if (fs.existsSync(dbPath)) {
        try {
            fs.unlinkSync(dbPath);
        } catch (error) {
            console.warn(`⚠️  Could not delete existing simulation database: ${error.message}`);
            console.warn(`   Database may be in use by another process. Continuing with existing database.`);
        }
    }
    
    const sim = new SimulationDriver({ autoFeedback: true, logResults: true });
    
    // Select scenario
    let selectedScenario;
    if (!scenarioKey) {
        // Interactive scenario selection
        selectedScenario = await selectScenarioInteractively();
    } else if (scenarioKey === 'random') {
        const randomKey = getRandomScenario();
        selectedScenario = { key: randomKey, ...SCENARIOS[randomKey] };
        console.log(`🎲 Random scenario selected: ${selectedScenario.name}`);
    } else {
        if (!SCENARIOS[scenarioKey]) {
            console.error(`❌ Scenario '${scenarioKey}' not found. Use --list to see available scenarios.`);
            process.exit(1);
        }
        selectedScenario = { key: scenarioKey, ...SCENARIOS[scenarioKey] };
    }
    
    console.log(`📋 Scenario: ${selectedScenario.name}`);
    console.log(`📝 Description: ${selectedScenario.description}`);
    console.log(`🏷️ Category: ${selectedScenario.category}`);
    console.log(`⭐ Complexity: ${'★'.repeat(selectedScenario.complexity)}`);
    console.log(`👥 Users: ${selectedScenario.users.length}`);
    
    if (selectedScenario.multiSession) {
        console.log(`📅 Multi-session: ${selectedScenario.sessions} sessions (${selectedScenario.sessionGap} apart)`);
    }
    
    if (selectedScenario.instructions) {
        console.log(`💡 Instructions: ${selectedScenario.instructions}`);
    }
    
    // Use specified turns or scenario default
    const finalTurns = turns || (selectedScenario.multiSession ? 3 : 5);
    console.log(`🔄 Turns: ${finalTurns}\n`);
    
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
        await sim.runScenario(config);
        console.log('=' .repeat(80));
        console.log('\n✅ Simulation completed successfully!');
        
        // Show summary
        console.log('\n📊 Summary:');
        console.log(`   Scenario: ${selectedScenario.name}`);
        console.log(`   Users: ${userConfigs.length} (${userConfigs.map(u => `${u.role}:${u.personaKey}`).join(', ')})`);
        console.log(`   Turns: ${finalTurns}`);
        console.log(`   Feedback: Auto-generated (see above)`);
        
        // Offer per-message feedback
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        console.log('\n💬 Feedback Options:');
        console.log('   Press ENTER to skip feedback');
        console.log('   Type message number (e.g., "1", "2") to give feedback on that turn');
        console.log('   Type "all" to give overall feedback');
        
        const choice = await new Promise(resolve => {
            rl.question('\n❓ Provide feedback? (enter/1/2/all): ', resolve);
        });
        
        if (choice && choice !== '') {
            const db = await getDb();
            
            if (choice.toLowerCase() === 'all') {
                // Overall feedback
                const score = await new Promise(resolve => {
                    rl.question('Overall quality (-1/0/1): ', resolve);
                });
                const comment = await new Promise(resolve => {
                    rl.question('What should improve? ', resolve);
                });
                
                const feedbackScore = parseInt(score);
                if (!isNaN(feedbackScore) && feedbackScore >= -1 && feedbackScore <= 1) {
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
                }
            } else {
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
            }
        }
        
        rl.close();
        
        // Show post-simulation menu
        await showPostSimulationMenu();
        
    } catch (error) {
        console.error('\n❌ Simulation failed:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    } finally {
        await sim.cleanup();
        
        // Clean up simulation DB (with retry for Windows)
        if (fs.existsSync(dbPath)) {
            try {
                fs.unlinkSync(dbPath);
            } catch (error) {
                console.warn(`⚠️  Could not delete simulation database: ${error.message}`);
            }
        }
        
        // Clear simulation mode
        delete process.env.SIMULATION_MODE;
    }
}

/**
 * Interactive scenario selection
 */
async function selectScenarioInteractively() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('\n🎯 Interactive Scenario Selection\n');
    
    // Group scenarios by category
    const categories = {
        '🎲 Basic (Single User)': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'basic'),
        '🔺 Complex (Multi-User)': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'complex'),
        '🚨 Privacy & Consent': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'privacy'),
        '⚠️ Conflict Resolution': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'conflict'),
        '📉 Longitudinal (Multi-Session)': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'longitudinal'),
        '⚡ Stress Testing': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'stress_test'),
        '🤐 Deception': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'deception'),
        '🚑 Escalation': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'escalation')
    };

    let optionNumber = 1;
    const options = [];

    for (const [category, scenarios] of Object.entries(categories)) {
        if (scenarios.length > 0) {
            console.log(`\n${category}:`);
            scenarios.forEach(([key, scenario]) => {
                const complexity = '★'.repeat(scenario.complexity);
                const multiUser = scenario.users.length > 1 ? '👥' : '👤';
                const multiSession = scenario.multiSession ? '📅' : '';
                console.log(`  ${optionNumber.toString().padStart(2)}. ${scenario.name} ${multiUser}${multiSession} ${complexity}`);
                options.push({ key, scenario });
                optionNumber++;
            });
        }
    }

    console.log(`\n  ${optionNumber.toString().padStart(2)}. 🎲 Random scenario`);
    options.push({ key: 'random', scenario: null });

    const choice = await new Promise(resolve => {
        rl.question(`\nSelect scenario (1-${optionNumber}): `, resolve);
    });

    rl.close();

    const choiceNum = parseInt(choice);
    if (isNaN(choiceNum) || choiceNum < 1 || choiceNum > optionNumber) {
        console.log('Invalid choice. Using random scenario.');
        const randomKey = getRandomScenario();
        return { key: randomKey, ...SCENARIOS[randomKey] };
    }

    const selected = options[choiceNum - 1];
    if (selected.key === 'random') {
        const randomKey = getRandomScenario();
        return { key: randomKey, ...SCENARIOS[randomKey] };
    }

    return { key: selected.key, ...selected.scenario };
}

/**
 * Interactive menu after simulation completion
 */
async function showPostSimulationMenu() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

    try {
        console.log('\n🎯 Simulation Complete! What would you like to do next?');
        console.log('1. Run another simulation');
        console.log('2. List available scenarios');
        console.log('3. List available personas');
        console.log('4. Exit');
        
        const choice = await question('\nEnter your choice (1-4): ');
        
        switch (choice.trim()) {
            case '1':
                console.log('\n🔄 Starting new simulation...\n');
                rl.close();
                await runSimulation(); // Recursive call
                break;
                
            case '2':
                console.log('\n📋 Available Scenarios:');
                const categories = {
                    '🎲 Basic Scenarios': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'basic'),
                    '🔺 Complex Multi-User': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'complex'),
                    '🚨 Privacy & Consent': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'privacy'),
                    '⚠️ Conflict Resolution': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'conflict'),
                    '📉 Longitudinal': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'longitudinal'),
                    '⚡ Stress Testing': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'stress_test'),
                    '🤐 Deception': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'deception'),
                    '🚑 Escalation': Object.entries(SCENARIOS).filter(([_, s]) => s.category === 'escalation')
                };
                
                for (const [category, scenarios] of Object.entries(categories)) {
                    if (scenarios.length > 0) {
                        console.log(`\n${category}:`);
                        scenarios.forEach(([key, scenario]) => {
                            const complexity = '★'.repeat(scenario.complexity);
                            const multiUser = scenario.users.length > 1 ? '👥' : '👤';
                            const multiSession = scenario.multiSession ? '📅' : '';
                            console.log(`  ${key.padEnd(25)} - ${scenario.name} ${multiUser}${multiSession} ${complexity}`);
                        });
                    }
                }
                rl.close();
                await showPostSimulationMenu(); // Show menu again
                break;
                
            case '3':
                console.log('\n👥 Available Personas:');
                const personaCategories = {
                    'Patient Personas': Object.keys(PERSONAS).filter(k => 
                        k.includes('patient') || ['medication_nonadherent', 'recently_diagnosed', 'complex_comorbid', 'terminal_acceptance'].includes(k)
                    ),
                    'Caregiver Personas': Object.keys(PERSONAS).filter(k => k.includes('caregiver')),
                    'Doctor Personas': Object.keys(PERSONAS).filter(k => k.includes('doctor')),
                    'Verbosity Variations': Object.keys(PERSONAS).filter(k => 
                        ['minimal_words_patient', 'poor_grammar_patient', 'non_english_patient', 'verbose_patient', 'rambling_caregiver'].includes(k)
                    )
                };
                
                for (const [category, personas] of Object.entries(personaCategories)) {
                    if (personas.length > 0) {
                        console.log(`\n${category}:`);
                        personas.forEach(persona => {
                            const info = PERSONAS[persona];
                            console.log(`  ${persona.padEnd(25)} - ${info.name}`);
                        });
                    }
                }
                rl.close();
                await showPostSimulationMenu(); // Show menu again
                break;
                
            case '4':
                console.log('\n👋 Goodbye!');
                rl.close();
                process.exit(0);
                break;
                
            default:
                console.log('\n❌ Invalid choice. Please enter 1-4.');
                rl.close();
                await showPostSimulationMenu(); // Show menu again
        }
    } catch (error) {
        console.error(`❌ Menu error: ${error.message}`);
        rl.close();
        process.exit(1);
    }
}

// Run the simulation
runSimulation().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
