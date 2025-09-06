import chalk from 'chalk';
const ORCHESTRATOR_URL = "http://127.0.0.1:5000";
let testCount = 0;
let passCount = 0;

// --- Helper Functions ---
const api = {
    post: async (endpoint, body) => {
        return fetch(`${ORCHESTRATOR_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    },
    get: async (endpoint) => fetch(`${ORCHESTRATOR_URL}${endpoint}`)
};

const assert = (condition, message) => {
    testCount++;
    if (condition) {
        passCount++;
        console.log(chalk.green(`  ¿ PASS: ${message}`));
    } else {
        console.error(chalk.red(`  ¿ FAIL: ${message}`));
        process.exit(1); // Exit on failure
    }
};

const getMessages = async (userId) => {
    const res = await api.get(`/fetch/${userId}`);
    const { messages } = await res.json();
    return messages;
};

// --- Test Cases ---
async function runTests() {
    console.log(chalk.blue.bold("\n--- Running System Integration Tests ---\n"));

    // Test 1: Reset database
    console.log(chalk.yellow("1. Resetting Database State..."));
    await api.post('/test/reset');
    await api.post('/register', { userId: 'patient' });
    await api.post('/register', { userId: 'caregiver' });
    console.log(chalk.gray("   Database reset and users registered.\n"));

    // Test 2: Simple message and personal reply
    console.log(chalk.yellow("2. Testing Simple Message & Personal Reply..."));
    await api.post('/send', { userId: 'patient', message: 'I feel fine today.' });
    const patientMessages1 = await getMessages('patient');
    assert(patientMessages1.some(m => m.startsWith('[Personal Note]')), 'Patient should receive a personal note.');
    
    // Test 3: Diplomatic broadcast
    console.log(chalk.yellow("\n3. Testing Diplomatic Broadcast..."));
    const caregiverMessages1 = await getMessages('caregiver');
    assert(caregiverMessages1.some(m => m.startsWith('[Care Circle Update]')), 'Caregiver should receive a care circle update.');

    // Test 4: Conflict detection and silent escalation
    console.log(chalk.yellow("\n4. Testing Conflict Detection & Silent Escalation..."));
    await api.post('/send', { userId: 'patient', message: 'I took my medicine.' });
    await api.post('/send', { userId: 'caregiver', message: 'He did not take his medicine.' });
    const doctorMessages1 = await api.get('/fetch/doctor').then(res => res.json());
    assert(doctorMessages1.escalations.some(e => e.content.startsWith('CONFLICT')), 'Doctor should receive a conflict escalation.');
    const patientMessages2 = await getMessages('patient');
    assert(!patientMessages2.some(m => m.startsWith('[Discrepancy Noted]')), 'Patient should NOT receive a direct conflict alert.');

    // Test 5: Privacy discriminator
    console.log(chalk.yellow("\n5. Testing Privacy Discriminator..."));
    await api.post('/send', { userId: 'patient', message: 'I have a secret financial debt.' });
    const caregiverMessages2 = await getMessages('caregiver');
    assert(!caregiverMessages2.some(m => m.includes('debt')), 'Caregiver should not receive private financial info.');
    
    // Test 6: Critical Keyword Escalation
    console.log(chalk.yellow("\n6. Testing Critical Keyword Escalation..."));
    await api.post('/send', { userId: 'caregiver', message: 'The patient fainted this morning!' });
    const doctorMessages2 = await api.get('/fetch/doctor').then(res => res.json());
    assert(doctorMessages2.escalations.some(e => e.content.startsWith('CRITICAL ALERT')), 'Doctor should receive a critical alert for "fainted".');


    console.log(chalk.blue.bold("\n--- All Tests Finished ---"));
    console.log(chalk.green.bold(`Result: ${passCount}/${testCount} tests passed.`));
}

// --- Main Execution ---
runTests().catch(err => {
    console.error(chalk.red("\n--- A CRITICAL ERROR OCCURRED ---"));
    console.error(err);
    process.exit(1);
});

