#!/usr/bin/env node

/**
 * Simple CLI Simulation Runner
 * Usage: node run_simulation.js [persona] [turns]
 * 
 * Examples:
 *   node run_simulation.js                           # Random persona, 3 turns
 *   node run_simulation.js medication_nonadherent   # Specific persona, 3 turns  
 *   node run_simulation.js verbose_patient 5        # Specific persona, 5 turns
 *   node run_simulation.js --list                   # List available personas
 */

import { SimulationDriver } from '../training/simulation/simulator.js';
import { PERSONAS } from '../training/simulation/personas.js';
import { getDb } from '../db/connection.js';
import fs from 'fs';
import readline from 'readline';

// Parse command line arguments
const args = process.argv.slice(2);

// Show help
if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🧪 CLI Simulation Runner

Usage:
  node run_simulation.js [persona] [turns]

Examples:
  node run_simulation.js                           # Random persona, 3 turns
  node run_simulation.js medication_nonadherent   # Specific persona, 3 turns  
  node run_simulation.js verbose_patient 5        # Specific persona, 5 turns
  node run_simulation.js --list                   # List available personas

Options:
  --list, -l    List all available personas
  --help, -h    Show this help message
`);
    process.exit(0);
}

// List personas
if (args.includes('--list') || args.includes('-l')) {
    console.log('\n📋 Available Personas:\n');
    
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

// Get persona and turns from arguments
const personaKey = args[0] || 'random';
const turns = parseInt(args[1]) || 3;

async function runSimulation() {
    console.log('🧪 Starting CLI Simulation...\n');
    
    // Clean up any existing simulation DB
    const dbPath = './cli_simulation.db';
    if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
    }
    
    const sim = new SimulationDriver(dbPath, true, true); // autoFeedback=true, logResults=true
    
    // Select persona
    let selectedPersona;
    if (personaKey === 'random') {
        const allPersonas = Object.keys(PERSONAS);
        selectedPersona = allPersonas[Math.floor(Math.random() * allPersonas.length)];
        console.log(`🎲 Random persona selected: ${selectedPersona}`);
    } else {
        if (!PERSONAS[personaKey]) {
            console.error(`❌ Persona '${personaKey}' not found. Use --list to see available personas.`);
            process.exit(1);
        }
        selectedPersona = personaKey;
    }
    
    const personaInfo = PERSONAS[selectedPersona];
    console.log(`👤 Persona: ${personaInfo.name}`);
    console.log(`📝 Description: ${personaInfo.description}`);
    console.log(`🔄 Turns: ${turns}\n`);
    
    // Determine role from persona key
    let role = 'patient';
    if (selectedPersona.includes('caregiver')) role = 'caregiver';
    if (selectedPersona.includes('doctor')) role = 'doctor';
    
    const config = {
        users: [{ 
            userId: `cli_${role}_1`,
            role: role,
            personaKey: selectedPersona
        }],
        turns: turns,
        complexity: 1,
        instructions: `CLI simulation with ${selectedPersona}`
    };
    
    try {
        console.log('=' .repeat(80));
        await sim.runScenario(config);
        console.log('=' .repeat(80));
        console.log('\n✅ Simulation completed successfully!');
        
        // Show summary
        console.log('\n📊 Summary:');
        console.log(`   Persona: ${personaInfo.name}`);
        console.log(`   Turns: ${turns}`);
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
                        `cli_${role}_1`,
                        `cli_${role}_1`,
                        feedbackScore,
                        `[Overall] ${comment}`,
                        Date.now()
                    ]);
                    console.log('✅ Overall feedback saved!');
                }
            } else {
                // Specific turn feedback
                const turnNum = parseInt(choice);
                if (!isNaN(turnNum) && turnNum >= 1 && turnNum <= turns) {
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
                            `cli_${role}_1`,
                            `cli_${role}_1`,
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
        
    } catch (error) {
        console.error('\n❌ Simulation failed:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    } finally {
        await sim.cleanup();
        
        // Clean up CLI simulation DB
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }
    }
}

// Run the simulation
runSimulation().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
