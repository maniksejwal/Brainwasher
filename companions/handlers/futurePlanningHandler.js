/**
 * @fileoverview Future Planning Handler for Companion System
 * Processes future_plan objects and creates scheduled tasks/messages
 * 
 * NOTE: This is a wrapper around the main futurePlanningHandler to maintain consistency
 */

import { handleFuturePlanning as handleMainFuturePlanning } from '../../handlers/message_logic/futurePlanningHandler.js';

/**
 * Handle future planning from Companion system
 * Companion system should return future_plan in its response format
 * This handler ensures future plans are processed the same way as unified agent
 * 
 * @param {string} userId - User ID
 * @param {string} circleId - Circle ID
 * @param {object} companionResult - Companion response object (may contain future_plan)
 * @param {number} currentTurn - Current conversation turn number
 */
export async function handleCompanionFuturePlanning(userId, circleId, companionResult, currentTurn) {
    // If Companion result has future_plan, process it
    if (companionResult.future_plan) {
        // Convert to analysis-like format for main handler
        const analysisFormat = {
            future_plan: companionResult.future_plan
        };
        
        // Reuse main future planning handler
        await handleMainFuturePlanning(userId, circleId, analysisFormat, currentTurn);
    }
}

