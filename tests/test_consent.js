import { TestRunner } from './test_runner.js';

async function runConsentTests() {
    const runner = new TestRunner();

    await runner.runTest('should allow a patient to set consent for a caregiver', async (assert) => {
        await runner.clearDb();
        const alice = await runner.loginAs('alice');
        const bob = await runner.loginAs('bob');
        await alice.sendCommand('/add bob as caregiver with relationship spouse');

        const response = await alice.sendCommand('/consent bob full');
        assert.ok(response.includes("Consent for 'bob' in this circle set to 'full'"), 'Consent confirmation should be received.');
    });

    // More complex tests for per-message and implied consent are challenging to automate
    // without a mock AI, as they depend on the AI's "sharingSuggestion".
    // These are best tested manually using the scenarios.

    runner.reportResults();
}

runConsentTests();

