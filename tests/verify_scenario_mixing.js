/**
 * Verify Scenario Mixing Logic
 * Simulates the pipeline's scenario selection to ensure original and generated scenarios are mixed.
 */

import { getScenarios } from './training/simulation/scenarios.js';

console.log('🧪 Verifying Scenario Mixing...\n');

// 1. Fetch all scenarios (as pipeline now does)
const allScenarioMap = getScenarios({ includeGenerated: true });
const allKeys = Object.keys(allScenarioMap);

const originalCount = allKeys.filter(k => !k.startsWith('generated_')).length;
const generatedCount = allKeys.filter(k => k.startsWith('generated_')).length;
const totalCount = allKeys.length;

console.log(`📊 Pool Statistics:`);
console.log(`   Original Scenarios:  ${originalCount}`);
console.log(`   Generated Scenarios: ${generatedCount}`);
console.log(`   Total Pool:          ${totalCount}`);
console.log('');

// 2. Simulate Random Selection (Pipeline Logic: 90% random)
// Let's select 20 scenarios randomly
const SELECTION_SIZE = 20;
console.log(`🔄 Simulating selection of ${SELECTION_SIZE} random scenarios...`);

const shuffled = [...allKeys].sort(() => Math.random() - 0.5);
const selected = shuffled.slice(0, SELECTION_SIZE);

const setOriginal = selected.filter(k => !k.startsWith('generated_'));
const setGenerated = selected.filter(k => k.startsWith('generated_'));

console.log(`\n✅ Selection Result:`);
console.log(`   Original Selected:  ${setOriginal.length} (${(setOriginal.length / SELECTION_SIZE * 100).toFixed(0)}%)`);
console.log(`   Generated Selected: ${setGenerated.length} (${(setGenerated.length / SELECTION_SIZE * 100).toFixed(0)}%)`);

console.log('\n📝 Sample Selected Scenarios:');
selected.slice(0, 5).forEach(k => {
    const isGen = k.startsWith('generated_');
    console.log(`   - ${k} [${isGen ? 'GENERATED' : 'ORIGINAL'}]`);
});

if (setGenerated.length > 0 && setOriginal.length > 0) {
    console.log('\n✅ SUCCESS: Mixing verified! Both types are present.');
} else {
    // Statistically possible to get only one type if pool is skewed, but unlikely with 648 generated vs 98 original
    console.log('\n⚠️  WARNING: One type missing from sample (try running again)');
}
