/**
 * @fileoverview Topic Shift Detection Agent
 * Uses LLM to detect conversational patterns and topic avoidance
 */

import { makeApiCall } from '../../agents/api_client.js';

export class TopicShiftAgent {
    constructor() {
        this.conversationHistory = [];
    }

    /**
     * Analyze message for topic shifts using LLM
     */
    async analyzeMessage(message, turn) {
        this.conversationHistory.push({
            turn,
            message,
            timestamp: Date.now()
        });

        if (this.conversationHistory.length < 2) {
            return null; // Need at least 2 messages to detect shifts
        }

        const recentMessages = this.conversationHistory.slice(-3);
        const analysis = await this._analyzeWithLLM(recentMessages);

        return analysis;
    }

    /**
     * Use LLM to analyze conversational patterns
     */
    async _analyzeWithLLM(recentMessages) {
        const conversationText = recentMessages.map(msg => 
            `Turn ${msg.turn}: ${msg.message}`
        ).join('\n');

        const prompt = `Analyze this conversation for topic shifts and avoidance patterns. Look for:

1. Explicit topic changes ("let's talk about something else", "actually", "by the way")
2. Sudden topic switches without transition
3. Avoidance of difficult topics (symptoms, emotions, problems)
4. Deflection patterns (changing subject when uncomfortable)

Conversation:
${conversationText}

Respond with JSON only:
{
  "hasShift": boolean,
  "shiftType": "explicit" | "sudden" | "avoidance" | "deflection" | null,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "fromTopic": "previous topic",
  "toTopic": "new topic",
  "suggestsAvoidance": boolean
}`;

        try {
            const result = await makeApiCall(prompt, [], true, 0.3, 200);
            const analysis = JSON.parse(result.reply);
            
            if (analysis.hasShift && analysis.confidence > 0.7) {
                return {
                    type: analysis.shiftType,
                    confidence: analysis.confidence,
                    reason: analysis.reason,
                    fromTopic: analysis.fromTopic,
                    toTopic: analysis.toTopic,
                    suggestsAvoidance: analysis.suggestsAvoidance,
                    severity: analysis.suggestsAvoidance ? 'high' : 'medium'
                };
            }
            
            return null;
        } catch (error) {
            console.warn(`[TopicShiftAgent] Analysis failed: ${error.message}`);
            return null;
        }
    }

    /**
     * Get conversation summary
     */
    getConversationSummary() {
        const shifts = this.conversationHistory.filter(msg => msg.shift);
        return {
            totalMessages: this.conversationHistory.length,
            totalShifts: shifts.length,
            conversationFlow: this.conversationHistory.map(msg => ({
                turn: msg.turn,
                hasShift: !!msg.shift,
                shiftType: msg.shift?.type || null
            }))
        };
    }

    /**
     * Reset for new conversation
     */
    reset() {
        this.conversationHistory = [];
    }
}
