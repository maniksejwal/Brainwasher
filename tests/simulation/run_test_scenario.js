
import { SimulationDriver } from './training/simulation/simulator.js';
import { getScenarios } from './training/simulation/scenarios.js';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

async function main() {
    console.log('🚀 Starting Test Simulation...');

    // 1. Get Scenario
    const allScenarios = getScenarios({ includeGenerated: true });
    // Pick a known generated scenario
    // If not found, pick first generated one
    const keys = Object.keys(allScenarios).filter(k => k.startsWith('generated_'));
    const scenarioKey = 'generated_denial_prone_critical_symptoms' || keys[0];

    // Fallback if specific one not found
    const keyToUse = allScenarios[scenarioKey] ? scenarioKey : keys[0];

    console.log(`📋 Selected Scenario: ${keyToUse}`);

    const context = allScenarios[keyToUse];
    // Override turns for speed
    context.turns = 3;

    // 2. Run Simulation
    const driver = new SimulationDriver({
        dbPath: './test_simulation.db', // Use separate DB for safety
        autoFeedback: true,
        logResults: true
    });

    await driver.runScenario(context, keyToUse);

    // 3. Verify DB
    console.log('\n🔍 Verifying Database Content...');
    const db = await open({
        filename: './test_simulation.db',
        driver: sqlite3.Database
    });

    const feedback = await db.all('SELECT * FROM feedback ORDER BY id DESC LIMIT 1');
    const detailed = await db.all('SELECT * FROM detailed_feedback ORDER BY report_id DESC LIMIT 1');
    const session = await db.all('SELECT * FROM conversation_analysis ORDER BY id DESC LIMIT 1');

    console.log('\n--- FEEDBACK ROW ---');
    if (feedback.length) {
        console.log(`Scenario Name: ${feedback[0].scenario_name}`);
        console.log(`Persona Name: ${feedback[0].persona_name}`);
        console.log(`Score: ${feedback[0].score}`);
    } else {
        console.log('No feedback records found.');
    }

    console.log('\n--- SESSION ANALYSIS ROW ---');
    if (session.length) {
        console.log(`Scenario Name: ${session[0].scenario_name}`);
        console.log(`Persona Name: ${session[0].persona_name}`);
    } else {
        console.log('No session analysis records found.');
    }

    await db.close();
}

main().catch(console.error);
