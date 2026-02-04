/**
 * @fileoverview Component for loading and merging training data
 */

import { getDb } from '../../../db/connection.js';
import { getStorage } from '../../../lib/storage/index.js';

export class DataLoader {
    constructor() {
        this.storage = getStorage();
    }

    /**
     * Load training log entries
     */
    async loadTrainingLog(logPath = 'training/training_log.jsonl') {
        try {
            if (!await this.storage.exists(logPath)) {
                return [];
            }
            const content = await this.storage.read(logPath);
            const lines = content.trim().split('\n').filter(line => line);
            return lines.map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return null;
                }
            }).filter(Boolean);
        } catch (error) {
            console.error('[DataLoader] Error loading training log:', error.message);
            return [];
        }
    }

    /**
     * Load human feedback from database
     */
    async loadFeedback() {
        const db = await getDb();

        try {
            const feedback = await db.all(`
                SELECT * FROM feedback 
                ORDER BY timestamp DESC
            `);
            return feedback;
        } catch (error) {
            console.error('[DataLoader] Error loading feedback:', error.message);
            return [];
        }
    }

    /**
     * Merge training logs with feedback entries
     */
    mergeLogsWithFeedback(logs, feedback) {
        // Create feedback map by conversation_id + turn (or message_id for precise matching)
        const feedbackMap = new Map();

        feedback.forEach(f => {
            let key;
            if (f.conversation_id && f.message_id !== null && f.message_id !== undefined) {
                key = `${f.conversation_id}_msg_${f.message_id}`;
            } else if (f.conversation_id) {
                key = f.conversation_id;
            } else {
                return;
            }

            if (!feedbackMap.has(key)) {
                feedbackMap.set(key, []);
            }
            feedbackMap.get(key).push(f);
        });

        return logs.map(log => {
            let matchedFeedback = null;

            if (log.conversation_id && log.turn !== null && log.turn !== undefined) {
                const convFeedback = feedback.filter(f => f.conversation_id === log.conversation_id);
                if (convFeedback.length > 0) {
                    const sorted = convFeedback.sort((a, b) =>
                        (a.message_id || 0) - (b.message_id || 0) ||
                        (a.timestamp || 0) - (b.timestamp || 0)
                    );
                    matchedFeedback = sorted[log.turn] || sorted[0];
                }
            } else if (log.conversation_id) {
                const key = log.conversation_id;
                const feedbacks = feedbackMap.get(key);
                if (feedbacks && feedbacks.length > 0) {
                    matchedFeedback = feedbacks.find(f => f.user_id === log.user_id) || feedbacks[0];
                }
            }

            return {
                ...log,
                feedback: matchedFeedback,
                _mapping: {
                    matched: !!matchedFeedback,
                    method: matchedFeedback ?
                        (log.turn !== null && log.turn !== undefined ? 'conversation_id+turn' : 'conversation_id') :
                        'none'
                }
            };
        });
    }
}
