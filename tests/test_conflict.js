import assert from 'assert';
import { runTest, setup, cleanup } from './test_runner.js';

async function testConflictAndClarification() {
    const testName = "Conflict Detection and Mediated Clarification";
    console.log(`--- Running Test: ${testName} ---`);

    const { patient, caregiver, doctor } = await setup();
    let events = [];
    
    const onEvent = (event) => events.push(event);
    patient.on('event', onEvent);
    caregiver.on('event', onEvent);
    doctor.on('event', onEvent);

    try {
        // 1. Patient makes a claim
        await patient.sendMessage("I took my medication today.");
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 2. Caregiver makes a conflicting claim
        events = []; // Clear events before the conflict
        await caregiver.sendMessage("He did not take his medicine this morning.");
        await new Promise(resolve => setTimeout(resolve, 4000));

        // 3. Doctor should receive an escalation
        const doctorEvents = events.filter(e => e.type === 'escalation');
        assert(doctorEvents.length > 0, "Test Failed: Doctor should have received an escalation on conflict.");
        
        // 4. Patient should receive a mediated clarification question
        const patientMessages = events.filter(e => e.userId === 'patient' && e.from === 'personal-agent');
        assert(patientMessages.some(e => e.reply.includes("Just checking in")), "Test Failed: Patient should receive a gentle clarification question.");

        // 5. Caregiver should NOT be notified of the conflict directly
        const caregiverMessages = events.filter(e => e.userId === 'caregiver' && e.from === 'personal-agent' && e.reply.toLowerCase().includes('conflict'));
        assert.strictEqual(caregiverMessages.length, 0, "Test Failed: Caregiver should not be directly told about the conflict.");
        
    } finally {
        await cleanup(patient, caregiver, doctor);
    }
    return true;
}


runTest(testConflictAndClarification);

