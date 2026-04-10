import { TestClient } from '../client.js';
import config from '../config.js';

export async function setup() {
    // Clear the database before each test suite
    await fetch(`${config.ORCHESTRATOR_URL}/clear`, { method: 'POST' });
    await new Promise(resolve => setTimeout(resolve, 500)); // Give server a moment to process

    const patient = new TestClient('patient');
    const caregiver = new TestClient('caregiver');
    const doctor = new TestClient('doctor');

    await patient.connect();
    await caregiver.connect();
    await doctor.connect();

    return { patient, caregiver, doctor };
}

export async function cleanup(...clients) {
    clients.forEach(client => client.disconnect());
}

export async function runTest(testFunction) {
    try {
        const success = await testFunction();
        if (success) {
            console.log(`\n¿? ¿? ¿? Test Passed: ${testFunction.name} ¿? ¿? ¿?\n`);
            process.exit(0);
        }
    } catch (error) {
        console.error(`\n¿? ¿? ¿? Test Failed: ${testFunction.name} ¿? ¿? ¿?`);
        console.error("Error:", error.message);
        console.error("Details:", error.stack);
        process.exit(1);
    }
}
