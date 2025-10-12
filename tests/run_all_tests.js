/**
 * Run All Tests
 * Comprehensive test suite for Care Circles AI
 */

import testSimulationAPI from './test_simulation_api.js';

const tests = [
    { name: 'Simulation API', fn: testSimulationAPI }
];

async function runAllTests() {
    console.log('═══════════════════════════════════════');
    console.log('   Care Circles AI - Test Suite');
    console.log('═══════════════════════════════════════\n');
    
    const results = [];
    
    for (const test of tests) {
        console.log(`\n▶ Running: ${test.name}`);
        console.log('─'.repeat(40));
        
        try {
            const success = await test.fn();
            results.push({ name: test.name, success });
            
            if (success) {
                console.log(`\n✅ ${test.name} PASSED`);
            } else {
                console.log(`\n❌ ${test.name} FAILED`);
            }
        } catch (error) {
            console.error(`\n❌ ${test.name} CRASHED:`, error.message);
            results.push({ name: test.name, success: false });
        }
    }
    
    // Summary
    console.log('\n═══════════════════════════════════════');
    console.log('   Test Summary');
    console.log('═══════════════════════════════════════\n');
    
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    results.forEach(result => {
        const icon = result.success ? '✅' : '❌';
        console.log(`${icon} ${result.name}`);
    });
    
    console.log(`\nTotal: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);
    
    if (failed === 0) {
        console.log('🎉 All tests passed!\n');
        process.exit(0);
    } else {
        console.log('⚠️  Some tests failed.\n');
        process.exit(1);
    }
}

// Run tests
runAllTests().catch(error => {
    console.error('Fatal error running tests:', error);
    process.exit(1);
});

