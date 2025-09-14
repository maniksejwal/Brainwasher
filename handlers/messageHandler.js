/**
 * @fileoverview Handles all regular user messages (non-commands).
 * This is the core logic for AI analysis, conflict detection, consent checks,
 * and broadcasting replies and updates.
 */

import chalk from 'chalk';
import {
    addMessage,
    updateUserState,
    upsertFact,
    getLastFact,
    addEscalation,
    getImpliedConsent,
    addImpliedConsent,
    getMemberInfo,
    getCircleMembers,
    findUserByUsername,
    findUserById
} from '../db/index.js';
import {
    processUserMessage,
    generateSharingRequest,
    generateSharingSummaryOrProbe,
    generateMediatedClarification,
} from '../agents/index.js';
import { createSharingConsentAction, handleUserResponseToAction } from '../state_manager.js';
import { events } from '../orchestrator.js';

export async function handleMessage(userId, circleId, message) {
    const memberInfo = await getMemberInfo(userId, circleId);
    if (!memberInfo) {
        console.error(`[MessageHandler] ERROR: User ${userId} is not a member of circle ${circleId}.`);
        return;
    }

    const role = memberInfo.role;

    const actionResult = await handleUserResponseToAction(userId, circleId, message);
    if (actionResult) {
        if (actionResult.action === 'execute') {
            const { target, content_to_share, originatingUser } = actionResult.details;
            
            if (target === 'doctor') {
                await addEscalation(circleId, 'INFO', `User with ID '${originatingUser}' consented to share: "${content_to_share}"`);
                events.emit('escalate', { circleId });
            } else {
                const targetUserInfo = await findUserByUsername(target);
                if (targetUserInfo) {
                    const contextualMessage = await generateSharingSummaryOrProbe(originatingUser, target, content_to_share);
                    events.emit('broadcast', { targetUsers: [targetUserInfo.user_id], message: contextualMessage, from: 'personal-agent', circleId });
                }
            }
        }
        events.emit('broadcast', { targetUsers: [userId], reply: actionResult.reply, from: 'personal-agent', circleId });
        return;
    }

    console.log(`[MessageHandler] Processing message from '${userId}' in circle '${circleId}'`);

    const members = await getCircleMembers(circleId);
    const memberRoles = members.map(m => m.role);

    const analysis = await processUserMessage(userId, role, message, memberRoles, circleId);
    console.log(`[MessageHandler] Unified analysis complete for circle ${circleId}:`, analysis);

    await addMessage(circleId, userId, role, message, analysis.privacyLevel, analysis.criticality);
    events.emit('broadcast', { targetUsers: [userId], reply: analysis.reply, from: 'personal-agent', circleId });

    if (analysis.state_update) {
        await updateUserState(userId, circleId, analysis.state_update);
        console.log(`[MessageHandler] State for '${userId}' in circle '${circleId}' updated:`, analysis.state_update);
    }

    if (analysis.facts && Object.keys(analysis.facts).length > 0) {
        for (const [key, value] of Object.entries(analysis.facts)) {
            const lastFact = await getLastFact(circleId, key);
            await upsertFact(circleId, key, userId, value);

            if (lastFact && lastFact.reported_by !== userId && String(lastFact.value) !== String(value)) {
                console.log(chalk.yellow.bold(`[MessageHandler] CONFLICT DETECTED in circle ${circleId} on '${key}'`));
                const conflictDetails = `Reports on '${key}' are conflicting.`;
                await addEscalation(circleId, 'CONFLICT', conflictDetails);
                events.emit('escalate', { circleId });

                const otherMember = await getMemberInfo(lastFact.reported_by, circleId);
                if (otherMember) {
                    const otherUser = await findUserById(otherMember.user_id);
                    const clarificationQuestion = await generateMediatedClarification(otherUser.username, key);
                    events.emit('broadcast', { targetUsers: [otherMember.user_id], message: clarificationQuestion, from: 'personal-agent', circleId });
                }
            }
        }
    }

    if (analysis.criticality === 'HIGH') {
        const criticalDetails = `User '${userId}' (${role}) reported: "${message}"`;
        await addEscalation(circleId, 'CRITICAL', criticalDetails);
        events.emit('escalate', { circleId });
        const confirmationReply = `This sounds serious. I have escalated this to the doctor immediately. ${analysis.reply}`;
        events.emit('broadcast', { targetUsers: [userId], reply: confirmationReply, from: 'personal-agent', circleId });
        return;
    }

    if (analysis.sharingSuggestion && analysis.sharingSuggestion.target && analysis.sharingSuggestion.content_to_share) {
        const targetRole = analysis.sharingSuggestion.target;
        const targetMember = members.find(m => m.role === targetRole && m.user_id !== userId);

        if (!targetMember) {
            console.log(`[MessageHandler] AI suggested sharing with role '${targetRole}' but no such member found.`);
            return;
        }

        const topic = Object.keys(analysis.facts)[0] || 'general';
        const implied = await getImpliedConsent(userId, circleId, topic);

        if (implied || targetMember.consent_level === 'full') {
            console.log(`[MessageHandler] Sharing with ${targetMember.username} based on consent.`);
            const contextualMessage = await generateSharingSummaryOrProbe(userId, targetMember.username, analysis.sharingSuggestion.content_to_share);
            events.emit('broadcast', { targetUsers: [targetMember.user_id], message: contextualMessage, from: 'personal-agent', circleId });
        } else {
            const suggestion = { originatingUser: userId, target: targetMember.username, ...analysis.sharingSuggestion };
            await createSharingConsentAction(userId, circleId, suggestion);
            const request = await generateSharingRequest(targetRole, analysis.sharingSuggestion.reason, analysis.sharingSuggestion.content_to_share);
            events.emit('broadcast', { targetUsers: [userId], reply: request, from: 'personal-agent', circleId });
        }
    }
}

