import assert from 'assert';
import { runTest, setup, cleanup } from './test_runner.js';

async function testUserConnection() {
    const testName = "Basic User Connection";
    console.log(`--- Running Test: ${testName} ---`);

    const { patient, caregiver, doctor } = await setup();
    
    try {
        // The setup function handles connection, so if it doesn't throw, we're good.
        assert(patient.isConnected, "Test Failed: Patient client should be connected.");
        assert(caregiver.isConnected, "Test Failed: Caregiver client should be connected.");
        assert(doctor.isConnected, "Test Failed: Doctor client should be connected.");
    } finally {
        await cleanup(patient, caregiver, doctor);
    }
    return true;
}

runTest(testUserConnection);
