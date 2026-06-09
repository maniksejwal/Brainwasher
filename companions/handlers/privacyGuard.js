/**
 * @fileoverview Privacy Guard — stateless LLM content classifier
 *
 * Classifies message content as PUBLIC | PRIVATE | SENSITIVE.
 * This module is intentionally stateless: it makes no DB calls.
 * All circle context (member list, recent history) must be pre-fetched
 * by the caller (CompanionCoordinator) and passed in.
 *
 * Consent gating (DB-backed, stateful) is handled by a separate module:
 *   companions/handlers/consentManager.js
 *     Input:  sharingSuggestion, userId, circleId, inputUnderstanding,
 *             members, resolvedUsers
 *     Output: { allowed, requiresExplicit, impliedTopics }
 *
 * Call sequence in CompanionCoordinator:
 *   1. const privacy = await processPrivacyDecision(...)   — LLM classifier
 *   2. const consent = await evaluateConsent(...)          — DB consent gate
 *
 * Privacy taxonomy (content-level, LLM output):
 *   PUBLIC    — safe to share with circle without restriction
 *   PRIVATE   — sharing requires consent check
 *   SENSITIVE — never share regardless of consent
 *
 * Consent taxonomy (relationship-level, DB):
 *   none / limited / full  →  see consentManager.js
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';
import { getCircleMembers, findCircleByPatientId, findCircleById } from '../../db/index.js';
import {
    evaluateConsent,
    buildFallbackSuggestion,
} from './consentManager.js';

/**
 * Classify message privacy level and gate any sharing suggestion through
 * the consent manager.
 *
 * @param {string} userId
 * @param {string} role
 * @param {string} message
 * @param {string} circleId
 * @param {object} context   — { inputUnderstanding, members, history }
 * @returns {Promise<{
 *   level: string,
 *   reasoning: string,
 *   sharingSuggestion: object|null,
 *   consentCheck: { required: boolean, target: string|null }
 * }>}
 */
export async function processPrivacyDecision(userId, role, message, circleId, context) {
    const inputUnderstanding = context.inputUnderstanding || {};
    const resolvedUsers      = inputUnderstanding.resolvedUsers || [];

    // Pre-fetch circle members for prompt context and consent gating.
    // The privacy classifier needs the member list to make informed sharing
    // suggestions; the consent manager reuses the same pre-fetched list.
    const members = context.members || await getCircleMembers(circleId);
    const circle  = await findCircleByPatientId(circleId);

    const patientId = circle?.primary_patient_id || null;
    const memberListText = members.length > 0
        ? members.map(m => {
            const isPatient = m.user_id === patientId ? ' [patient]' : '';
            const isSpeaker = m.user_id === userId    ? ' [speaking]' : '';
            const consent   = m.consent_level ? ` consent:${m.consent_level}` : '';
            return `${m.username} (${m.role || 'member'}${isPatient}${isSpeaker}${consent})`;
          }).join(', ')
        : 'none';

    const recentHistory = (context.history || []).slice(-3)
        .map(h => `${h.user_id}: ${(h.message || '').substring(0, 120)}`)
        .join('\n') || 'No recent history';

    // Select prompt variant (healthcare vs professional/business circle)
    let promptType = 'privacy_guard';
    try {
        const circleRecord = await findCircleById(circleId);
        if (circleRecord?.circle_type === 'professional') {
            promptType = 'business_privacy_guard';
        }
    } catch {
        // Non-fatal: fall back to healthcare prompt
    }

    const prompt = loadPrompt(promptType, {
        MESSAGE:              message,
        USER_ROLE:            role,
        CIRCLE_MEMBERS:       memberListText,
        CONVERSATION_CONTEXT: recentHistory,
    });

    // ── LLM classification call ───────────────────────────────────────────────
    let privacyLevel  = 'PRIVATE';
    let llmSuggestion = null;
    let reasoning     = '';

    try {
        const result   = await makeApiCall(prompt, [], true);
        const analysis = parseCompanionResponse(result);
        if (analysis) {
            privacyLevel  = analysis.privacyLevel  || 'PRIVATE';
            llmSuggestion = analysis.sharingSuggestion || null;
            reasoning     = analysis.reasoning || '';
        }
    } catch (error) {
        console.error('[PrivacyGuard] LLM call failed, defaulting to PRIVATE:', error.message);
        // Safe default: PRIVATE. Never default to PUBLIC or SENSITIVE on failure.
    }

    // ── Consent gate via consentManager.js ───────────────────────────────────
    // SENSITIVE content: never share regardless of consent.
    let sharingSuggestion = null;
    const intent = inputUnderstanding.intent || '';

    if (privacyLevel !== 'SENSITIVE') {
        if (llmSuggestion?.target) {
            // Path 1: LLM proposed a sharing target — evaluate consent
            if (llmSuggestion.target === 'doctor') {
                // Doctor is a pre-authorised professional role — no gate needed
                sharingSuggestion = llmSuggestion;
            } else {
                sharingSuggestion = await evaluateConsent(
                    llmSuggestion, userId, circleId,
                    inputUnderstanding, members, resolvedUsers
                );
            }
        } else if (intent === 'REPORTING_FACT') {
            // Path 2: No LLM suggestion but structured facts mention a third party
            sharingSuggestion = await buildFallbackSuggestion(
                inputUnderstanding, members, resolvedUsers, userId, circleId
            );
        }
    }

    return {
        level:     privacyLevel,
        reasoning,
        sharingSuggestion,
        consentCheck: {
            required: sharingSuggestion?.requiresConsent || false,
            target:   sharingSuggestion?.target || null,
        },
    };
}
