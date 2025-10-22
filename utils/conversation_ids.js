/**
 * @fileoverview Conversation ID Management
 * Simple but complete approach for handling conversation IDs across care circles
 */

/**
 * Generate a care circle ID
 * @param {string} scenario - The scenario name
 * @returns {string} Care circle ID
 */
export function generateCareCircleId(scenario) {
    const timestamp = Date.now();
    return `circle_${timestamp}_${scenario}`;
}

/**
 * Generate a conversation ID for a specific user within a care circle
 * @param {string} userId - The user ID
 * @param {string} careCircleId - The care circle ID
 * @returns {string} Conversation ID
 */
export function generateConversationId(userId, careCircleId) {
    return `conv_${userId}_${careCircleId}`;
}

/**
 * Generate a session ID for multi-session conversations
 * @param {string} conversationId - The conversation ID
 * @param {number} sessionNumber - The session number (optional)
 * @returns {string} Session ID
 */
export function generateSessionId(conversationId, sessionNumber = null) {
    const timestamp = Date.now();
    const session = sessionNumber ? `_session${sessionNumber}` : '';
    return `session_${conversationId}${session}_${timestamp}`;
}

/**
 * Parse a conversation ID to extract components
 * @param {string} conversationId - The conversation ID to parse
 * @returns {object} Parsed components
 */
export function parseConversationId(conversationId) {
    const parts = conversationId.split('_');
    
    if (parts[0] === 'conv' && parts.length >= 4) {
        return {
            type: 'conversation',
            userId: parts[1],
            careCircleId: parts.slice(2).join('_'),
            scenario: parts[parts.length - 1] // Last part is usually scenario
        };
    }
    
    if (parts[0] === 'circle' && parts.length >= 3) {
        return {
            type: 'care_circle',
            timestamp: parts[1],
            scenario: parts.slice(2).join('_')
        };
    }
    
    if (parts[0] === 'session' && parts.length >= 5) {
        return {
            type: 'session',
            conversationId: parts.slice(1, -1).join('_'), // Everything except first and last
            timestamp: parts[parts.length - 1]
        };
    }
    
    return {
        type: 'unknown',
        original: conversationId
    };
}

/**
 * Get all conversation IDs for a care circle
 * @param {string} careCircleId - The care circle ID
 * @param {Array<string>} userIds - Array of user IDs in the circle
 * @returns {Array<string>} Array of conversation IDs
 */
export function getConversationIdsForCircle(careCircleId, userIds) {
    return userIds.map(userId => generateConversationId(userId, careCircleId));
}

/**
 * Extract care circle ID from conversation ID
 * @param {string} conversationId - The conversation ID
 * @returns {string|null} Care circle ID or null if not found
 */
export function extractCareCircleId(conversationId) {
    const parsed = parseConversationId(conversationId);
    return parsed.careCircleId || null;
}

/**
 * Check if two conversation IDs belong to the same care circle
 * @param {string} conversationId1 - First conversation ID
 * @param {string} conversationId2 - Second conversation ID
 * @returns {boolean} True if they belong to the same care circle
 */
export function areInSameCareCircle(conversationId1, conversationId2) {
    const circle1 = extractCareCircleId(conversationId1);
    const circle2 = extractCareCircleId(conversationId2);
    return circle1 && circle2 && circle1 === circle2;
}
