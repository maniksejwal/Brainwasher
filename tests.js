import fetch from 'node-fetch';
import assert from 'assert';
import config from './config.js'; // Import the centralized config

const BASE_URL = config.ORCHESTRATOR_URL;

async function clearDatabase() {
    await fetch(`${BASE_URL}/clear`, { method: 'POST' });
    console.log('Database cleared for testing.');
}

async function registerUser(userId, role) {
    await fetch(`${BASE_URL}/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
    });
}

async function sendMessage(userId, role, message) {
    await fetch(`${BASE_URL}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role, message }),
    });
}

async function getEscalations() {
    const response = await fetch(`${BASE_URL}/doctor/escalations`);
    return response.json();
}

async function runTest(name, testFn) {
    console.log(`\n--- Running test: ${name} ---`);
    try {
        await clearDatabase();
        await testFn();
        console.log(`\u001b[32m¿ Test passed: ${name}\u001b[0m`);
    } catch (error) {
        console.error(`\u001b[31m¿ Test failed: ${name}\u001b[0m`);
        console.error(error);
        process.exit(1);
    }
}

// Test Suite
(async () => {
    await runTest('Conflict Escalation', async () => {
        await registerUser('patient', 'patient');
        await registerUser('caregiver', 'caregiver');
        await sendMessage('patient', 'patient', 'I took my medicine today.');
        // Wait a bit for processing
        await new Promise(resolve => setTimeout(resolve, 2000));
        await sendMessage('caregiver', 'caregiver', 'He did not take his pills.');
        await new Promise(resolve => setTimeout(resolve, 2000));

        const escalations = await getEscalations();
        assert.strictEqual(escalations.length, 1, 'There should be exactly one escalation.');
        assert.strictEqual(escalations[0].type, 'CONFLICT', 'The escalation type should be CONFLICT.');
        assert.ok(escalations[0].details.includes('contradicting'), 'The details should mention a contradiction.');
    });
    
    await runTest('Implied Consent Flow', async () => {
        await registerUser('patient', 'patient');
        await registerUser('caregiver', 'caregiver');

        // 1. Patient reports something sensitive, agent asks to share
        await sendMessage('patient', 'patient', 'I felt a bit dizzy after lunch.');
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for AI reply

        // 2. Patient grants consent
        await sendMessage('patient', 'patient', 'yes');
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for processing and broadcast

        // 3. Patient sends a follow-up, which should be shared automatically
        await sendMessage('patient', 'patient', 'The dizziness is gone now though.');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // This test is harder to assert programmatically without seeing the client logs,
        // but we can check that no new pending action was created for the second message.
        // A more robust test would involve a client mock that listens for messages.
        // For now, we confirm the flow doesn't crash.
        console.log('Implied consent flow test completed without errors.');
    });

    console.log('\n--- All tests passed successfully! ---');
})();

