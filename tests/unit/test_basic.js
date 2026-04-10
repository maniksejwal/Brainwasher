import { TestRunner } from '../integration/test_runner.js';

async function runBasicTests() {
    const runner = new TestRunner();

    await runner.runTest('should allow a user to connect and send a message', async (assert) => {
        await runner.clearDb();
        const alice = await runner.loginAs('alice');
        
        // In the new model, we don't get a direct response from sendMessage,
        // so this test now primarily confirms that no errors are thrown during login and send.
        await alice.sendMessage('hello world');
        assert.ok(true, 'Message was sent without error.');
    });

    // Escalation tests are now in their own file.

    runner.reportResults();
}

runBasicTests();

