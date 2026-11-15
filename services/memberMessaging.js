/**
 * @fileoverview services/memberMessaging.js
 * Passing a message on to other members of a circle (mediation, advice, fact reports,
 * shared content).
 *
 * In a local circle each member's agent delivers it now. In a HealthyMitra circle it is
 * proposed instead: the user sees the exact text and recipients on a card, and HealthyMitra
 * sends it as the user's own chat message, marked AI-assisted, once they accept. Proposals
 * here are decided on the card only, so a "yes" in chat stays an answer to an emergency alert.
 */
import { randomUUID } from 'crypto';
import { events } from '../orchestrator.js';
import { getAgentName } from '../handlers/utils/agentIdentity.js';
import { joinNames } from '../utils/actionClaimGuard.js';
import { isHealthyMitraCircle } from '../lib/deliveryMode.js';
import { createAction } from './integrationActions.js';
import { partitionRecipients } from './sharingPolicy.js';

// A message nobody accepted for a day is stale
export const MEMBER_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Propose a message from the user to members, for HealthyMitra to send once accepted.
 * @returns {Promise<object|null>} The proposal (shown with escalationService.toPublicProposal),
 *   or null when none of the members can be reached through HealthyMitra
 */
export async function proposeMemberMessage({ userId, circleId, members, message, ttlMs = MEMBER_MESSAGE_TTL_MS }) {
    const recipients = members.map(m => ({ userId: m.user_id, username: m.username, role: m.role }));
    const expiresAt = Date.now() + ttlMs;
    const actionId = `act_${randomUUID()}`;
    const action = await createAction({
        actionId,
        kind: 'send_member_message',
        ownerUserId: userId,
        circleId,
        recipients,
        content: {
            doctors: recipients.some(r => r.role === 'doctor') ? message : null,
            caregivers: recipients.some(r => r.role !== 'doctor') ? message : null
        },
        expiresAt
    });
    if (!action) return null;
    const reachable = new Set(action.payload.recipients.map(r => r.username));
    const fixed = recipients.filter(r => reachable.has(r.username));
    return {
        actionId,
        kind: 'send_member_message',
        type: 'MEMBER_MESSAGE',
        recipients: fixed,
        notifyDoctors: fixed.some(r => r.role === 'doctor'),
        notifyCaregivers: fixed.some(r => r.role !== 'doctor'),
        details: message,
        caregiverMessage: message,
        expiresAt,
        autoSendAt: null
    };
}

/**
 * Pass a message on to members: now in a local circle, as a proposal in a HealthyMitra one.
 * @param {object} params
 * @param {string} params.userId - The user it comes from
 * @param {string} params.circleId
 * @param {Array<{user_id: string, username: string, role: string}>} params.members - Recipients
 * @param {string} params.message - The exact text
 * @param {string|null} [params.patientUsername]
 * @returns {Promise<{actions: object, proposal: object|null, question: string|null, blocked: string[]}>}
 *   `actions` names who was messaged (utils/actionClaimGuard.js); nobody when proposed.
 *   `blocked` names members left out because the user asked not to share with them.
 */
export async function shareWithMembers({ userId, circleId, members: requested, message, patientUsername = null }) {
    const { allowed: members, blocked: blockedMembers } = await partitionRecipients({
        circleId, ownerUserId: userId, members: requested, path: 'member_message'
    });
    const blocked = blockedMembers.map(m => m.username || m.user_id);
    if (members.length === 0) {
        return { actions: {}, proposal: null, question: null, blocked };
    }

    if (isHealthyMitraCircle(circleId)) {
        const proposal = await proposeMemberMessage({ userId, circleId, members, message });
        const question = proposal
            ? `I've drafted a message for ${joinNames(proposal.recipients.map(r => r.username))}. Accept it on the card to send it from you, or reject it.`
            : null;
        return { actions: {}, proposal, question, blocked };
    }

    for (const member of members) {
        // The recipient's own agent delivers it
        events.emit('broadcast', {
            targetUsers: [member.user_id],
            message,
            from: await getAgentName(member.user_id, circleId),
            circleId,
            patientUsername
        });
    }
    return { actions: { membersMessaged: members.map(m => m.username) }, proposal: null, question: null, blocked };
}
