import { getDb } from './connection.js';

/**
 * Send a direct message to a user.
 */
export async function sendDirectMessage(senderId, receiverId, message) {
    const db = await getDb();
    await db.run(`
        INSERT INTO direct_messages (sender_id, receiver_id, message, timestamp)
        VALUES (?, ?, ?, ?)
    `, [senderId, receiverId, message, Date.now()]);
}

/**
 * Get conversation between two users.
 */
export async function getDirectMessages(user1, user2, limit = 50, offset = 0) {
    const db = await getDb();
    return db.all(`
        SELECT * FROM direct_messages 
        WHERE (sender_id = ? AND receiver_id = ?) 
           OR (sender_id = ? AND receiver_id = ?)
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
    `, [user1, user2, user2, user1, limit, offset]);
}

/**
 * Mark messages from a specific sender as read by the receiver.
 */
export async function markDirectMessagesRead(senderId, receiverId) {
    const db = await getDb();
    await db.run(`
        UPDATE direct_messages 
        SET read_at = ? 
        WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL
    `, [Date.now(), senderId, receiverId]);
}

/**
 * Get total unread direct messages for a user (as receiver).
 */
export async function getUnreadDirectMessageCount(userId) {
    const db = await getDb();
    const result = await db.get(`
        SELECT COUNT(*) as count 
        FROM direct_messages 
        WHERE receiver_id = ? AND read_at IS NULL
    `, [userId]);
    return result?.count || 0;
}
