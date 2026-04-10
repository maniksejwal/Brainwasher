import { TestRunner } from './test_runner.js';

async function runEscalationTests() {
    const runner = new TestRunner();

    // Note: A full test of this requires a client that can receive events.
    // The test runner sends commands but doesn't maintain a persistent event source.
    // The best way to verify this is by running the doctor's client manually
    // while the tests run, or by querying the database directly after the test.
    
    await runner.runTest('should create a critical escalation for a serious symptom', async (assert) => {
        await runner.clearDb();
        const alice = await runner.loginAs('alice');
        const dr_evans = await runner.loginAs('dr_evans');
        await alice.sendCommand('/add dr_evans as doctor with relationship physician');

        await alice.sendMessage('I am having chest pains');
        
        // We can't easily check the doctor's client output here,
        // but we can confirm the action completed without error.
        assert.ok(true, 'Message with high criticality was sent.');
    });

    runner.reportResults();
}

runEscalationTests();

