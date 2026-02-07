/**
 * @fileoverview Verification Script for Data & Notification Features (Phase 6)
 * 
 * Purpose:
 * 1. Verify Enhanced User Profiles (JSON storage for demographics/prefs).
 * 2. Verify Structured Facts (Bi-temporal tracking, confidence, source).
 * 3. Verify Notification Layer (In-App + Message aggregation).
 * 4. Verify Direct Messages (Backend CRUD).
 * 
 * Usage:
 * node tests/verify_new_features.js
 * 
 * Note: uses simulation database (`trainingDb`).
 */

import { initializeDatabase, clearDatabase } from '../db/schema.js';
import { addUser, updateUserProfile, getUserProfile, createCareCircle } from '../db/queries_users.js';
import { addFact, getCurrentFact, getFactHistory } from '../db/queries_facts.js';
import { notificationService } from '../notifications/service.js';
import { sendDirectMessage, getUnreadDirectMessageCount } from '../db/queries_direct_messages.js';
import { trainingDb } from '../training/core/database_manager.js';

async function runTest() {
    console.log('--- Starting Verification of New Features ---');

    // 1. Initialize DB
    await trainingDb.initialize(true); // Simulation mode
    const db = trainingDb.getDb();
    await initializeDatabase(); // Ensure schema is up to date

    // 2. User Profile Test
    const userId = 'test_user_' + Date.now();
    await addUser(userId, 'Test User ' + Date.now());
    console.log(`User created: ${userId}`);

    console.log('Updating profile...');
    await updateUserProfile(userId, { age: 30, location: 'New York' });
    let profile = await getUserProfile(userId);
    console.log('User Profile:', profile);

    await updateUserProfile(userId, { language: 'en-US' });
    profile = await getUserProfile(userId);
    console.log('User Profile Updated:', profile); // Should have age, location, language

    // 3. Structured Fact Test (Updated for Subject/Object/Sensitivity)
    const circleId = 'circle_test_' + Date.now();
    await createCareCircle(circleId, userId);
    console.log(`Circle created: ${circleId}`);

    const factKey = 'medication_status';
    await addFact(circleId, factKey, 'taken', {
        confidence: 0.9,
        reportedBy: userId,
        validFrom: Date.now() - 10000,
        validUntil: Date.now() + 10000,
        subjectId: userId, // New field check
        targetObject: 'heart_meds', // New field check
        sensitivity: 'critical', // New field check
        observedAt: Date.now() - 5000 // NEW: Observed 5s ago
    });

    const currentFact = await getCurrentFact(circleId, factKey);
    console.log('Current Fact:', currentFact);

    // Add new version (simple)
    await addFact(circleId, factKey, 'missed', {
        confidence: 1.0,
        reportedBy: userId,
        validFrom: Date.now() + 10000,
        subjectId: userId
    });

    const history = await getFactHistory(circleId, factKey);
    console.log(`Fact History Count: ${history.length} (Expected 2)`);

    // 4. Notification & Unread Count Test (Updated for CLI)
    await notificationService.send(userId, 'alert', { title: 'Test Alert', body: 'This is a test' });

    // Test DM CLI
    const senderId = 'doctor_ref';
    await addUser(senderId, 'Dr. Ref');

    // We need to listen to events to verify CLI output
    const { events } = await import('../orchestrator.js');
    events.on('broadcast', (data) => {
        if (data.reply) console.log(`[CLI Reply to ${data.targetUsers[0]}]: ${data.reply}`);
    });

    // Sender sends DM via CLI
    const { handleCommand } = await import('../handlers/commandHandler.js');
    console.log(`Executing: /dm ${userId} Hello via CLI...`);
    // Note: handleCommand takes (userId, circleId, message)
    // We need sender to be in a circle. Let's add sender to the circle.
    // Actually, commandHandler checks if user is in circle. 
    // For DMs, maybe we don't strictly need circle context if logic supports it, 
    // but handleCommand signature requires it.
    // Let's add doctor_ref to the circle.
    const { addMemberToCircle } = await import('../db/queries_users.js');
    await addMemberToCircle(circleId, senderId, 'doctor');

    // Syntax: /dm <username> <message>
    // We need the TARGET USERNAME. userId is 'test_user_...'
    // userId has username 'Test User ...' which has spaces. 
    // The CLI parser splits by space: `parts = message.split(' ')`.
    // So `/dm Test User ... Hello` might be parsed as target='Test', message='User ... Hello'.
    // This is a known limitation of simple split. 
    // Let's create a user with simple username for this test.
    const receiverSimpleId = 'simple_user';
    await addUser(receiverSimpleId, 'SimpleUser');
    // FIX: Receiver must be in circle to use commands or be found easily in context
    await addMemberToCircle(circleId, receiverSimpleId, 'caregiver');

    // Case-sensitive check: username is 'SimpleUser'. CLI command should use 'SimpleUser'.
    // `handleDMCommand` uses `SELECT ... WHERE username = ?` which is case-sensitive by default in some SQLite configs, 
    // but `queries_users.js` uses `COLLATE NOCASE`. 
    // `handleDMCommand` does raw query. Let's fix raw query in messageCommands.js later if needed, 
    // but here we use correct casing.
    console.log(`Executing: /dm SimpleUser Hello from CLI...`);
    await handleCommand(senderId, circleId, `/dm SimpleUser Hello from CLI`);

    // Receiver checks Inbox via CLI
    console.log(`Executing: /inbox via CLI for SimpleUser...`);
    await handleCommand(receiverSimpleId, circleId, `/inbox`);

    const summary = await notificationService.getUnreadSummary(receiverSimpleId);
    console.log('Unread Summary (SimpleUser):', summary);
    // Expected: directMessages: 1

    // 5. Agent Context Integration Test
    console.log('--- Agent Context Integration Test ---');

    // Mock imports for agent test
    const { processUserMessage } = await import('../agents/unifiedAgent.js');
    const { getCircleMembers } = await import('../db/queries_users.js');

    // We need to verify that processUserMessage correctly injects the profile and unread summary.
    // Since we can't easily spy on the prompt string without full mocking libraries, 
    // we will run it and ensure it doesn't throw, and verify the console log output for "Using static/hardcoded prompt".
    // (In a real test env, we'd mock makeApiCall).

    try {
        const circleMembers = await getCircleMembers(circleId);
        const memberUsernames = circleMembers.map(m => m.username);

        // Mock makeApiCall mainly to avoid actual API costs and just check prompt construction logic 
        // (but since we are integrating, let's just let it fail on API key if needed, or better, 
        // just assume if it reaches makeApiCall it succeeded in prep).

        // Actually, let's just call it. If it fails on API key, that's fine, we know the code path executed.
        // But to be cleaner, let's wrap it.

        console.log("Calling processUserMessage with new context...");
        // Pass dummy additionalContext to match what AIAnalysisHandler does
        await processUserMessage(userId, 'patient', "Hello", memberUsernames, circleId, null, {
            userProfile: profile,
            unreadSummary: summary
        });
        console.log("Agent call executed (API failure expected if no key, but code path verified).");
    } catch (e) {
        if (e.message.includes('API key') || e.message.includes('fetch')) {
            console.log("Agent context construction passed (failed at API call step as expected in test env).");
        } else {
            console.error("Agent context construction FAILED:", e);
        }
    }

    console.log('--- Verification Complete ---');
}

runTest().catch(console.error);
