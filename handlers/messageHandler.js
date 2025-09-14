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
    findUserByUsername
} from '../db/index.js';
import {
    processUserMessage,
    generateSharingRequest,
    generateSharingSummaryOrProbe,
    generateMediatedClarification,
} from '../agents.js';
import { createSharingConsentAction, handleUserResponseToAction } from '../state_manager.js';
import { events } from '../orchestrator.js';

// FIX: Ensure this function is exported as a named export
export async function handleMessage(userId, circleId, message) {
    const memberInfo = await getMemberInfo(userId, circleId);
    if (!memberInfo) {
        console.error(`[MessageHandler] ERROR: User ${userId} is not a member of circle ${circleId}.`);
        return;
    }

    const role = memberInfo.role;
    
    // 1. Check for and handle pending actions first
    const actionResult = await handleUserResponseToAction(userId, circleId, message);
    if (actionResult) {
        if (actionResult.action === 'execute') {
            const { target, content_to_share, originatingUser } = actionResult.details;
            const targetMemberInfo = await findUserByUsername(target) || {user_id: target};
            
            if (target === 'doctor') {
                await addEscalation(circleId, 'INFO', `User '${originatingUser}' consented to share: "${content_to_share}"`);
                events.emit('escalate', { circleId });
            } else {
                const contextualMessage = await generateSharingSummaryOrProbe(originatingUser, target, content_to_share);
                events.emit('broadcast', { targetUsers: [targetMemberInfo.user_id], message: contextualMessage, from: 'personal-agent', circleId });
            }
        }
        events.emit('broadcast', { targetUsers: [userId], reply: actionResult.reply, from: 'personal-agent', circleId });
        return;
    }
    
    // 2. Regular message processing
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

    // 3. Handle facts and conflicts
    if (analysis.facts && Object.keys(analysis.facts).length > 0) {
        for (const [key, value] of Object.entries(analysis.facts)) {
            const lastFact = await getLastFact(circleId, key);
            await upsertFact(circleId, key, userId, value);

            if (lastFact && lastFact.reported_by !== userId && String(lastFact.value) !== String(value)) {
                console.log(chalk.yellow.bold(`[MessageHandler] CONFLICT DETECTED in circle ${circleId} on '${key}'`));
                const conflictDetails = `User '${userId}' reported '${key}' as '${value}', contradicting another member.`;
                await addEscalation(circleId, 'CONFLICT', conflictDetails);
                events.emit('escalate', { circleId });
                
                const otherMemberInfo = await getMemberInfo(lastFact.reported_by, circleId);
                if (otherMemberInfo) {
                    const otherUser = await findUserByUsername(otherMemberInfo.username); // find by username
                    const clarificationQuestion = await generateMediatedClarification(otherUser.username, key);
                    events.emit('broadcast', { targetUsers: [otherMemberInfo.user_id], message: clarificationQuestion, from: 'personal-agent', circleId });
                }
            }
        }
    }

    // 4. Handle Criticality & Sharing
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
            console.log(`[MessageHandler] AI suggested sharing with role '${targetRole}' in circle ${circleId}, but no such member found.`);
            return;
        }

        const topic = Object.keys(analysis.facts)[0] || 'general';
        const implied = await getImpliedConsent(userId, circleId, topic);

        if (implied || targetMember.consent_level === 'full') {
            console.log(`[MessageHandler] Sharing with ${targetMember.username} based on implied or full consent.`);
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

