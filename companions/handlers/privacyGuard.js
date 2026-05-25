/**
 * @fileoverview Privacy Guard Agent — Independent LLM-based privacy classifier
 *
 * This is a SPECIALIST agent. It runs its own LLM call and does NOT read from
 * or trust the unified agent's privacyLevel. The unified agent is a generalist;
 * the privacy guard is the safety layer that catches its mistakes.
 *
 * Architecture:
 *   inputUnderstanding (unified LLM) ──→ intent, facts, mentions, sharingSuggestion
 *   privacyGuard       (this agent)  ──→ privacyLevel (authoritative), consent gate
 *
 * The privacy guard reads circle members and conversation context from the DB,
 * calls the LLM with the dedicated companion_privacy_guard.js prompt, then
 * applies a consent gate over the sharing suggestion.
 */

import { makeApiCall } from '../../agents/api_client.js';
import { parseCompanionResponse } from '../utils/jsonParser.js';
import { loadPrompt } from '../utils/promptLoader.js';
import { getCircleMembers, getImpliedConsent, findCircleByPatientId, findCircleById } from '../../db/index.js';

/**
 * Process privacy decision as an independent LLM agent.
 *
 * @param {string} userId
 * @param {string} role
 * @param {string} message
 * @param {string} circleId
 * @param {object} context
 * @returns {Promise<object>} { level, sharingSuggestion, consentCheck, reasoning }
 */
export async function processPrivacyDecision(userId, role, message, circleId, context) {
    const inputUnderstanding = context.inputUnderstanding || {};
    const resolvedUsers      = inputUnderstanding.resolvedUsers || [];

    // Gather circle members for prompt context and consent gating
    const members = context.members || await getCircleMembers(circleId);
    const circle  = await findCircleByPatientId(circleId);

    // Build a rich member list for the LLM. The privacy agent needs to know:
    //   - who the patient is (to avoid suggesting the patient share with themselves)
    //   - consent levels (so it can recommend sharing only where consent exists)
    //   - roles (for sharing appropriateness: caregiver vs doctor vs peer)
    // Without this, the LLM will make sharing suggestions with no knowledge of
    // actual consent state or which member is the primary patient.
    const patientId = circle?.primary_patient_id || null;
    const memberListText = members.length > 0
        ? members.map(m => {
            const isPatient  = m.user_id === patientId ? ' [patient]' : '';
            const isSpeaker  = m.user_id === userId    ? ' [speaking]' : '';
            const consent    = m.consent_level ? ` consent:${m.consent_level}` : '';
            return `${m.username} (${m.role || 'member'}${isPatient}${isSpeaker}${consent})`;
          }).join(', ')
        : 'none';

    // Recent conversation context for the privacy agent (last 3 turns)
    const recentHistory = (context.history || []).slice(-3)
        .map(h => `${h.user_id}: ${(h.message || '').substring(0, 120)}`)
        .join('\n') || 'No recent history';

    // Select prompt: business circles use a different classification schema
    let promptType = 'privacy_guard';
    try {
        const circleRecord = await findCircleById(circleId);
        if (circleRecord?.circle_type === 'professional') {
            promptType = 'business_privacy_guard';
        }
    } catch {
        // non-fatal: fall back to healthcare prompt
    }

    const prompt = loadPrompt(promptType, {
        MESSAGE:              message,
        USER_ROLE:            role,
        CIRCLE_MEMBERS:       memberListText,
        CONVERSATION_CONTEXT: recentHistory,
    });

    let privacyLevel = 'PRIVATE';
    let llmSuggestion = null;
    let reasoning = '';

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

    // Consent gate: verify the LLM's sharing suggestion against actual circle DB state.
    // SENSITIVE content: never share regardless of what the LLM suggested.
    //
    // Three paths:
    //   1. LLM produced a sharing suggestion → consent-gate it
    //   2. LLM produced no suggestion but intent=REPORTING_FACT and facts mention a circle
    //      member → structured fallback: propose sharing with that member, consent-gate it.
    //      This catches cases where the LLM omits a suggestion but structured data clearly
    //      shows a third party is involved (the LLM lacks the DB member list at inference).
    //   3. Neither → no sharing
    //
    // Implied consent bypasses explicit consent requests. The DB records topic-specific
    // implied consent so routine topics (medication, appointments) do not ask every time.
    let sharingSuggestion = null;

    const intent        = inputUnderstanding.intent || '';
    const facts         = inputUnderstanding.facts  || {};
    const mentionedUsernames = inputUnderstanding.mentionedUsernames || [];

    if (privacyLevel !== 'SENSITIVE') {
        const targetName = llmSuggestion?.target || null;

        if (targetName) {
            // Path 1: LLM proposed a target — consent-gate it
            if (targetName === 'doctor') {
                sharingSuggestion = llmSuggestion;
            } else {
                sharingSuggestion = await _consentGate(
                    targetName, llmSuggestion, members, resolvedUsers,
                    userId, circleId, facts, inputUnderstanding
                );
            }
        } else if (intent === 'REPORTING_FACT' && mentionedUsernames.length > 0) {
            // Path 2: Structured fallback for REPORTING_FACT with third-party facts.
            //
            // factsAboutOthers: entries where the fact value string mentions another
            // circle member by name. This identifies facts that are genuinely ABOUT
            // a third party, not just messages that happen to name them.
            // Example: facts = { sleep_issue: "b not sleeping well" }, mentions = ["b"]
            //   → sleep_issue is about "b" → propose sharing with b, consent-gate it.
            const factsAboutOthers = Object.entries(facts).filter(([, value]) => {
                if (typeof value !== 'string') return false;
                return mentionedUsernames.some(u =>
                    value.toLowerCase().includes(u.toLowerCase())
                );
            });

            if (factsAboutOthers.length > 0) {
                // Prefer resolved user (handles nicknames/IDs) over raw mention
                let targetUsername = mentionedUsernames[0];
                if (resolvedUsers.length > 0) {
                    targetUsername = resolvedUsers[0].matchedMember?.username || targetUsername;
                }
                const factKeys   = factsAboutOthers.map(([k]) => k).join(', ');
                const factValues = factsAboutOthers.map(([, v]) => v).join('; ');
                const synthetic  = {
                    target:          targetUsername,
                    reason:          `Facts reported about ${targetUsername}: ${factKeys}`,
                    content_to_share: factValues.substring(0, 300),
                };
                sharingSuggestion = await _consentGate(
                    targetUsername, synthetic, members, resolvedUsers,
                    userId, circleId, facts, inputUnderstanding
                );
            }
        }
    }

    return {
        level: privacyLevel,
        reasoning,
        sharingSuggestion,
        consentCheck: {
            required: sharingSuggestion?.requiresConsent || false,
            target:   sharingSuggestion?.target || null,
        },
    };
}

