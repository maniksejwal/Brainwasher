import {
    getUserNotificationPreferences,
    isNotificationEnabled,
    logNotification
} from '../db/index.js';
import { TwilioProvider } from './TwilioProvider.js';
import { AISensyProvider } from './AISensyProvider.js';

/**
 * Base Provider Interface
 */
class NotificationProvider {
    constructor(name) {
        this.name = name;
    }

    async send(to, content, metadata = {}) {
        throw new Error('Provider must implement send()');
    }
}

/**
 * Console Provider (for testing/development)
 */
class ConsoleProvider extends NotificationProvider {
    constructor() {
        super('console');
    }

    async send(to, content, metadata = {}) {
        console.log(`\n🔔 [Notification] To: ${to} | Content: ${content}`);
        if (metadata.type) console.log(`   [Metadata] Type: ${metadata.type}`);
        return { success: true, messageId: `console-${Date.now()}` };
    }
}

/**
 * Notification Service Singleton
 */
class NotificationService {
    constructor() {
        this.providers = new Map();

        // Register default providers
        this.registerProvider('console', new ConsoleProvider());
        this.registerProvider('sms', new TwilioProvider(process.env)); // Pass env for credentials
        this.registerProvider('whatsapp', new AISensyProvider(process.env));
    }

    registerProvider(channel, provider) {
        this.providers.set(channel, provider);
    }

    /**
     * Send a notification to a user
     * @param {string} userId - Target user ID
     * @param {string} type - Event type (e.g., 'escalation', 'reminder')
     * @param {string} message - Notification content
     * @param {object} metadata - Additional context
     */
    async send(userId, type, message, metadata = {}) {
        try {
            // 1. Get user preferences
            const prefs = await getUserNotificationPreferences(userId);

            // 2. Determine active channels
            // If no prefs, default to 'console' for now (or 'email' in prod)
            // In a real app, we'd have system-wide defaults.
            let activeChannels = [];

            if (!prefs || prefs.length === 0) {
                // Fallback default
                activeChannels.push('console');
            } else {
                // Filter enabled channels for this event type
                const explicitChannels = prefs.filter(p => p.event_type === type && p.enabled);

                if (explicitChannels.length > 0) {
                    activeChannels = explicitChannels.map(p => p.channel);
                } else {
                    // Check for 'all' or wildcards if we implement them later
                    // For now, if no specific pref, check strictly if 'console' is enabled
                    // Actually, let's keep it simple: if no pref, NO notification unless critical?
                    // Let's fallback to console for dev visibility.
                    activeChannels.push('console');
                }
            }

            // Deduplicate
            activeChannels = [...new Set(activeChannels)];

            const results = [];

            // 3. Send to each channel
            for (const channel of activeChannels) {
                const provider = this.providers.get(channel);
                if (!provider) {
                    console.warn(`[NotificationService] No provider registered for channel '${channel}'`);
                    continue;
                }

                // Double check enablement logic (redundant but safe)
                const isEnabled = await isNotificationEnabled(userId, channel, type);
                if (!isEnabled) continue;

                try {
                    const result = await provider.send(userId, message, { ...metadata, type });

                    // Log success
                    await logNotification(
                        userId,
                        channel,
                        type,
                        message,
                        'sent',
                        null
                    );

                    results.push({ channel, success: true, result });

                } catch (error) {
                    console.error(`[NotificationService] Failed to send via ${channel}:`, error.message);

                    // Log failure
                    await logNotification(
                        userId,
                        channel,
                        type,
                        message,
                        'failed',
                        error.message
                    );

                    results.push({ channel, success: false, error: error.message });
                }
            }

            return results;

        } catch (error) {
            console.error('[NotificationService] Critical error:', error);
            // Log system-level failure?
            return [];
        }
    }

    /**
     * Get unread notification summary for a user
     * @param {string} userId - User ID
     * @returns {Promise<Object>} Summary of unread notifications
     */
    async getUnreadSummary(userId) {
        try {
            // Import database functions dynamically to avoid circular imports
            const { getDb } = await import('../db/index.js');
            const db = await getDb();

            // Get unread in-app notifications
            const unreadNotifications = await db.all(
                'SELECT type, COUNT(*) as count FROM in_app_notifications WHERE user_id = ? AND is_read = 0 GROUP BY type',
                [userId]
            );

            // Get unread direct messages
            const unreadDMs = await db.get(
                'SELECT COUNT(*) as count FROM direct_messages WHERE receiver_id = ? AND read_at IS NULL',
                [userId]
            );

            // Get unread escalations
            const unreadEscalations = await db.get(
                'SELECT COUNT(*) as count FROM escalations WHERE circle_id IN (SELECT circle_id FROM care_circle_members WHERE user_id = ?) AND is_read = 0',
                [userId]
            );

            const summary = {
                total: 0,
                notifications: {},
                direct_messages: unreadDMs?.count || 0,
                escalations: unreadEscalations?.count || 0
            };

            // Process notification counts by type
            for (const notif of unreadNotifications) {
                summary.notifications[notif.type] = notif.count;
                summary.total += notif.count;
            }

            summary.total += summary.direct_messages + summary.escalations;

            return summary;
        } catch (error) {
            console.error('[NotificationService] Error getting unread summary:', error);
            return { total: 0, notifications: {}, direct_messages: 0, escalations: 0 };
        }
    }
}

// Export singleton
export const notificationService = new NotificationService();
