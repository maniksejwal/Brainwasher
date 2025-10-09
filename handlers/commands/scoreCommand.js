/**
 * @fileoverview handlers/commands/scoreCommand.js
 * Allows users to provide feedback on AI interactions for training purposes.
 * 
 * Usage: /score <+1|0|-1> "<optional comment>"
 * Example: /score +1 "Great escalation timing"
 * Example: /score -1 "Too verbose"
 */

import { getDb } from '../../db/connection.js';
import { SCORE_COMMAND_USAGE } from '../../training/config/analysis_prompts.js';

export async function handleScoreCommand(userId, circleId, parts, sendMessageToUser) {
    const db = await getDb();
    
    // Parse command: /score <score> "<comment>"
    if (parts.length < 2) {
        sendMessageToUser(userId, SCORE_COMMAND_USAGE);
        return;
    }

    // Parse score
    const scoreStr = parts[1];
    let score;
    
    if (scoreStr === '+1' || scoreStr === '1') {
        score = 1;
    } else if (scoreStr === '0') {
        score = 0;
    } else if (scoreStr === '-1') {
        score = -1;
    } else {
        sendMessageToUser(userId, '❌ Invalid score. Use +1, 0, or -1');
        return;
    }

    // Extract comment (everything after the score, removing quotes if present)
    const comment = parts.slice(2).join(' ').replace(/^["']|["']$/g, '');

    // Get the last conversation/interaction for this user
    // We'll score the most recent AI interaction
    const lastMessage = await db.get(
        `SELECT id, timestamp FROM messages 
         WHERE circle_id = ? AND sender_id = ? 
         ORDER BY timestamp DESC LIMIT 1`,
        [circleId, userId]
    );

    if (!lastMessage) {
        sendMessageToUser(userId, '❌ No recent interaction found to score');
        return;
    }

    // Create feedback table if it doesn't exist
    await db.run(`
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT,
            message_id INTEGER,
            user_id TEXT,
            circle_id TEXT,
            score INTEGER,
            comment TEXT,
            timestamp INTEGER,
            FOREIGN KEY(message_id) REFERENCES messages(id)
        )
    `);

    // Store feedback
    const conversationId = `${circleId}_${userId}_${lastMessage.timestamp}`;
    await db.run(
        `INSERT INTO feedback (conversation_id, message_id, user_id, circle_id, score, comment, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [conversationId, lastMessage.id, userId, circleId, score, comment || '', Date.now()]
    );

    // Confirmation message
    const emoji = score === 1 ? '👍' : score === -1 ? '👎' : '👌';
    let response = `${emoji} Feedback recorded (score: ${scoreStr})`;
    if (comment) {
        response += `\nComment: "${comment}"`;
    }
    response += '\n\nThank you for helping improve the system!';
    
    sendMessageToUser(userId, response);

    console.log(`[ScoreCommand] User ${userId} scored interaction: ${scoreStr} - "${comment}"`);
}

