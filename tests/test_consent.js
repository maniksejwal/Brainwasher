import assert from 'assert';
import { runTest, setup, cleanup } from './test_runner.js';

async function testImpliedConsent() {
    const testName = "Implied Consent";
    console.log(`--- Running Test: ${testName} ---`);

    const { patient, caregiver, doctor } = await setup();
    let events = [];
    
    const onEvent = (event) => events.push(event);
    patient.on('event', onEvent);
    caregiver.on('event', onEvent);
    doctor.on('event', onEvent);

    try {
        // 1. Patient reports an issue, agent asks for consent
        await patient.sendMessage("I missed my morning medication.");
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for AI response

        let patientMessages = events.filter(e => e.userId === 'patient' && e.from === 'personal-agent');
        assert(patientMessages.some(e => e.reply.includes("share")), "Test Failed: Agent should have asked for consent.");

        // 2. Patient grants consent
        events = []; // Clear events
        await patient.sendMessage("yes, please share that");
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 3. Caregiver should receive a contextual message
        let caregiverMessages = events.filter(e => e.userId === 'caregiver' && e.from === 'personal-agent');
        assert(caregiverMessages.length > 0, "Test Failed: Caregiver should have received a message after consent.");
        
        // 4. Patient reports a follow-up on the SAME topic
        events = [];
        await patient.sendMessage("I also forgot my afternoon pills.");
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 5. Check that the agent did NOT ask for consent again
        patientMessages = events.filter(e => e.userId === 'patient' && e.from === 'personal-agent' && e.reply.includes("share"));
        assert.strictEqual(patientMessages.length, 0, "Test Failed: Agent should NOT have asked for consent again due to implied consent.");

        // 6. Caregiver should receive the second update automatically
        caregiverMessages = events.filter(e => e.userId === 'caregiver' && e.from === 'personal-agent');
        assert(caregiverMessages.length > 0, "Test Failed: Caregiver should have received the second update automatically.");

    } finally {
        await cleanup(patient, caregiver, doctor);
    }
    return true;
}


runTest(testImpliedConsent);

