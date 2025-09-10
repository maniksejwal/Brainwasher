import chalk from 'chalk';
import {
    addUser,
    addMessage,
    upsertFact,
    getLastFact,
    addEscalation,
    setUserConsent,
    addImpliedConsent,
    getImpliedConsent,
    clearDatabase,
    updateUserState,
} from './database.js';
import {
    processUserMessage,
    generateSharingRequest,
    generateSharingSummaryOrProbe,
    generateMediatedClarification,
} from './agents.js';
import { EventEmitter } from 'events';
// Import the new state manager
import { createSharingConsentAction, handleUserResponseToAction } from './state_manager.js';

export const events = new EventEmitter();
events.on('clear_db', clearDatabase);


const USER_ROLES = ['patient', 'caregiver', 'doctor'];

export async function handleNewUser(userId, role) {
    if (!USER_ROLES.includes(role)) {
        return { error: 'Invalid role specified.' };
    }
    await addUser(userId, role);
    console.log(`[Orchestrator] User added/confirmed: ${userId} (${role})`);
    return { success: true, message: `Welcome, ${userId}. You are the ${role}.` };
}

async function handleCommand(userId, message) {
    const parts = message.toLowerCase().split(' ');
    const command = parts[0].substring(1);

    if (command === 'consent') {
        const [, targetUser, level, relationship] = parts;
        if (!targetUser || !level || !relationship) {
            return { reply: "[System] Invalid command. Use: /consent <targetUser> <level> <relationship>" };
        }
        if (!['none', 'limited', 'full'].includes(level)) {
            return { reply: "[System] Invalid level. Use: none, limited, or full." };
        }
        await setUserConsent(userId, targetUser, level, relationship);
        console.log(`[Orchestrator] Consent set by ${userId} for ${targetUser} to ${level} with relationship ${relationship}`);
        return { reply: `[System] Consent for '${targetUser}' set to '${level}' as your '${relationship}'.` };
    }
     if (command === 'clear') {
        events.emit('clear_db');
        return { reply: `[System] Database cleared.` };
    }
    return { reply: `[System] Unknown command: ${command}` };
}

async function handleExplicitConsent(userId, message) {
    const lowerCaseMessage = message.toLowerCase();
    const shareKeywords = ['share', 'tell', 'update', 'send', 'doc'];
    
    if (shareKeywords.some(kw => lowerCaseMessage.includes(kw))) {
        const targets = [];
        if (lowerCaseMessage.includes('doctor') || lowerCaseMessage.includes('doc')) targets.push('doctor');
        if (lowerCaseMessage.includes('caregiver') || lowerCaseMessage.includes('spouse')) targets.push('caregiver');
        if (lowerCaseMessage.includes('patient')) targets.push('patient');

        if (targets.length > 0) {
            console.log(`[Orchestrator] Detected explicit consent from ${userId} to share with: ${targets.join(', ')}`);
            for (const target of targets) {
                if (target === 'doctor') {
                    await addEscalation('INFO', `User '${userId}' explicitly requested to share: "${message}"`);
                    events.emit('escalate');
                } else {
                    const contextualMessage = await generateSharingSummaryOrProbe(userId, target, message);
                    events.emit('broadcast', { targetUsers: [target], message: contextualMessage, from: 'personal-agent' });
                }
            }
            events.emit('broadcast', { targetUsers: [userId], reply: "[Personal Note] I've shared the update as you requested.", from: 'personal-agent' });
            return true;
        }
    }
    return false;
}


