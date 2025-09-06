import assert from 'assert';
import { EOL } from 'os';

// --- Test Runner for Multi-Agent System ---

const ORCHESTRATOR_URL = "http://127.0.0.1:5000";
const patientId = 'patient';
const caregiverId = 'caregiver';

// --- Helper Functions ---
async function apiPost(endpoint, body) {
    const response = await fetch(`${ORCHESTRATOR_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return response.json();
}

async function apiGet(endpoint) {
    const response = await fetch(`${ORCHESTRATOR_URL}${endpoint}`);
    return response.json();
}

// --- Test Cases ---
async function runTests() {
    console.log("--- Running System Tests ---");

    // Test 1: Baseline communication and personal agent reply
    console.log("Running Test Case 1: Simple Patient Disclosure...");
    await apiPost('/test/reset'); // Reset database for a clean test
    await apiPost('/register', { userId: patientId });
    await apiPost('/register', { userId: caregiverId });
    await apiPost('/send', { userId: patientId, message: "I didn't have time for breakfast this morning." });
    let { messages: patientMessages } = await apiGet(`/fetch?userId=${patientId}`);
    let { messages: caregiverMessages } = await apiGet(`/fetch?userId=${caregiverId}`);
    assert(patientMessages[0].includes('[personal-agent says]'), 'Test 1 Failed: Patient did not receive personal reply.');
    assert(caregiverMessages[0].includes('[patient says]'), 'Test 1 Failed: Caregiver did not receive broadcast message.');
    console.log("  -> Test Case 1 Passed!");


    // Test 3: Conflict Detection (Core IP)
    console.log("Running Test Case 3: Patient & Caregiver Conflict...");
    await apiPost('/test/reset');
    await apiPost('/register', { userId: patientId });
    await apiPost('/register', { userId: caregiverId });
    await apiPost('/send', { userId: patientId, message: "Feeling good, I took my medicine this morning." });
    await apiPost('/send', { userId: caregiverId, message: "He did not take his medicine today." });
    caregiverMessages = (await apiGet(`/fetch?userId=${caregiverId}`)).messages;
    assert(caregiverMessages.some(m => m.includes('[System Alert]')), 'Test 3 Failed: Caregiver did not receive conflict alert.');
    console.log("  -> Test Case 3 Passed!");


    // Test 6: Privacy Discriminator (Core IP)
    console.log("Running Test Case 6: Patient Discloses Sensitive Info...");
    await apiPost('/test/reset');
    await apiPost('/register', { userId: patientId });
    await apiPost('/register', { userId: caregiverId });
    await apiPost('/send', { userId: patientId, message: "This is a secret, but I'm really stressed about how expensive my meds are." });
    caregiverMessages = (await apiGet(`/fetch?userId=${caregiverId}`)).messages;
    assert(caregiverMessages.length === 0, 'Test 6 Failed: Caregiver received a private message.');
    console.log("  -> Test Case 6 Passed!");
    
    // Test 11: Consent Manager (New Feature)
    console.log("Running Test Case 11: Consent Manager Blocks Communication...");
    await apiPost('/test/reset');
    await apiPost('/register', { userId: patientId });
    await apiPost('/register', { userId: caregiverId });
    // Patient sets consent for caregiver to 'none'
    await apiPost('/consent/set', { patientId, caregiverId, relationshipType: 'friend', consentLevel: 'none' });
    // Patient sends a message
    await apiPost('/send', { userId: patientId, message: "Just a regular update." });
    let { messages: caregiverMessages } = await apiGet(`/fetch?userId=${caregiverId}`);
    assert(caregiverMessages.length === 0, 'Test 11 Failed: Caregiver received a message despite consent being "none".');
    console.log("  -> Test Case 11 Passed!");


    console.log(EOL + "--- All tests passed successfully! ---");
}

runTests().catch(err => {
    console.error(EOL + "--- A TEST FAILED ---");
    console.error(err);
    process.exit(1);
});

