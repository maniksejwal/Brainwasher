import { getDb } from './connection.js';

/**
 * Get notification preferences for a user
 */
export async function getUserNotificationPreferences(userId) {
    const db = await getDb();
    return db.all(`SELECT * FROM user_notification_preferences WHERE user_id = ?`, [userId]);
}

/**
 * Update or set a notification preference
 */
export async function setNotificationPreference(userId, channel, eventType, enabled, config = {}) {
    const db = await getDb();
    await db.run(`
        INSERT INTO user_notification_preferences (user_id, channel, event_type, enabled, config)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, channel, event_type) 
        DO UPDATE SET enabled = ?, config = ?
    `, [userId, channel, eventType, enabled ? 1 : 0, JSON.stringify(config), enabled ? 1 : 0, JSON.stringify(config)]);
}

/**
 * Check if a specific notification channel is enabled for an event type
 */
export async function isNotificationEnabled(userId, channel, eventType) {
    const db = await getDb();
    const row = await db.get(`
        SELECT enabled FROM user_notification_preferences 
        WHERE user_id = ? AND channel = ? AND event_type = ?
    `, [userId, channel, eventType]);

    // Default to true if not explicitly set (opt-out model)
    return row ? Boolean(row.enabled) : true;
}

/**
 * Log a notification attempt
 */
export async function logNotification(userId, channel, type, content, status, errorDetails = null) {
    const db = await getDb();
    await db.run(`
        INSERT INTO notification_logs (user_id, channel, type, content, status, error_details, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [userId, channel, type, content, status, errorDetails, Date.now()]);
}

/**
 * Get notification history for a user
 */
export async function getNotificationHistory(userId, limit = 50) {
    const db = await getDb();
    return db.all(`
        SELECT * FROM notification_logs 
        WHERE user_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
    `, [userId, limit]);
}