/**
 * Consent gate: resolve a target name to a circle member and check consent.
 *
 * Returns a sharingSuggestion with requiresConsent: true when consent is needed
 * but not yet granted. This triggers fallbackSharing.js to send an explicit
 * consent request message to the user via createSharingConsentAction().
 *
 * Implied consent (getImpliedConsent) allows routine topics to bypass the
 * explicit request. Topics are checked per-circle per-userId so frequently
 * consented topics (medication, appointments) do not ask every message.
 *
 * @private
 */
async function _consentGate(targetName, suggestion, members, resolvedUsers, userId, circleId, facts, inputUnderstanding) {
    let targetMember = resolvedUsers.length > 0
        ? resolvedUsers.find(r =>
            r.matchedMember?.username?.toLowerCase() === targetName.toLowerCase()
          )?.matchedMember
        : null;

    if (!targetMember) {
        targetMember = members.find(m =>
            m.username.toLowerCase() === targetName.toLowerCase()
        );
    }

    if (!targetMember) return null;

    const targetConsent = targetMember.consent_level || 'none';
    const topic         = Object.keys(facts)[0] || Object.keys(inputUnderstanding.facts || {})[0] || 'general';
    const implied       = await getImpliedConsent(userId, circleId, topic).catch(() => false);

    if (targetConsent === 'full' || implied) {
        return {
            target:           targetMember.username,
            reason:           suggestion.reason || `Share with ${targetMember.username}`,
            content_to_share: suggestion.content_to_share || '',
        };
    }

    // Consent not yet established for this topic/member — flag for explicit request.
    // fallbackSharing.js reads requiresConsent: true and calls createSharingConsentAction()
    // which broadcasts a permission question to the originating user.
    return {
        target:           targetMember.username,
        reason:           suggestion.reason || `Consent needed before sharing with ${targetMember.username}`,
        content_to_share: suggestion.content_to_share || '',
        requiresConsent:  true,
    };
}
