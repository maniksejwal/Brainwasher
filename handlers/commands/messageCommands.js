import { findUserById, getDb } from '../../db/index.js';
import { sendDirectMessage, getDirectMessages } from '../../db/queries_direct_messages.js';
import { NotificationService } from '../../notifications/service.js';
import { events } from '../../orchestrator.js';

const notificationService = new NotificationService();

/**
 * Handle sending a direct message.
 * Syntax: /dm <username> <message>
 */
export async function handleDMCommand(userId, circleId, parts, sendMessageToUser) {
    if (parts.length < 3) {
        sendMessageToUser(userId, "Usage: /dm <username> <message>");
        return;
    }

    const targetUsername = parts[1];
    const message = parts.slice(2).join(' ');

    // Resolve username to userId
    // We need a findUserByUsername function. Let's assume one exists or query DB directly.
    const db = await getDb();
    const targetUser = await db.get("SELECT user_id FROM users WHERE username = ? COLLATE NOCASE", [targetUsername]);

    if (!targetUser) {
        sendMessageToUser(userId, `User '${targetUsername}' not found.`);
        return;
    }

    try {
        await sendDirectMessage(userId, targetUser.user_id, message);
        sendMessageToUser(userId, `DM sent to ${targetUsername}.`);

        // Notify recipient (mock notification for now, or real if connected)
        // events.emit('notify', { userId: targetUser.user_id, type: 'message', ... }); 
    } catch (err) {
        console.error("Error sending DM:", err);
        sendMessageToUser(userId, "Failed to send DM.");
    }
}

/**
 * Handle checking inbox/unread summary.
 * Syntax: /inbox
 */
export async function handleInboxCommand(userId, circleId, sendMessageToUser) {
    try {
        // Use the imported getUnreadSummary, assuming service.js exports it or we use the class instance.
        // Actually, previous code used `notificationService` instance. 
        // Let's import the specific query or use the service if available.
        // For CLI simplicity, we'll use the query/service function directly.

        // RE-IMPORT correct function if needed. 
        // In `notifications/service.js`, `getUnreadSummary` is a method of NotificationService class.
        // But we might have queries that do this.
        // Let's check `notificationService.js` exports. If it exports a singleton, use that.
        // If not, we instantiate it.

        const summary = await notificationService.getUnreadSummary(userId);

        let reply = `**Inbox Summary**\n`;
        reply += `- Alerts: ${summary.notifications}\n`;
        reply += `- Circle Messages: ${summary.messages}\n`;
        reply += `- Direct Messages: ${summary.directMessages}\n`;
        reply += `- Total Unread: ${summary.total}\n`;

        if (summary.directMessages > 0) {
            // Fetch recent unread DMs to show snippet
            // We need a query for this. `getDirectMessages` gets conversation. 
            // We might want `getRecentUnreadDMs`.
            // For now, simple summary.
            reply += `\n(Use /dm <username> ... to reply)`;
        }

        sendMessageToUser(userId, reply);

    } catch (err) {
        console.error("Error checking inbox:", err);
        sendMessageToUser(userId, "Failed to retrieve inbox.");
    }
}
