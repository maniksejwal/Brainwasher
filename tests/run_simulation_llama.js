/**
 * @fileoverview Run a simulation using Llama 4 model
 */

import config from '../config.js';
import { ConversationRunner } from '../training/simulation/conversation_runner.js';
import { SimulationDriver } from '../training/simulation/simulator.js';

// --- CONFIGURATION OVERRIDE ---
// Force the use of Llama 4 for the primary agent roles
console.log('🔄 Reconfiguring for Llama 4 Simulation...');
config.CONVERSATIONAL_AGENT_MODEL = 'llama4';
config.BASIC_RESPONSES_MODEL = 'llama4';
config.SYNTHETIC_USER_MODEL = 'llama4'; // Also use Llama for the user sim if possible/supported
// -----------------------------

async function runLlamaSimulation() {
    console.log('🚀 Starting Llama 4 Simulation Run...');
    console.log(`Agent Model: ${config.CONVERSATIONAL_AGENT_MODEL}`);
    console.log(`User Model: ${config.SYNTHETIC_USER_MODEL}`);

    const driver = new SimulationDriver();
    // await driver.initialize(); // No explicit initialize method found/needed based on common pattern, constructor does setup


    console.log('✅ Simulation Driver Initialized');

    // Create a temporary scenario
    const scenario = {
        id: 'llama_test_01',
        name: 'Llama 4 Capability Test', // 'name' seems expected by logger
        description: 'Testing Llama 4 in a medical consultation context',
        turns: 6,
        users: [
            {
                role: 'patient',
                name: 'Sarah Jonas',
                age: 34,
                condition: 'Migraine',
                personality: 'Anxious',
                situation: 'Patient is experiencing severe headache and sensitivity to light.'
            }
        ]
    };

    console.log(`\n📋 Running Scenario: ${scenario.title}`);
    console.log('------------------------------------------------');

    try {
        const result = await driver.runScenario(scenario);
        console.log('------------------------------------------------');
        console.log('✅ Simulation Complete');
        console.log(`Moves: ${result.conversation_length}`);
        console.log(`Goal Achieved: ${result.goal_achieved}`);

        console.log('\n📜 Conversation Excerpt:');
        if (result.training_log && result.training_log.messages) {
            result.training_log.messages.slice(0, 4).forEach(msg => {
                console.log(`[${msg.sender}]: ${msg.content.substring(0, 100)}...`);
            });
        }

    } catch (error) {
        console.error('❌ Simulation Failed:', error);
    }
}

runLlamaSimulation().catch(console.error);
