
import { setGlobalDb, initializeDatabase, clearDatabase, addUser, createCareCircle, addMemberToCircle } from './db/index.js';
import { performAiAnalysis } from './handlers/message_logic/aiAnalysisHandler.js';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { events } from './orchestrator.js';

async function verifyBridge() {
    console.log('🧪 Starting Cross-Circle Bridge Verification...');

    // 1. Setup In-Memory / Test Database
    const db = await open({
        filename: ':memory:',
        driver: sqlite3.Database
    });
    setGlobalDb(db);
    await initializeDatabase();

    // 2. Mock Users
    console.log('👤 Creating Test Users...');
    await addUser('user_a', 'UserA');
    await addUser('user_b', 'UserB');
    await addUser('user_c', 'UserC');

    const userA = { user_id: 'user_a', username: 'UserA' };
    const userB = { user_id: 'user_b', username: 'UserB' };
    const userC = { user_id: 'user_c', username: 'UserC' };

    // 3. Setup Circles
    // Circle 1: UserA and UserB
    console.log('⭕ Setting up Circle 1 (UserA, UserB)...');
    const circle1Id = 'circle_1';
    await createCareCircle(circle1Id, userB.user_id); // UserB is patient
    await addMemberToCircle(circle1Id, userA.user_id, 'caregiver', 'spouse');

    // Circle 2: UserA and UserC
    console.log('⭕ Setting up Circle 2 (UserA, UserC)...');
    const circle2Id = 'circle_2';
    await createCareCircle(circle2Id, userA.user_id); // UserA is primary in this mock setup
    await addMemberToCircle(circle2Id, userC.user_id, 'doctor', 'provider');

    console.log(`✅ Test Environment Ready. 
       - UserA is in Circle 1 and Circle 2.
       - UserB is only in Circle 1.
       - UserC is only in Circle 2.
    `);

    // 4. Trigger Analysis in Circle 1 mentioning UserC
    console.log('🤖 Triggering Analysis in Circle 1 mentioning "UserC"...');

    // Silence events to prevent CLI clutter
    events.on('analysis_progress', () => { });
    events.on('broadcast', () => { });

    try {
        const message = "I'm worried about the medication UserC prescribed.";
        // We'll mock the role as caregiver
        const analysis = await performAiAnalysis(userA.user_id, 'caregiver', message, circle1Id);

        console.log('\n📊 Analysis Result:');
        console.log('-------------------');
        console.log(`Mentioned: ${analysis.mentioned_usernames?.join(', ') || 'None'}`);

        if (analysis.bridged_entities && analysis.bridged_entities.length > 0) {
            console.log('✅ BRIDGE SUCCESSFUL!');
            analysis.bridged_entities.forEach(ent => {
                console.log(`   - Found ${ent.username} in Circle ${ent.circleId} (Role: ${ent.role})`);
            });
        } else {
            console.log('❌ BRIDGE FAILED: UserC was not resolved across circles.');
        }

        console.log(`Criticality: ${analysis.criticality}`);
        console.log(`Privacy Level: ${analysis.privacyLevel}`);

        // 5. Verify API Usage Logging
        console.log('\n💰 Verifying API Cost Tracking...');
        const usageLogs = await db.all('SELECT * FROM api_usage');
        if (usageLogs.length > 0) {
            console.log(`✅ Usage Logged: ${usageLogs.length} entries found.`);
            const totalCost = usageLogs.reduce((acc, row) => acc + row.cost_usd, 0);
            console.log(`   - Total Cost: $${totalCost.toFixed(6)}`);
            console.log(`   - Sample Provider: ${usageLogs[0].provider}`);
            console.log(`   - Sample Model: ${usageLogs[0].model}`);
        } else {
            console.log('❌ NO USAGE LOGGED (Check api_client.js integration)');
        }

    } catch (error) {
        console.error('❌ Error during analysis:', error);
    } finally {
        await db.close();
    }
}

verifyBridge().catch(console.error);
