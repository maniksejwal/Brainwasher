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

        // Get sender info for notification
        const senderUser = await findUserById(userId);
        const senderName = senderUser ? senderUser.username : 'Unknown';

        // Send notification to recipient via broadcast
        events.emit('broadcast', {
            targetUsers: [targetUser.user_id],
            reply: `📩 **New DM from ${senderName}:** ${message}\n(Use /dm ${senderName} <message> to reply)`,
            from: 'system',
            circleId: null // DMs are not circle-specific
        });

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
            reply += `\n(Use /dm <username> ... to reply, or /messages to view conversations)`;
        }

        sendMessageToUser(userId, reply);

    } catch (err) {
        console.error("Error checking inbox:", err);
        sendMessageToUser(userId, "Failed to retrieve inbox.");
    }
}

/**
 * Handle viewing DM conversations.
 * Syntax: /messages [username]
 */
export async function handleMessagesCommand(userId, circleId, parts, sendMessageToUser) {
    try {
        if (parts.length > 1) {
            // View conversation with specific user
            const targetUsername = parts[1];
            const db = await getDb();
            const targetUser = await db.get("SELECT user_id, username FROM users WHERE username = ? COLLATE NOCASE", [targetUsername]);

            if (!targetUser) {
                sendMessageToUser(userId, `User '${targetUsername}' not found.`);
                return;
            }

            const messages = await getDirectMessages(userId, targetUser.user_id, 10);
            
            if (messages.length === 0) {
                sendMessageToUser(userId, `No messages with ${targetUsername}.`);
                return;
            }

            let reply = `**💬 Conversation with ${targetUsername}:**\n\n`;
            for (const msg of messages.reverse()) { // Show chronologically
                const isFromUser = msg.sender_id === userId;
                const sender = isFromUser ? 'You' : targetUsername;
                const timestamp = new Date(msg.created_at).toLocaleTimeString();
                reply += `[${timestamp}] **${sender}:** ${msg.message}\n`;
            }
            reply += `\n(Use /dm ${targetUsername} <message> to reply)`;

            sendMessageToUser(userId, reply);
        } else {
            // List all conversations
            const db = await getDb();
            const conversations = await db.all(`
                SELECT DISTINCT 
                    CASE 
                        WHEN sender_id = ? THEN recipient_id 
                        ELSE sender_id 
                    END as other_user_id,
                    u.username,
                    MAX(created_at) as last_message_time,
                    COUNT(*) as message_count
                FROM direct_messages dm
                JOIN users u ON u.user_id = CASE 
                    WHEN dm.sender_id = ? THEN dm.recipient_id 
                    ELSE dm.sender_id 
                END
                WHERE sender_id = ? OR recipient_id = ?
                GROUP BY other_user_id, u.username
                ORDER BY last_message_time DESC
            `, [userId, userId, userId, userId]);

            if (conversations.length === 0) {
                sendMessageToUser(userId, `No DM conversations yet.\nUse /dm <username> <message> to start one.`);
                return;
            }

            let reply = `**📱 Your DM Conversations:**\n\n`;
            for (const conv of conversations) {
                const lastTime = new Date(conv.last_message_time).toLocaleString();
                reply += `• **${conv.username}** (${conv.message_count} messages) - Last: ${lastTime}\n`;
            }
            reply += `\nUse /messages <username> to view a conversation`;

            sendMessageToUser(userId, reply);
        }

    } catch (err) {
        console.error("Error viewing messages:", err);
        sendMessageToUser(userId, "Failed to retrieve messages.");
    }
}
