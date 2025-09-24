/**
 * @fileoverview handlers/message_logic/sharing/index.js
 * Main orchestrator for sharing and escalation logic.
 * This module coordinates all the specialized sharing handlers.
 */

import { handleCriticalEvent } from './criticalEvents.js';
import { handleFactReporting } from './factReporting.js';
import { handleDoctorRequest } from './doctorRequests.js';
import { handleMediationRequest } from './mediation.js';
import { handleAdviceSharing } from './adviceSharing.js';
import { handleFallbackSharing } from './fallbackSharing.js';

/**
 * Main function to handle sharing and escalation logic
 * @param {string} userId - The user ID
 * @param {string} role - The user's role
 * @param {string} message - The original message
 * @param {string} circleId - The circle ID
 * @param {object} analysis - The AI analysis result
 */
export async function handleSharingAndEscalation(userId, role, message, circleId, analysis) {
    // 1. Handle HIGH criticality events first. This is a safety override.
    const wasCriticalHandled = await handleCriticalEvent(userId, role, message, circleId, analysis);
    if (wasCriticalHandled) {
        return;
    }
    
    // 2. Handle REPORTING_FACT about another person in the care circle.
    const wasFactReportHandled = await handleFactReporting(userId, circleId, analysis);
    if (wasFactReportHandled) {
        return;
    }
    
    // 3. Handle the specific intent of REQUESTING_DOCTOR.
    const wasDoctorRequestHandled = await handleDoctorRequest(userId, circleId, analysis);
    if (wasDoctorRequestHandled) {
        return;
    }
    
    // 4. Handle the specific intent of REQUESTING_MEDIATION.
    const wasMediationHandled = await handleMediationRequest(userId, circleId, analysis);
    if (wasMediationHandled) {
        return;
    }
    
    // 5. Handle the specific intent of GIVING_ADVICE_FOR_OTHER.
    const wasAdviceHandled = await handleAdviceSharing(userId, circleId, analysis);
    if (wasAdviceHandled) {
        return;
    }

    // 6. Fall back to the standard proactive sharing suggestion flow.
    await handleFallbackSharing(userId, circleId, analysis);
}
