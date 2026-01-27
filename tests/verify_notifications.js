
import { setGlobalDb, initializeDatabase, addUser, createCareCircle, addMemberToCircle } from './db/index.js';
import { notificationService } from './notifications/NotificationService.js';
import { setNotificationPreference, getNotificationHistory } from './db/index.js';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

async function verifyNotifications() {
    console.log('🔔 Starting Notification Verification...');

    // 1. Setup Test Database
    const db = await open({
        filename: ':memory:',
        driver: sqlite3.Database
    });
    setGlobalDb(db);
    await initializeDatabase();
    console.log('✅ Database Initialized.');

    // 2. Setup User
    const userId = 'user_test_notif';
    await addUser(userId, 'TestUser');
    console.log('👤 Created Test User.');

    // 3. Set Preferences
    // Enable 'console' for 'escalation'
    await setNotificationPreference(userId, 'console', 'escalation', true);
    // Disable 'email' (mock)
    await setNotificationPreference(userId, 'email', 'escalation', false);
    console.log('⚙️ Preferences Set: Console=ON, Email=OFF');

    // 4. Send Notification
    console.log('📨 Sending Test Notification...');
    const results = await notificationService.send(
        userId,
        'escalation',
        'This is a test escalation notification.',
        { severity: 'medium' }
    );

    console.log('📤 Send Results:', results);

    // 5. Verify Logs
    const history = await getNotificationHistory(userId);
    console.log('📜 Notification History:');
    if (history.length > 0) {
        history.forEach(log => {
            console.log(`   - [${log.status}] ${log.channel}: ${log.content}`);
        });
        console.log('✅ History verified.');
    } else {
        console.error('❌ No history found in DB!');
    }

    // 6. Verify correct channels were used (Console yes, Email no)
    const consoleSent = results.find(r => r.channel === 'console' && r.success);
    const emailSent = results.find(r => r.channel === 'email');

    if (consoleSent && !emailSent) {
        console.log('✅ Routing Correct: Sent to Console, skipped Email.');
    } else {
        console.error('❌ Routing Failed:', { consoleSent, emailSent });
    }
}

verifyNotifications().catch(console.error);
