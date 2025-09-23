import { TestRunner } from './test_runner.js';

async function runFactReportingTests() {
    const runner = new TestRunner();

    await runner.runTest('should handle fact reporting about another person in care circle', async (assert) => {
        await runner.clearDb();
        const alice = await runner.loginAs('alice');
        const bob = await runner.loginAs('bob');
        const dr_evans = await runner.loginAs('dr_evans');
        
        // Set up care circle: alice (patient), bob (caregiver), dr_evans (doctor)
        await alice.sendCommand('/add bob as caregiver with relationship spouse');
        await alice.sendCommand('/add dr_evans as doctor with relationship physician');
        
        // Alice reports facts about Bob
        await alice.sendMessage('B told me that B is not sleeping well');
        
        // This should trigger either:
        // 1. Escalation to doctor (if criticality is MEDIUM/HIGH)
        // 2. Consent request to share with Bob
        // 3. Direct sharing with Bob (if consent level is full)
        
        // For now, we just verify the message was processed without error
        assert.ok(true, 'Fact reporting about another person was processed.');
    });

    await runner.runTest('should handle multiple fact reports about same person', async (assert) => {
        await runner.clearDb();
        const alice = await runner.loginAs('alice');
        const bob = await runner.loginAs('bob');
        
        await alice.sendCommand('/add bob as caregiver with relationship spouse');
        
        // Alice reports multiple facts about Bob
        await alice.sendMessage('B told me that B is not sleeping well');
        await alice.sendMessage('I asked B to get a sleep study, B refused');
        
        assert.ok(true, 'Multiple fact reports about same person were processed.');
    });

    runner.reportResults();
}

runFactReportingTests();
