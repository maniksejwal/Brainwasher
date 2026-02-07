import { addInAppNotification, getUnreadNotificationCount, isNotificationEnabled } from '../db/queries_notifications.js';
import { getTotalUnreadMessageCount } from '../db/queries_messages.js';
import { getUnreadDirectMessageCount } from '../db/queries_direct_messages.js';

export class NotificationService {
    constructor() {
        this.providers = {}; // e.g. 'whatsapp' => provider
    }

    /**
     * Register a notification provider (e.g. WhatsApp, Email)
     * @param {string} channel - Channel name (e.g. 'whatsapp')
     * @param {object} provider - Provider instance with .send(userId, payload) method
     */
    registerProvider(channel, provider) {
        this.providers[channel] = provider;
    }

    /**
     * Send a notification to a user via enabled channels
     * @param {string} userId - Target user ID
     * @param {string} type - Event type (e.g. 'alert', 'message', 'system')
     * @param {object} payload - Notification content { title, body, data }
     */
    async send(userId, type, payload) {
        const { title, body, data = {} } = payload;

        // 1. In-App Notification (Inbox)
        // Check if user has opted out of in-app notifications for this type
        const inAppEnabled = await isNotificationEnabled(userId, 'in_app', type);
        if (inAppEnabled) {
            await addInAppNotification(userId, type, title, body, data);
        }

        // 2. External Channels
        for (const [channel, provider] of Object.entries(this.providers)) {
            if (channel === 'in_app') continue;

            const enabled = await isNotificationEnabled(userId, channel, type);
            if (enabled) {
                try {
                    console.log(`[Notification] Sending ${channel} to ${userId}`);
                    await provider.send(userId, payload);
                } catch (e) {
                    console.error(`[Notification] Failed to send ${channel} to ${userId}:`, e);
                }
            }
        }
    }

    /**
     * Get aggregate unread count (In-App Notifications + Chat Messages + Direct Messages)
     */
    async getUnreadSummary(userId) {
        const [notifications, messages, directMessages] = await Promise.all([
            getUnreadNotificationCount(userId),
            getTotalUnreadMessageCount(userId),
            getUnreadDirectMessageCount(userId)
        ]);

        return {
            notifications,
            messages, // Circle messages
            directMessages,
            total: notifications + messages + directMessages
        };
    }
}

// Singleton instance
export const notificationService = new NotificationService();
