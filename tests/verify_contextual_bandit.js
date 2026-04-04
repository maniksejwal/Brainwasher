
import { ContextualBandit } from './training/rl/contextual_bandit.js';

async function verifyContextualBandit() {
    console.log('🧪 Verifying Contextual Bandit Logic...');

    const versions = ['v1', 'v2'];
    const bandit = new ContextualBandit(versions, {
        minSamples: 5
    });

    console.log('\n--- 1. Testing Segmentation ---');
    const contextA = { personaCategory: 'anxious' };
    const contextB = { personaCategory: 'denial' };

    // Train v1 to be good for Anxious users
    console.log('Training v1 for Anxious users (10 successes)...');
    for (let i = 0; i < 10; i++) bandit.updateReward('v1', 1, contextA);
    for (let i = 0; i < 10; i++) bandit.updateReward('v2', 0, contextA); // v2 bad for anxious

    // Train v2 to be good for Denial users
    console.log('Training v2 for Denial users (10 successes)...');
    for (let i = 0; i < 10; i++) bandit.updateReward('v2', 1, contextB);
    for (let i = 0; i < 10; i++) bandit.updateReward('v1', 0, contextB); // v1 bad for denial

    const stats = bandit.getAllStatistics();

    const anxiousStats = stats['persona:anxious'];
    const denialStats = stats['persona:denial'];

    console.log('\nAnxious Context Stats:');
    console.log(JSON.stringify(anxiousStats.map(s => ({ ver: s.version, exp: s.expectedValue.toFixed(2) })), null, 2));

    console.log('\nDenial Context Stats:');
    console.log(JSON.stringify(denialStats.map(s => ({ ver: s.version, exp: s.expectedValue.toFixed(2) })), null, 2));

    // Verify v1 wins for Anxious
    const bestAnxious = anxiousStats.sort((a, b) => b.expectedValue - a.expectedValue)[0];
    if (bestAnxious.version !== 'v1') throw new Error('v1 should be best for Anxious');
    console.log('✅ v1 is best for Anxious');

    // Verify v2 wins for Denial
    const bestDenial = denialStats.sort((a, b) => b.expectedValue - a.expectedValue)[0];
    if (bestDenial.version !== 'v2') throw new Error('v2 should be best for Denial');
    console.log('✅ v2 is best for Denial');

    console.log('\n--- 2. Testing Selection ---');
    const selectionA = bandit.selectVersion(contextA);
    console.log(`Selected for Anxious: ${selectionA}`);
    // Thompson sampling is probabilistic but with 10 wins vs 0, it should overwhelmingly pick the winner

    console.log('\n✅ Contextual Bandit Verification Passed!');
}

verifyContextualBandit().catch(console.error);
