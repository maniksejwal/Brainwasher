/**
 * @fileoverview Database queries for future planning and scheduled messages
 * Supports multi-turn conversation strategy: future planning, task scheduling, and message scheduling
 */

import { getDb } from './connection.js';
import { randomUUID } from 'crypto';

/**
 * Create a future plan
 * @param {string} circleId - Care circle ID
 * @param {string} userId - User ID
 * @param {string} planType - Type of plan (question, follow_up, reminder, etc.)
 * @param {string} description - Description of the plan
 * @param {number|null} scheduledTurn - Turn number to execute (null for non-turn triggers)
 * @param {object|null} details - Additional details JSON
 * @param {string|null} triggerType - Type of trigger (turn, date, duration, location, event, interaction, condition)
 * @param {string|null} triggerValue - Specific trigger value (ISO date, duration, location name, event type, etc.)
 * @param {object|null} triggerDetails - Additional trigger metadata
 */
export async function createFuturePlan(circleId, userId, planType, description, scheduledTurn, details = null, triggerType = null, triggerValue = null, triggerDetails = null) {
    const db = await getDb();
    const planId = randomUUID();
    const detailsJson = details ? JSON.stringify(details) : null;
    const triggerDetailsJson = triggerDetails ? JSON.stringify(triggerDetails) : null;
    
    // Calculate scheduled_timestamp based on trigger type
    let scheduledTimestamp = null;
    if (triggerType === 'turn' && scheduledTurn !== null) {
        scheduledTimestamp = Date.now() + (scheduledTurn * 60000); // 1 minute per turn
    } else if (triggerType === 'date' && triggerValue) {
        scheduledTimestamp = new Date(triggerValue).getTime();
    } else if (triggerType === 'duration' && triggerValue) {
        const durationMs = parseDurationToMs(triggerValue);
        scheduledTimestamp = Date.now() + durationMs;
    }
    // For other trigger types (location, event, interaction, condition), timestamp can be set later
    
    await db.run(
        `INSERT INTO future_plans (plan_id, circle_id, user_id, plan_type, description, scheduled_turn, scheduled_timestamp, trigger_type, trigger_value, trigger_details, status, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [planId, circleId, userId, planType, description, scheduledTurn, scheduledTimestamp, triggerType, triggerValue, triggerDetailsJson, detailsJson, Date.now()]
    );
    
    return planId;
}

/**
 * Parse duration string to milliseconds
 * Examples: "2 hours", "30 minutes", "1 day", "3 days"
 */
function parseDurationToMs(durationString) {
    const parts = durationString.toLowerCase().match(/(\d+)\s*(hour|hours|minute|minutes|day|days|week|weeks|month|months)/);
    if (!parts) {
        console.warn(`[FuturePlans] Could not parse duration: ${durationString}, defaulting to 0`);
        return 0;
    }
    
    const value = parseInt(parts[1]);
    const unit = parts[2];
    
    const multipliers = {
        minute: 60 * 1000,
        minutes: 60 * 1000,
        hour: 60 * 60 * 1000,
        hours: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000,
        days: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        weeks: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
        months: 30 * 24 * 60 * 60 * 1000
    };
    
    return value * (multipliers[unit] || 0);
}

/**
 * Get pending future plans for a user/circle
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {number|null} currentTurn - Current conversation turn
 * @param {number|null} currentTimestamp - Current timestamp for date/duration triggers
 */
export async function getPendingFuturePlans(userId, circleId, currentTurn = null, currentTimestamp = null) {
    const db = await getDb();
    
    let query = `SELECT * FROM future_plans 
                 WHERE user_id = ? AND circle_id = ? AND status = 'pending'`;
    let params = [userId, circleId];
    
    // Add conditions based on trigger type
    if (currentTurn !== null || currentTimestamp !== null) {
        query += ` AND (`;
        const conditions = [];
        
        // Turn-based triggers
        if (currentTurn !== null) {
            conditions.push(`(trigger_type = 'turn' AND scheduled_turn IS NOT NULL AND scheduled_turn <= ?)`);
            params.push(currentTurn);
        }
        
        // Date/duration triggers
        if (currentTimestamp !== null) {
            const now = currentTimestamp || Date.now();
            conditions.push(`(trigger_type IN ('date', 'duration') AND scheduled_timestamp IS NOT NULL AND scheduled_timestamp <= ?)`);
            params.push(now);
        }
        
        // Combine with OR if we have any conditions
        if (conditions.length > 0) {
            query += conditions.join(' OR ');
        } else {
            query += '1=0'; // No matching triggers if no timestamps provided
        }
        query += `)`;
    }
    
    query += ` ORDER BY scheduled_turn ASC, scheduled_timestamp ASC, created_at ASC`;
    
    const rows = await db.all(query, params);
    return rows.map(row => ({
        ...row,
        details: row.details ? JSON.parse(row.details) : null,
        triggerDetails: row.trigger_details ? JSON.parse(row.trigger_details) : null
    }));
}

/**
 * Mark a future plan as executed
 */
export async function executeFuturePlan(planId, result = null) {
    const db = await getDb();
    const resultJson = result ? JSON.stringify(result) : null;
    
    await db.run(
        `UPDATE future_plans 
         SET status = 'executed', executed_at = ?, details = COALESCE(?, details)
         WHERE plan_id = ?`,
        [Date.now(), resultJson, planId]
    );
}

/**
 * Cancel a future plan
 */
export async function cancelFuturePlan(planId) {
    const db = await getDb();
    await db.run(
        `UPDATE future_plans SET status = 'cancelled' WHERE plan_id = ?`,
        [planId]
    );
}

/**
 * Reschedule a future plan
 * @param {string} planId - Plan ID to reschedule
 * @param {number|null} newScheduledTurn - New turn number (for turn-based triggers)
 * @param {number|null} newScheduledTimestamp - New timestamp (for date/duration triggers)
 * @param {string|null} newTriggerValue - New trigger value if trigger type changes
 */
export async function rescheduleFuturePlan(planId, newScheduledTurn = null, newScheduledTimestamp = null, newTriggerValue = null) {
    const db = await getDb();
    
    const updates = [];
    const params = [];
    
    if (newScheduledTurn !== null) {
        updates.push('scheduled_turn = ?');
        params.push(newScheduledTurn);
    }
    
    if (newScheduledTimestamp !== null) {
        updates.push('scheduled_timestamp = ?');
        params.push(newScheduledTimestamp);
    }
    
    if (newTriggerValue !== null) {
        updates.push('trigger_value = ?');
        params.push(newTriggerValue);
    }
    
    if (updates.length === 0) {
        throw new Error('No rescheduling parameters provided');
    }
    
    params.push(planId);
    
    await db.run(
        `UPDATE future_plans SET ${updates.join(', ')} WHERE plan_id = ? AND status = 'pending'`,
        params
    );
}

/**
 * Reschedule a scheduled message
 * @param {string} scheduledMessageId - Scheduled message ID to reschedule
 * @param {number|null} newScheduledTurn - New turn number (for turn-based triggers)
 * @param {number|null} newScheduledTimestamp - New timestamp (for date/duration triggers)
 * @param {string|null} newTriggerValue - New trigger value if trigger type changes
 */
export async function rescheduleScheduledMessage(scheduledMessageId, newScheduledTurn = null, newScheduledTimestamp = null, newTriggerValue = null) {
    const db = await getDb();
    
    const updates = [];
    const params = [];
    
    if (newScheduledTurn !== null) {
        updates.push('scheduled_turn = ?');
        params.push(newScheduledTurn);
    }
    
    if (newScheduledTimestamp !== null) {
        updates.push('scheduled_timestamp = ?');
        params.push(newScheduledTimestamp);
    }
    
    if (newTriggerValue !== null) {
        updates.push('trigger_value = ?');
        params.push(newTriggerValue);
    }
    
    if (updates.length === 0) {
        throw new Error('No rescheduling parameters provided');
    }
    
    params.push(scheduledMessageId);
    
    await db.run(
        `UPDATE scheduled_messages SET ${updates.join(', ')} WHERE scheduled_message_id = ? AND status = 'pending'`,
        params
    );
}

/**
 * Create a scheduled message
 * @param {string} circleId - Care circle ID
 * @param {string} userId - User ID
 * @param {string} messageText - Message to send
 * @param {number|null} scheduledTurn - Turn number to send (null for non-turn triggers)
 * @param {string|null} targetUserId - Target user ID
 * @param {string|null} triggerType - Type of trigger (turn, date, duration, location, event, interaction, condition)
 * @param {string|null} triggerValue - Specific trigger value
 * @param {object|null} triggerDetails - Additional trigger metadata
 * @param {string|null} legacyTriggerCondition - Legacy trigger_condition field (for backward compatibility)
 */
export async function createScheduledMessage(circleId, userId, messageText, scheduledTurn, targetUserId = null, triggerType = null, triggerValue = null, triggerDetails = null, legacyTriggerCondition = null) {
    const db = await getDb();
    const scheduledMessageId = randomUUID();
    const triggerDetailsJson = triggerDetails ? JSON.stringify(triggerDetails) : null;
    
    // Calculate scheduled_timestamp based on trigger type
    let scheduledTimestamp = null;
    if (triggerType === 'turn' && scheduledTurn !== null) {
        scheduledTimestamp = Date.now() + (scheduledTurn * 60000); // 1 minute per turn
    } else if (triggerType === 'date' && triggerValue) {
        scheduledTimestamp = new Date(triggerValue).getTime();
    } else if (triggerType === 'duration' && triggerValue) {
        const durationMs = parseDurationToMs(triggerValue);
        scheduledTimestamp = Date.now() + durationMs;
    }
    
    await db.run(
        `INSERT INTO scheduled_messages (scheduled_message_id, circle_id, user_id, target_user_id, message_text, scheduled_turn, scheduled_timestamp, trigger_type, trigger_value, trigger_details, trigger_condition, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [scheduledMessageId, circleId, userId, targetUserId, messageText, scheduledTurn, scheduledTimestamp, triggerType, triggerValue, triggerDetailsJson, legacyTriggerCondition, Date.now()]
    );
    
    return scheduledMessageId;
}

/**
 * Get pending scheduled messages for a user/circle
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {number|null} currentTurn - Current conversation turn
 * @param {number|null} currentTimestamp - Current timestamp for date/duration triggers
 */
export async function getPendingScheduledMessages(userId, circleId, currentTurn = null, currentTimestamp = null) {
    const db = await getDb();
    
    let query = `SELECT * FROM scheduled_messages 
                 WHERE user_id = ? AND circle_id = ? AND status = 'pending'`;
    let params = [userId, circleId];
    
    // Add conditions based on trigger type
    if (currentTurn !== null || currentTimestamp !== null) {
        query += ` AND (`;
        const conditions = [];
        
        // Turn-based triggers
        if (currentTurn !== null) {
            conditions.push(`(trigger_type = 'turn' AND scheduled_turn IS NOT NULL AND scheduled_turn <= ?)`);
            params.push(currentTurn);
        }
        
        // Date/duration triggers
        if (currentTimestamp !== null) {
            const now = currentTimestamp || Date.now();
            conditions.push(`(trigger_type IN ('date', 'duration') AND scheduled_timestamp IS NOT NULL AND scheduled_timestamp <= ?)`);
            params.push(now);
        }
        
        // Combine with OR if we have any conditions
        if (conditions.length > 0) {
            query += conditions.join(' OR ');
        } else {
            query += '1=0'; // No matching triggers if no timestamps provided
        }
        query += `)`;
    }
    
    query += ` ORDER BY scheduled_turn ASC, scheduled_timestamp ASC, created_at ASC`;
    
    const rows = await db.all(query, params);
    return rows.map(row => ({
        ...row,
        triggerDetails: row.trigger_details ? JSON.parse(row.trigger_details) : null
    }));
}

/**
 * Mark a scheduled message as sent
 */
export async function markScheduledMessageSent(scheduledMessageId) {
    const db = await getDb();
    await db.run(
        `UPDATE scheduled_messages 
         SET status = 'sent', sent_at = ?
         WHERE scheduled_message_id = ?`,
        [Date.now(), scheduledMessageId]
    );
}

/**
 * Cancel a scheduled message
 */
export async function cancelScheduledMessage(scheduledMessageId) {
    const db = await getDb();
    await db.run(
        `UPDATE scheduled_messages SET status = 'cancelled' WHERE scheduled_message_id = ?`,
        [scheduledMessageId]
    );
}

