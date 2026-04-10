import { TestRunner } from '../integration/test_runner.js';

async function runCircleManagementTests() {
    const runner = new TestRunner();

    await runner.runTest('should allow a new user to log in and create a personal circle', async (assert) => {
        await runner.clearDb();
        const alice = await runner.loginAs('alice');
        assert.ok(alice.userId, 'Alice should receive a userId.');
        assert.equal(alice.activeCircleId, alice.userId, 'Alice should be in her own circle by default.');
    });

    await runner.runTest('should allow a patient to add a new member to their circle', async (assert) => {
        await runner.clearDb();
        const alice = await runner.loginAs('alice');
        const bob = await runner.loginAs('bob'); // Bob needs to exist in the system first

        const response = await alice.sendCommand('/add bob as caregiver with relationship spouse');
        assert.ok(response.includes("Added 'bob' to your care circle"), 'Confirmation message should be received.');
    });

    await runner.runTest('should allow a member to switch context to another circle', async (assert) => {
        await runner.clearDb();
        const alice = await runner.loginAs('alice');
        const bob = await runner.loginAs('bob');
        await alice.sendCommand('/add bob as caregiver with relationship spouse');

        const response = await bob.sendCommand(`/switch alice`);
        assert.ok(response.includes("Switched context to circle for patient: alice"), 'Bob should receive a context switch confirmation.');
        assert.equal(bob.activeCircleId, alice.userId, 'Bobs active circle should now be alices circle.');
    });

    await runner.runTest('should prevent a user from adding members to a circle that is not their own', async (assert) => {
        await runner.clearDb();
        const alice = await runner.loginAs('alice');
        const bob = await runner.loginAs('bob');
        const charlie = await runner.loginAs('charlie');
        await alice.sendCommand('/add bob as caregiver with relationship spouse');

        // Bob tries to add Charlie to Alice's circle, which should fail.
        await bob.sendCommand(`/switch alice`); // Bob switches to Alice's circle
        const response = await bob.sendCommand(`/add charlie as doctor with relationship physician`);
        assert.ok(response.includes("You can only add members to your own care circle."), 'Bob should be denied permission.');
    });

    runner.reportResults();
}

runCircleManagementTests();
