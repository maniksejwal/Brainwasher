import assert from 'assert';
import { runTest, setup, cleanup } from './test_runner.js';

async function testDoctorDirectiveWorkflow() {
    const testName = "Doctor Directive Workflow";
    console.log(`--- Running Test: ${testName} ---`);

    const { patient, caregiver, doctor } = await setup();
    let events = [];
    
    const onEvent = (event) => events.push(event);
    patient.on('event', onEvent);
    doctor.on('event', onEvent);

    try {
        // 1. Patient reports a critical symptom, triggering an escalation
        await patient.sendMessage("I fell down and hit my head.");
        await new Promise(resolve => setTimeout(resolve, 4000));

        // 2. Doctor should receive the escalation
        let doctorEvents = events.filter(e => e.type === 'escalation');
        assert(doctorEvents.length > 0, "Test Failed: Doctor should have received the escalation.");

        // 3. Doctor sends a directive
        events = []; // Clear events before the directive
        await doctor.sendMessage("ask patient about dizziness");
        await new Promise(resolve => setTimeout(resolve, 4000));

        // 4. Patient should receive a natural, translated question
        const patientMessages = events.filter(e => e.userId === 'patient' && e.from === 'personal-agent');
        assert(patientMessages.some(e => e.reply.toLowerCase().includes("dizzy") || e.reply.toLowerCase().includes("dizziness")), "Test Failed: Patient should have received a question about dizziness.");
        
    } finally {
        await cleanup(patient, caregiver, doctor);
    }
    return true;
}

runTest(testDoctorDirectiveWorkflow);