export async function handleMessage(userId, role, message) {
    if (message.startsWith('/')) {
        const response = await handleCommand(userId, message);
        events.emit('broadcast', { targetUsers: [userId], reply: response.reply, from: 'system' });
        return;
    }

    const wasHandledExplicitly = await handleExplicitConsent(userId, message);
    if (wasHandledExplicitly) {
        return;
    }

    const actionResult = await handleUserResponseToAction(userId, message);
    if (actionResult) {
        if (actionResult.action === 'execute') {
            const { target, content_to_share, originatingUser } = actionResult.details;
            if (target === 'doctor') {
                await addEscalation('INFO', `User '${originatingUser}' consented to share: "${content_to_share}"`);
                events.emit('escalate');
            } else {
                const contextualMessage = await generateSharingSummaryOrProbe(originatingUser, target, content_to_share);
                events.emit('broadcast', { targetUsers: [target], message: contextualMessage, from: 'personal-agent' });
            }
        }
        events.emit('broadcast', { targetUsers: [userId], reply: actionResult.reply, from: 'personal-agent' });
        return;
    }
    
    console.log(`[Orchestrator] Received message from '${userId}': '${message}'`);
    const analysis = await processUserMessage(userId, role, message, USER_ROLES);
    console.log(`[Orchestrator] Unified analysis complete:`, analysis);

    await addMessage(userId, role, message, analysis.privacyLevel, analysis.criticality);
    
    // ** FIX: Prioritize HIGH criticality above all else for safety **
    if (analysis.criticality === 'HIGH') {
        const criticalDetails = `User '${userId}' reported: "${message}"`;
        await addEscalation('CRITICAL', criticalDetails);
        events.emit('escalate');
        // Override the AI's conversational reply with an action-oriented confirmation.
        const confirmationReply = `This sounds serious. I have escalated this to the doctor immediately. ${analysis.reply}`;
        events.emit('broadcast', { targetUsers: [userId], reply: confirmationReply, from: 'personal-agent' });
        return; // Stop further processing to avoid asking for consent on an emergency.
    }
    
    // If not critical, proceed with the normal conversational flow
    events.emit('broadcast', { targetUsers: [userId], reply: analysis.reply, from: 'personal-agent' });
    
    if (analysis.state_update) {
        await updateUserState(userId, analysis.state_update);
        console.log(`[Orchestrator] State for '${userId}' updated:`, analysis.state_update);
    }

    if (analysis.facts && Object.keys(analysis.facts).length > 0) {
        for (const [key, value] of Object.entries(analysis.facts)) {
            const lastFact = await getLastFact(key);
            await upsertFact(key, userId, value);

            if (lastFact && lastFact.reported_by !== userId && String(lastFact.value) !== String(value)) {
                console.log(chalk.yellow.bold(`[Orchestrator] CONFLICT DETECTED on '${key}'`));
                const conflictDetails = `User '${userId}' reported '${key}' as '${value}', contradicting '${lastFact.reported_by}'.`;
                await addEscalation('CONFLICT', conflictDetails);
                events.emit('escalate');
                
                const targetUserForClarification = lastFact.reported_by;
                const clarificationQuestion = await generateMediatedClarification(targetUserForClarification, key);
                events.emit('broadcast', {
                    targetUsers: [targetUserForClarification],
                    message: clarificationQuestion,
                    from: 'personal-agent'
                });
            }
        }
    }

    if (analysis.privacyLevel === 'PUBLIC') {
        const contextualMessage = await generateSharingSummaryOrProbe(userId, 'all', message);
        events.emit('broadcast', {
            targetUsers: USER_ROLES.filter(r => r !== userId && r !== 'doctor'),
            message: contextualMessage,
            from: 'personal-agent'
        });
    } else if (analysis.sharingSuggestion && analysis.sharingSuggestion.target && analysis.sharingSuggestion.content_to_share) {
        const target = analysis.sharingSuggestion.target;
        if (!USER_ROLES.includes(target)) {
            console.log(`[Orchestrator] AI suggested sharing with invalid target '${target}'. Ignoring.`);
            return;
        }

        const topic = Object.keys(analysis.facts)[0] || 'general';
        const implied = await getImpliedConsent(userId, topic);

        if (implied) {
            console.log(`[Orchestrator] Implied consent found for topic '${topic}'. Sharing automatically.`);
            const contextualMessage = await generateSharingSummaryOrProbe(userId, target, analysis.sharingSuggestion.content_to_share);
            events.emit('broadcast', {
                targetUsers: [target],
                message: contextualMessage,
                from: 'personal-agent'
            });
        } else {
             const suggestion = {
                 originatingUser: userId,
                 target: target,
                 reason: analysis.sharingSuggestion.reason,
                 content_to_share: analysis.sharingSuggestion.content_to_share,
             };
             await createSharingConsentAction(userId, suggestion);
             const request = await generateSharingRequest(target, analysis.sharingSuggestion.reason, analysis.sharingSuggestion.content_to_share);
             events.emit('broadcast', { targetUsers: [userId], reply: request, from: 'personal-agent' });
        }
    }
}

