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
 * @returns {Promise<object|null>} Sharing result from whichever handler acted:
 *   { action, escalated, shared, details, actions, question }, where `actions` is the action
 *   record checked by utils/actionClaimGuard.js and `question` (optional) is asked at the
 *   end of the reply. Null when no handler acted.
 */
export async function handleSharingAndEscalation(userId, role, message, circleId, analysis) {
    // 1. Handle HIGH criticality events first. This is a safety override.
    const criticalResult = await handleCriticalEvent(userId, role, message, circleId, analysis);
    if (criticalResult) {
        return criticalResult;
    }

    // 2. Handle REPORTING_FACT about another person in the care circle.
    const factReportResult = await handleFactReporting(userId, circleId, analysis);
    if (factReportResult) {
        return factReportResult;
    }

    // 3. Handle the specific intent of REQUESTING_DOCTOR.
    const doctorRequestResult = await handleDoctorRequest(userId, circleId, analysis);
    if (doctorRequestResult) {
        return doctorRequestResult;
    }

    // 4. Handle the specific intent of REQUESTING_MEDIATION.
    const mediationResult = await handleMediationRequest(userId, circleId, analysis);
    if (mediationResult) {
        return mediationResult;
    }

    // 5. Handle the specific intent of GIVING_ADVICE_FOR_OTHER.
    const adviceResult = await handleAdviceSharing(userId, circleId, analysis);
    if (adviceResult) {
        return adviceResult;
    }

    // 6. Fall back to the standard proactive sharing suggestion flow.
    return (await handleFallbackSharing(userId, circleId, analysis)) || null;
}
