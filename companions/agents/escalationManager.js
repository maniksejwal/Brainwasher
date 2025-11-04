/**
 * @fileoverview Escalation Manager Handler
 * Handles criticality assessment and escalation decisions
 */

/**
 * Process escalation analysis
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @param {string} message - User message
 * @param {string} circleId - Care circle ID
 * @param {object} context - Conversation context
 * @returns {Promise<object>} Escalation decision
 */
export async function processEscalation(userId, role, message, circleId, context) {
    // Use clinical agent's criticality assessment
    const clinicalCriticality = context.clinicalAssessment?.criticality || 'NONE';
    
    // Determine if escalation is required
    const required = ['HIGH', 'MEDIUM'].includes(clinicalCriticality);
    
    let sharingSuggestion = null;
    if (required && clinicalCriticality === 'HIGH') {
        sharingSuggestion = {
            target: 'doctor',
            reason: 'Critical medical symptoms require immediate doctor consultation',
            content_to_share: message.substring(0, 200)
        };
    }
    
    return {
        required,
        criticality: clinicalCriticality,
        sharingSuggestion
    };
}

