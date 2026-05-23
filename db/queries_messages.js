/**
 * @fileoverview Enhanced Message and Fact Queries
 * 
 * UPDATED ARCHITECTURE:
 * - Extends existing care circle message storage for professional circles
 * - Uses existing facts_v2 table and queries_facts.js system (NO NEW FACT TABLES)
 * - Adds message metadata to capture LLM analysis results
 * - Preserves all existing medical functionality while adding business context
 * - Business logic imports this module to extend unified messaging capabilities
 * 
 * INTEGRATION STRATEGY:
 * - Import businessContextMemory.js for business-specific context management  
 * - Use existing addFact() from queries_facts.js for all fact storage
 * - No duplication of fact storage systems - leverages sophisticated facts_v2 architecture
 * - LLM analysis results stored in message_metadata, facts stored in facts_v2
 */

import { getDb } from './connection.js';

export async function addMessage(circleId, userId, role, message, privacy, criticality, analysisMetadata = null) {
    const db = await getDb();
    const messageId = await new Promise((resolve) => {
        db.run('INSERT INTO messages (circle_id, user_id, role, message, privacy_level, criticality_level, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)', 
               [circleId, userId, role, message, privacy, criticality, Date.now()], 
               function() { resolve(this.lastID); });
    });
    
    // Store LLM analysis results if provided (from companion system)
    if (analysisMetadata) {
        await addMessageMetadata(messageId, circleId, analysisMetadata);
    }
    
    return messageId;
}

