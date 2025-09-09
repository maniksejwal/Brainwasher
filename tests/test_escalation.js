import assert from 'assert';
import { runTest, setup, cleanup } from './test_runner.js';

async function testCriticalEscalation() {
    const testName = "Critical Event Escalation";
    console.log(`--- Running Test: ${testName} ---`);

    const { patient, caregiver, doctor } = await setup();
    let events = [];
    
    const onEvent = (event) => events.push(event);
    doctor.on('event', onEvent); // Only the doctor needs to listen for this test

    try {
        // 1. Patient reports a critical symptom
        await patient.sendMessage("I am having severe chest pain.");
        await new Promise(resolve => setTimeout(resolve, 4000)); // Wait for analysis and escalation

        // 2. Doctor should receive an escalation
        const doctorEvents = events.filter(e => e.type === 'escalation');
        assert(doctorEvents.length > 0, "Test Failed: Doctor should have received a critical escalation.");
        
    } finally {
        await cleanup(patient, caregiver, doctor);
    }
    return true;
}

runTest(testCriticalEscalation);

