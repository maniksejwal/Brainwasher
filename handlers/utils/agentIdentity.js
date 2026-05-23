/**
 * @fileoverview handlers/utils/agentIdentity.js
 * Utility functions for determining agent identity and names based on user context.
 */

import { findCircleById } from '../../db/index.js';

/**
 * Determines the appropriate agent name based on user context
 * @param {string} userId - The user ID to determine agent name for
 * @param {string} circleId - The circle ID to check context against
 * @returns {Promise<string>} - Agent name based on circle type and user role
 */
export async function getAgentName(userId, circleId) {
    const currentCircle = await findCircleById(circleId);
    if (!currentCircle) {
        throw new Error(`Circle '${circleId}' not found while determining agent identity for ${userId}`);
    }
    
    // Professional circles use business-focused routing
    if (currentCircle.circle_type === 'professional') {
        // For professional circles, use PersonalAgent but context will be business-focused
        // The companion router will handle business context appropriately
        return 'PersonalAgent';
    }
    
    // Care circles use traditional medical agent logic
    return userId === currentCircle.primary_patient_id ? 'PersonalAgent' : 'CareAgent';
}

/**
 * Determines the appropriate agent name for a target user in a specific circle
 * @param {string} targetUserId - The target user ID to determine agent name for
 * @param {string} circleId - The circle ID to check context against
 * @returns {Promise<string>} - 'PersonalAgent' or 'CareAgent'
 */
export async function getTargetAgentName(targetUserId, circleId) {
    return getAgentName(targetUserId, circleId);
}
