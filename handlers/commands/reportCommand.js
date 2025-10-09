/**
 * @fileoverview handlers/commands/reportCommand.js
 * Enhanced feedback reporting for detailed issue tracking.
 * 
 * Usage: /report <category> "<description>"
 * Examples:
 *   /report bug "Template variables {{TO_USER}} not replaced"
 *   /report privacy "Wrong agent talking to user"
 *   /report tone "Response was too clinical, not empathetic"
 *   /report architecture "A's agent messaged B directly"
 */

import { getDb } from '../../db/connection.js';

const VALID_CATEGORIES = {
    bug: '🐛 Bug/Error',
    privacy: '🔒 Privacy/Security',
    architecture: '🏗️ Architecture Violation',
    tone: '💬 Tone/Empathy',
    accuracy: '🎯 Accuracy/Intent',
    verbosity: '📝 Too Verbose',
    brevity: '📉 Too Brief',
    escalation: '🚨 Escalation Issue',
    consent: '✋ Consent Issue',
    other: '📌 Other'
};

export async function handleReportCommand(userId, circleId, parts, sendMessageToUser) {
    const db = await getDb();
    
    // Parse: /report <category> "<description>"
    if (parts.length < 3) {
        const categoriesList = Object.entries(VALID_CATEGORIES)
            .map(([key, label]) => `  ${label} (${key})`)
            .join('\n');
        
        sendMessageToUser(userId, 
            `📋 Report an issue with detailed feedback:\n\n` +
            `Usage: /report <category> "<description>"\n\n` +
            `Categories:\n${categoriesList}\n\n` +
            `Examples:\n` +
            `  /report bug "Variables not replaced: {{TO_USER}}"\n` +
            `  /report privacy "Wrong agent talking to user"\n` +
            `  /report tone "Too formal, not empathetic enough"\n` +
            `  /report architecture "A's CareAgent messaged B directly"`
        );
        return;
    }

    const category = parts[1].toLowerCase();
    const description = parts.slice(2).join(' ').replace(/^["']|["']$/g, '');

    // Validate category
    if (!VALID_CATEGORIES[category]) {
        sendMessageToUser(userId, 
            `❌ Invalid category: "${category}"\n\n` +
            `Valid categories: ${Object.keys(VALID_CATEGORIES).join(', ')}\n` +
            `Use /report for help.`
        );
        return;
    }

    // Get last interaction context
    const lastMessage = await db.get(
        `SELECT id, timestamp, message FROM messages 
         WHERE circle_id = ? AND sender_id = ? 
         ORDER BY timestamp DESC LIMIT 1`,
        [circleId, userId]
    );

    // Create detailed_feedback table if it doesn't exist
    await db.run(`
        CREATE TABLE IF NOT EXISTS detailed_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT,
            message_id INTEGER,
            user_id TEXT,
            circle_id TEXT,
            category TEXT,
            description TEXT,
            context TEXT,
            timestamp INTEGER,
            resolved BOOLEAN DEFAULT 0,
            FOREIGN KEY(message_id) REFERENCES messages(id)
        )
    `);

    // Store detailed feedback
    const conversationId = lastMessage 
        ? `${circleId}_${userId}_${lastMessage.timestamp}` 
        : `${circleId}_${userId}_${Date.now()}`;

    await db.run(
        `INSERT INTO detailed_feedback 
         (conversation_id, message_id, user_id, circle_id, category, description, context, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            conversationId,
            lastMessage?.id || null,
            userId,
            circleId,
            category,
            description,
            lastMessage?.message || null,
            Date.now()
        ]
    );

    const emoji = VALID_CATEGORIES[category].split(' ')[0];
    sendMessageToUser(userId, 
        `${emoji} Issue reported!\n\n` +
        `Category: ${VALID_CATEGORIES[category]}\n` +
        `Description: "${description}"\n\n` +
        `This will help improve the system. Thank you! 🙏`
    );

    console.log(`[ReportCommand] ${VALID_CATEGORIES[category]} reported by ${userId}: "${description}"`);
}

