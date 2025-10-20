/**
 * @fileoverview handlers/message_logic/topicShiftHandler.js
 * Handles topic shift detection and response strategies
 */

import { addMessage } from '../../db/index.js';

export class TopicShiftHandler {
    constructor(events) {
        this.events = events;
        this.setupEventListeners();
    }

    /**
     * Setup event listeners for topic shift events
     */
    setupEventListeners() {
        this.events.on('topic_shift_detected', async (data) => {
            await this.handleTopicShift(data);
        });
    }

    /**
     * Handle detected topic shifts
     */
    async handleTopicShift(data) {
        const { userId, shift, timestamp } = data;
        
        console.log(`[TopicShiftHandler] Topic shift detected for user ${userId}:`);
        console.log(`  Type: ${shift.type}`);
        console.log(`  Reason: ${shift.reason}`);
        console.log(`  Confidence: ${(shift.confidence * 100).toFixed(0)}%`);
        
        if (shift.suggestsAvoidance) {
            console.log(`  ⚠️  AVOIDANCE BEHAVIOR DETECTED`);
            
            // Emit avoidance event for other handlers
            this.events.emit('avoidance_detected', {
                userId,
                shift,
                timestamp,
                severity: shift.severity
            });
        }

        // Store topic shift in database for analysis
        try {
            await addMessage(
                userId, // Use user's circle as the circle_id
                'system',
                'topic_shift_detector',
                `Topic shift detected: ${shift.type} - ${shift.reason}`,
                'PRIVATE',
                'NONE'
            );
        } catch (error) {
            console.warn(`[TopicShiftHandler] Failed to store topic shift: ${error.message}`);
        }
    }

    /**
     * Get response strategy for topic shifts
     */
    getResponseStrategy(shift) {
        switch (shift.type) {
            case 'explicit':
                return {
                    strategy: 'acknowledge_and_gently_return',
                    message: 'I understand you\'d like to discuss something else. Before we move on, could you tell me more about...'
                };
            
            case 'sudden':
                return {
                    strategy: 'acknowledge_and_probe',
                    message: 'I notice we\'ve moved to a different topic. Is there something about our previous discussion that\'s concerning you?'
                };
            
            case 'avoidance':
                return {
                    strategy: 'gentle_persistence',
                    message: 'I sense this might be difficult to talk about. Take your time - I\'m here to listen.'
                };
            
            case 'deflection':
                return {
                    strategy: 'redirect_with_empathy',
                    message: 'I appreciate you sharing that. I\'d also like to understand more about...'
                };
            
            default:
                return {
                    strategy: 'observe',
                    message: null
                };
        }
    }
}

// Initialize the handler with events from messageHandler
export function initializeTopicShiftHandler(events) {
    return new TopicShiftHandler(events);
}
