/**
 * @fileoverview handlers/commands/feedbackCommand.js
 * Unified feedback command - combines quick scoring with detailed reporting.
 * 
 * Usage:
 *   /feedback +1                           - Quick positive score
 *   /feedback -1                           - Quick negative score
 *   /feedback +1 "Great!"                  - Score with comment
 *   /feedback bug "Variables not replaced" - Detailed bug report
 *   /feedback privacy "Shared without consent" - Category report
 * 
 * Backwards compatible with:
 *   /score +1 "comment"
 *   /report bug "description"
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

export async function handleFeedbackCommand(userId, circleId, parts, sendMessageToUser) {
    const db = await getDb();
    
    if (parts.length < 2) {
        showHelp(sendMessageToUser, userId);
        return;
    }

    const firstArg = parts[1];
    
    // Detect if it's a score (starts with +/- or is 0)
    if (['+1', '1', '-1', '0'].includes(firstArg)) {
        await handleScoreFeedback(db, userId, circleId, parts, sendMessageToUser);
    }
    // Detect if it's a category
    else if (VALID_CATEGORIES[firstArg.toLowerCase()]) {
        await handleCategorizedFeedback(db, userId, circleId, parts, sendMessageToUser);
    }
    else {
        sendMessageToUser(userId, 
            `❌ Invalid feedback type: "${firstArg}"\n\n` +
            `Use:\n` +
            `  /feedback +1 "comment"  - for scoring\n` +
            `  /feedback bug "issue"   - for detailed reports\n\n` +
            `Type /feedback for full help.`
        );
    }
}

async function handleScoreFeedback(db, userId, circleId, parts, sendMessageToUser) {
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

    const comment = parts.slice(2).join(' ').replace(/^["']|["']$/g, '');

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

    // Create feedback table if needed
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
            source TEXT DEFAULT 'user',
            FOREIGN KEY(message_id) REFERENCES messages(id)
        )
    `);

    const conversationId = `${circleId}_${userId}_${lastMessage.timestamp}`;
    await db.run(
        `INSERT INTO feedback (conversation_id, message_id, user_id, circle_id, score, comment, timestamp, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'user')`,
        [conversationId, lastMessage.id, userId, circleId, score, comment || '', Date.now()]
    );

    const emoji = score === 1 ? '👍' : score === -1 ? '👎' : '👌';
    let response = `${emoji} Quick feedback recorded (score: ${scoreStr})`;
    if (comment) {
        response += `\nComment: "${comment}"`;
    }
    response += '\n\nThank you for helping improve the system!';
    
    sendMessageToUser(userId, response);
}

async function handleCategorizedFeedback(db, userId, circleId, parts, sendMessageToUser) {
    const category = parts[1].toLowerCase();
    const description = parts.slice(2).join(' ').replace(/^["']|["']$/g, '');

    if (!description) {
        sendMessageToUser(userId, 
            `❌ Please provide a description:\n` +
            `/feedback ${category} "your detailed description"`
        );
        return;
    }

    const lastMessage = await db.get(
        `SELECT id, timestamp, message FROM messages 
         WHERE circle_id = ? AND sender_id = ? 
         ORDER BY timestamp DESC LIMIT 1`,
        [circleId, userId]
    );

    // Create detailed_feedback table if needed
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
            source TEXT DEFAULT 'user',
            FOREIGN KEY(message_id) REFERENCES messages(id)
        )
    `);

    const conversationId = lastMessage 
        ? `${circleId}_${userId}_${lastMessage.timestamp}` 
        : `${circleId}_${userId}_${Date.now()}`;

    await db.run(
        `INSERT INTO detailed_feedback 
         (conversation_id, message_id, user_id, circle_id, category, description, context, timestamp, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'user')`,
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
        `${emoji} Detailed issue reported!\n\n` +
        `Category: ${VALID_CATEGORIES[category]}\n` +
        `Description: "${description}"\n\n` +
        `This will help improve the system. Thank you! 🙏`
    );

    console.log(`[FeedbackCommand] ${VALID_CATEGORIES[category]} reported by ${userId}: "${description}"`);
}

function showHelp(sendMessageToUser, userId) {
    const categoriesList = Object.entries(VALID_CATEGORIES)
        .map(([key, label]) => `    ${label} (${key})`)
        .join('\n');
    
    sendMessageToUser(userId, 
        `📋 Unified Feedback System\n\n` +
        `${'-'.repeat(50)}\n` +
        `QUICK SCORING:\n` +
        `  /feedback +1              - Good interaction\n` +
        `  /feedback -1              - Bad interaction\n` +
        `  /feedback 0               - Neutral\n` +
        `  /feedback +1 "comment"    - With explanation\n\n` +
        `${'-'.repeat(50)}\n` +
        `DETAILED REPORTS:\n` +
        `  /feedback <category> "detailed description"\n\n` +
        `Categories:\n${categoriesList}\n\n` +
        `${'-'.repeat(50)}\n` +
        `Examples:\n` +
        `  /feedback +1 "Perfect timing!"\n` +
        `  /feedback bug "Variables {{TO_USER}} not replaced"\n` +
        `  /feedback privacy "Wrong agent messaging me"\n` +
        `  /feedback tone "Too clinical, needs empathy"\n\n` +
        `${'-'.repeat(50)}\n` +
        `TIP: Use quick scoring frequently, detailed reports for specific issues!`
    );
}