async function addMessageMetadata(messageId, circleId, analysisMetadata) {
    const db = await getDb();
    
    // Use circle type to determine context (but let LLM determine topics)
    const circle = await db.get('SELECT circle_type FROM care_circles WHERE circle_id = ?', [circleId]);
    const contextType = circle?.circle_type === 'professional' ? 'business' : 'medical';
    
    // Use LLM analysis results directly - no hardcoded topic extraction
    await db.run(`
        INSERT INTO message_metadata 
        (message_id, circle_id, context_type, intent, topics, urgency, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        messageId,
        circleId,
        contextType,
        analysisMetadata.intent || 'GENERAL_DISCUSSION',
        JSON.stringify(analysisMetadata.topics || []),
        analysisMetadata.urgency || 'normal', 
        JSON.stringify(analysisMetadata),
        Date.now()
    ]);
}

export async function getRecentMessages(circleId, limit = 5) {
    const db = await getDb();
    return db.all('SELECT user_id, message FROM messages WHERE circle_id = ? ORDER BY timestamp DESC LIMIT ?', [circleId, limit]);
}

export async function upsertFact(circleId, factKey, userId, factValue, analysisMetadata = null) {
    const db = await getDb();
    const now = Date.now();
    
    // Use LLM analysis to determine fact category and confidence, not hardcoded rules
    const enhancedValue = typeof factValue === 'string' ? factValue : JSON.stringify(factValue);
    
    await db.run(
        `INSERT INTO facts (circle_id, fact_key, reported_by, value, timestamp) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(circle_id, fact_key, reported_by) DO UPDATE SET value = excluded.value, timestamp = excluded.timestamp`,
        [circleId, factKey, userId, enhancedValue, now]
    );
    
    await db.run('INSERT INTO fact_history (circle_id, fact_key, reported_by, value, timestamp) VALUES (?, ?, ?, ?, ?)', 
                 [circleId, factKey, userId, enhancedValue, now]);
    
    // Store LLM-determined fact metadata if provided
    if (analysisMetadata?.confidence || analysisMetadata?.category) {
        const circle = await db.get('SELECT circle_type FROM care_circles WHERE circle_id = ?', [circleId]);
        const contextType = circle?.circle_type === 'professional' ? 'business' : 'medical';
        
        await db.run(`
            INSERT INTO fact_metadata 
            (circle_id, fact_key, reported_by, category, confidence_score, context_type, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(circle_id, fact_key, reported_by) DO UPDATE SET 
                category = excluded.category, 
                confidence_score = excluded.confidence_score,
                context_type = excluded.context_type,
                created_at = excluded.created_at
        `, [circleId, factKey, userId, analysisMetadata.category || 'general', analysisMetadata.confidence || 0.8, contextType, now]);
    }
}

export async function getLastFact(circleId, factKey) {
    const db = await getDb();
    return db.get('SELECT * FROM facts WHERE circle_id = ? AND fact_key = ? ORDER BY timestamp DESC LIMIT 1', [circleId, factKey]);
}

export async function getFactHistory(circleId, factKey = 'all', limit = 10) {
    const db = await getDb();
    if (factKey === 'all') {
        return db.all('SELECT * FROM fact_history WHERE circle_id = ? ORDER BY timestamp DESC LIMIT ?', [circleId, limit]);
    }
    return db.all('SELECT * FROM fact_history WHERE circle_id = ? AND fact_key = ? ORDER BY timestamp DESC LIMIT ?', [circleId, factKey, limit]);
}

/**
 * Get total unread messages count for a user across all circles.
 * (Excludes user's own messages)
 */
export async function getTotalUnreadMessageCount(userId) {
    const db = await getDb();
    const result = await db.get(`
        SELECT COUNT(*) as count 
        FROM messages m
        JOIN care_circle_members cm ON m.circle_id = cm.circle_id
        WHERE cm.user_id = ?
          AND m.user_id != ? -- Don't count own messages
          AND m.timestamp > cm.last_read_timestamp
    `, [userId, userId]);
    return result?.count || 0;
}

/**
 * Mark a circle as read for a user (updates last_read_timestamp)
 */
export async function markCircleRead(userId, circleId) {
    const db = await getDb();
    await db.run(`
        UPDATE care_circle_members 
        SET last_read_timestamp = ? 
        WHERE user_id = ? AND circle_id = ?
    `, [Date.now(), userId, circleId]);
}

/**
 * Enhanced conversation history retrieval for both medical and business contexts
 */
export async function getEnhancedConversationHistory(circleId, options = {}) {
    const {
        topics = [],
        contextType = null, // 'medical', 'business', or null for both
        timeRange = null,
        urgency = null,
        intent = null,
        includeMetadata = true,
        limit = 50
    } = options;
    
    const db = await getDb();
    
    let query = `
        SELECT m.*, u.username, mm.intent, mm.topics, mm.urgency, mm.context_type
        FROM messages m
        JOIN users u ON m.user_id = u.user_id
        LEFT JOIN message_metadata mm ON m.message_id = mm.message_id
        WHERE m.circle_id = ?
    `;
    
    const params = [circleId];
    
    // Add filters while preserving both medical and business functionality
    if (topics.length > 0) {
        const topicConditions = topics.map(() => 'mm.topics LIKE ?').join(' OR ');
        query += ` AND (${topicConditions})`;
        params.push(...topics.map(topic => `%"${topic}"%`));
    }
    
    if (contextType) {
        query += ` AND mm.context_type = ?`;
        params.push(contextType);
    }
    
    if (intent) {
        query += ` AND mm.intent = ?`;
        params.push(intent);
    }
    
    if (urgency) {
        query += ` AND mm.urgency = ?`;
        params.push(urgency);
    }
    
    if (timeRange) {
        query += ` AND m.timestamp >= ? AND m.timestamp <= ?`;
        params.push(timeRange.start, timeRange.end);
    }
    
    query += ` ORDER BY m.timestamp DESC LIMIT ?`;
    params.push(limit);
    
    const messages = await db.all(query, params);
    
    if (includeMetadata) {
        for (const message of messages) {
            if (message.topics) {
                try {
                    message.topics = JSON.parse(message.topics);
                } catch (e) {
                    message.topics = [];
                }
            }
        }
    }
    
    return messages;
}

/**
 * Get facts by category for both medical and business contexts
 */
export async function getFactsByCategory(circleId, category = null, contextType = null) {
    const db = await getDb();
    
    let query = `
        SELECT f.*, fm.category, fm.confidence_score, fm.context_type
        FROM facts f
        LEFT JOIN fact_metadata fm ON f.circle_id = fm.circle_id 
            AND f.fact_key = fm.fact_key 
            AND f.reported_by = fm.reported_by
        WHERE f.circle_id = ?
    `;
    
    const params = [circleId];
    
    if (category) {
        query += ` AND fm.category = ?`;
        params.push(category);
    }
    
    if (contextType) {
        query += ` AND fm.context_type = ?`;
        params.push(contextType);
    }
    
    query += ` ORDER BY f.timestamp DESC`;
    
    return await db.all(query, params);
}
