import chalk from 'chalk';
import {
    addUser,
    addMessage,
    upsertFact,
    getLastFact,
    addEscalation,
    setUserConsent,
    addPendingAction,
    getPendingAction,
    removePendingAction,
    addImpliedConsent,
    getImpliedConsent,
    clearDatabase
} from './database.js';
import {
    processUserMessage,
    generateSharingRequest,
    generateSharingSummaryOrProbe,
    generateMediatedClarification,
} from './agents.js';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

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
        // In a real app, you'd have auth here. For now, any user can clear.
        events.emit('clear_db');
        return { reply: `[System] Database cleared.` };
    }
    return { reply: `[System] Unknown command: ${command}` };
}

async function handlePendingAction(userId, message) {
    const pendingAction = await getPendingAction(userId);
    if (!pendingAction) return null;

    const positiveResponse = ['yes', 'yep', 'ok', 'okay', 'proceed', 'grant', 'granted', 'sure', 'do it'].includes(message.toLowerCase());
    await removePendingAction(pendingAction.action_id);

    if (positiveResponse) {
        if (pendingAction.action_type === 'share_consent') {
            const { originatingUser, target, originalMessage } = pendingAction.details;
            
            // Create an implied consent for the specific fact topic
            const topic = Object.keys(originalMessage.facts)[0] || 'general';
            await addImpliedConsent(originatingUser, topic);
            
            // Generate and send the contextual message
            const contextualMessage = await generateSharingSummaryOrProbe(originatingUser, target, originalMessage.message);
            events.emit('broadcast', {
                targetUsers: [target],
                message: contextualMessage,
                from: 'personal-agent'
            });
            return { reply: "[Personal Note] Thank you. I've shared that with them." };
        }
    } else {
        return { reply: "[Personal Note] Understood. I will not share it." };
    }
    return null;
}

export async function handleMessage(userId, role, message) {
    if (message.startsWith('/')) {
        const response = await handleCommand(userId, message);
        events.emit('broadcast', { targetUsers: [userId], reply: response.reply, from: 'system' });
        return;
    }

    const pendingActionResponse = await handlePendingAction(userId, message);
    if (pendingActionResponse) {
        events.emit('broadcast', { targetUsers: [userId], reply: pendingActionResponse.reply, from: 'personal-agent' });
        return;
    }
    
    console.log(`[Orchestrator] Received message from '${userId}': '${message}'`);
    const analysis = await processUserMessage(userId, role, message);
    console.log(`[Orchestrator] Unified analysis complete:`, analysis);

    await addMessage(userId, role, message, analysis.privacyLevel, analysis.criticality);
    events.emit('broadcast', { targetUsers: [userId], reply: analysis.reply, from: 'personal-agent' });

    // Handle facts and conflicts
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

    // Handle Criticality & Sharing
    if (analysis.criticality === 'HIGH') {
        const criticalDetails = `User '${userId}' reported: "${message}"`;
        await addEscalation('CRITICAL', criticalDetails);
        events.emit('escalate');
    }

    // Handle sharing based on consent, privacy, and suggestions
    if (analysis.privacyLevel === 'PUBLIC') {
        const contextualMessage = await generateSharingSummaryOrProbe(userId, 'all', message);
        events.emit('broadcast', {
            targetUsers: USER_ROLES.filter(r => r !== userId && r !== 'doctor'),
            message: contextualMessage,
            from: 'personal-agent'
        });
    } else if (analysis.sharingSuggestion && analysis.sharingSuggestion.target) {
        const topic = Object.keys(analysis.facts)[0] || 'general';
        const implied = await getImpliedConsent(userId, topic);

        if (implied) {
            console.log(`[Orchestrator] Implied consent found for topic '${topic}'. Sharing automatically.`);
            const contextualMessage = await generateSharingSummaryOrProbe(userId, analysis.sharingSuggestion.target, message);
            events.emit('broadcast', {
                targetUsers: [analysis.sharingSuggestion.target],
                message: contextualMessage,
                from: 'personal-agent'
            });
        } else {
             const actionId = randomUUID();
             const request = await generateSharingRequest(analysis.sharingSuggestion.target, analysis.sharingSuggestion.reason);
             await addPendingAction(actionId, userId, 'share_consent', {
                 originatingUser: userId,
                 target: analysis.sharingSuggestion.target,
                 reason: analysis.sharingSuggestion.reason,
                 originalMessage: { message, facts: analysis.facts || {} }
             });
             events.emit('broadcast', { targetUsers: [userId], reply: request, from: 'personal-agent' });
        }
    }
}

