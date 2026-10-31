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
 * @returns {Promise<object|null>} Sharing result: { action, escalated, details, actions },
 *   where `actions` is the action record checked by utils/actionClaimGuard.js.
 *   Null when no handler acted.
 */
export async function handleSharingAndEscalation(userId, role, message, circleId, analysis) {
    // 1. Handle HIGH criticality events first. This is a safety override.
    const criticalResult = await handleCriticalEvent(userId, role, message, circleId, analysis);
    if (criticalResult) {
        return criticalResult;
    }

    // 2. Handle REPORTING_FACT about another person in the care circle.
    const wasFactReportHandled = await handleFactReporting(userId, circleId, analysis);
    if (wasFactReportHandled) {
        return { action: 'FACT_REPORT', actions: {} };
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
    const wasAdviceHandled = await handleAdviceSharing(userId, circleId, analysis);
    if (wasAdviceHandled) {
        return { action: 'ADVICE_SHARING', actions: {} };
    }

    // 6. Fall back to the standard proactive sharing suggestion flow.
    const wasFallbackHandled = await handleFallbackSharing(userId, circleId, analysis);
    return wasFallbackHandled ? { action: 'SHARING_SUGGESTION', actions: {} } : null;
}
