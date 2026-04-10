/**
 * Test Simulation API
 * Tests that simulations can be triggered via API
 */

const BASE_URL = 'http://localhost:5000';

async function testSimulationAPI() {
    console.log('\n🧪 Testing Simulation API...\n');

    try {
        // Test 1: Get scenarios
        console.log('Test 1: GET /api/scenarios');
        const scenariosRes = await fetch(`${BASE_URL}/api/scenarios`);
        if (!scenariosRes.ok) {
            throw new Error(`Scenarios API failed: ${scenariosRes.status}`);
        }
        const scenariosData = await scenariosRes.json();
        console.log(`✅ Loaded ${Object.keys(scenariosData.scenarios || {}).length} scenarios`);
        console.log(`   Sample scenarios:`, Object.keys(scenariosData.scenarios || {}).slice(0, 3));

        // Test 2: Run simple simulation
        console.log('\nTest 2: POST /api/simulate (simple)');
        const simpleRes = await fetch(`${BASE_URL}/api/simulate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                runs: 1,
                scenario: 'random_single',
                turns: 3
            })
        });

        if (!simpleRes.ok) {
            const error = await simpleRes.json();
            throw new Error(`Simulation failed: ${error.message}`);
        }

        const simpleResult = await simpleRes.json();
        console.log(`✅ Simulation complete: ${simpleResult.scenarioName}`);
        console.log(`   Turns: ${simpleResult.turns}`);
        console.log(`   Complexity: ${simpleResult.complexity}/5`);

        // Test 3: Run complex multi-user simulation
        console.log('\nTest 3: POST /api/simulate (multi-user)');
        const complexRes = await fetch(`${BASE_URL}/api/simulate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                runs: 1,
                scenario: 'privacy_breach_caregiver',
                turns: 5
            })
        });

        if (!complexRes.ok) {
            const error = await complexRes.json();
            console.error('Server error:', error);
            throw new Error(`Complex simulation failed: ${error.error || error.message}`);
        }

        const complexResult = await complexRes.json();
        console.log(`✅ Complex simulation complete: ${complexResult.scenarioName}`);
        console.log(`   Scenario: ${complexResult.scenarioKey}`);

        console.log('\n✅ All simulation API tests passed!\n');
        return true;

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error.stack);
        return false;
    }
}

// Run if called directly
testSimulationAPI().then(success => {
    process.exit(success ? 0 : 1);
});

export default testSimulationAPI;

