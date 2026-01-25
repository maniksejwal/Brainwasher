/**
 * Debug script to inspect SCENARIOS properties
 */
import { SCENARIOS } from './training/simulation/scenarios/index.js';

console.log('🔍 Inspecting SCENARIOS properties...');
console.log(`Total scenarios: ${Object.keys(SCENARIOS).length}`);

const sampleKeys = Object.keys(SCENARIOS).slice(0, 10);
console.log('\nSample Scenarios:');

let suitableCount = 0;

Object.entries(SCENARIOS).forEach(([key, s]) => {
    const isGenerated = !!s.generated;
    const hasCircles = !!s.circles;
    const hasUsers = !!s.users;
    const complexity = s.complexity;

    // The filter logic from scenario_builder.js:
    const isSuitable = !isGenerated && !hasCircles && !hasUsers && complexity <= 3;

    if (sampleKeys.includes(key)) {
        console.log(`[${key}]`);
        console.log(`  generated: ${isGenerated}`);
        console.log(`  circles: ${hasCircles}`);
        console.log(`  users: ${hasUsers ? s.users.length : 0}`);
        if (hasUsers) console.log(`  users[0]: ${JSON.stringify(s.users[0])}`);
        console.log(`  complexity: ${complexity}`);
        console.log(`  => SUITABLE: ${isSuitable}`);
    }

    if (isSuitable) suitableCount++;
});

console.log(`\nTotal Suitable Scenarios with current filter: ${suitableCount}`);
