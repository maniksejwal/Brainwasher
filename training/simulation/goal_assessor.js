/**
 * @fileoverview Goal Assessor - Evaluates progress toward care circle goals
 */

import { SCORING_THRESHOLDS, GOAL_SCORES, ADHERENCE_KEYWORDS, HISTORY_KEYWORDS, QUALITY_POSITIVE_KEYWORDS, QUALITY_NEGATIVE_KEYWORDS } from './scoring_constants.js';

export class GoalAssessor {
    /**
     * Assess adherence goal progress
     */
    assessAdherenceGoal(userMessage, agentResponse) {
        const messageLower = userMessage.toLowerCase();
        const responseLower = agentResponse.toLowerCase();
        
        const adherenceCount = ADHERENCE_KEYWORDS.filter(keyword => 
            messageLower.includes(keyword) || responseLower.includes(keyword)
        ).length;
        
        if (adherenceCount >= SCORING_THRESHOLDS.ADHERENCE_COUNT_HIGH) {
            return GOAL_SCORES.ADHERENCE_HIGH;
        }
        if (adherenceCount >= SCORING_THRESHOLDS.ADHERENCE_COUNT_MEDIUM) {
            return GOAL_SCORES.ADHERENCE_MEDIUM;
        }
        if (adherenceCount >= SCORING_THRESHOLDS.ADHERENCE_COUNT_LOW) {
            return GOAL_SCORES.ADHERENCE_LOW;
        }
        
        return GOAL_SCORES.ADHERENCE_NEUTRAL;
    }

    /**
     * Assess history collection goal progress
     */
    assessHistoryGoal(userMessage, agentResponse, conversationHistory = []) {
        const messageLower = userMessage.toLowerCase();
        const responseLower = agentResponse.toLowerCase();
        
        const historyCount = HISTORY_KEYWORDS.filter(keyword => 
            messageLower.includes(keyword) || responseLower.includes(keyword)
        ).length;
        
        const contextBonus = conversationHistory.length > 0 ? 
            SCORING_THRESHOLDS.HISTORY_BONUS_THRESHOLD : 0;
        
        const baseScore = Math.min(
            GOAL_SCORES.HISTORY_BASE_MAX, 
            historyCount * SCORING_THRESHOLDS.HISTORY_BASE_MULTIPLIER + SCORING_THRESHOLDS.HISTORY_BASE_SCORE
        );
        
        return Math.min(GOAL_SCORES.HISTORY_MAX, baseScore + contextBonus);
    }

    /**
     * Assess conversation quality goal progress
     */
    assessConversationGoal(userMessage, agentResponse) {
        const messageLower = userMessage.toLowerCase();
        const responseLower = agentResponse.toLowerCase();
        
        const positiveCount = QUALITY_POSITIVE_KEYWORDS.filter(keyword => 
            messageLower.includes(keyword) || responseLower.includes(keyword)
        ).length;
        
        const negativeCount = QUALITY_NEGATIVE_KEYWORDS.filter(keyword => 
            messageLower.includes(keyword) || responseLower.includes(keyword)
        ).length;
        
        const baseScore = (positiveCount * SCORING_THRESHOLDS.CONVERSATION_POSITIVE_MULTIPLIER) - 
                         (negativeCount * SCORING_THRESHOLDS.CONVERSATION_NEGATIVE_MULTIPLIER) + 
                         SCORING_THRESHOLDS.CONVERSATION_BASE_SCORE;
        
        return Math.max(GOAL_SCORES.CONVERSATION_MIN, Math.min(GOAL_SCORES.CONVERSATION_MAX, baseScore));
    }
}
