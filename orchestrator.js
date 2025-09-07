import { 
    addMessage as dbAddMessage, 
    upsertFact, getFact, 
    clearAllData, updateUserConsent, getConsentLevel, getUsers, addUser,
    getConversationHistory, updateRelationship,
    createPendingAction, getPendingAction, deletePendingAction
} from './database.js';
import { 
    processUserMessage, 
    generateMediatedClarification, 
    generateDoctorAgentReply, 
    generateDoctorDirective,
    analyzeRelationship,
    generateSharingRequest,
    generateContextualShare
} from './agents.js';
import chalk from 'chalk';

let clients = {};
let messageCounter = 0;

// ... (sendMessageToUser, addMessage are unchanged)
const sendMessageToUser = (userId, message, type = 'personal') => {
    if (clients[userId]) {
        clients[userId].res.write(`data: ${JSON.stringify({ type, message })}\n\n`);
    }
};

async function addMessage(userId, message, type = 'personal') {
    if (type !== 'system') {
        await dbAddMessage(userId, message);
    }
    sendMessageToUser(userId, message, type);
};


async function broadcastToCareCircle(originatingUser, message, privacyLevel) {
    if (privacyLevel !== 'PUBLIC') {
        return;
    }
    const allUsers = await getUsers();
    for (const targetUser of allUsers) {
        if (targetUser === originatingUser || targetUser === 'doctor') continue;
        const consentLevel = await getConsentLevel(originatingUser, targetUser);
        if (consentLevel === 'full') {
            const contextualMessage = await generateContextualShare(originatingUser, targetUser, message);
            await addMessage(targetUser, contextualMessage, 'broadcast');
        }
    }
}

async function shareMessageWithTarget(originatingUser, message, targetUser) {
     console.log(chalk.blue(`[Orchestrator] Sharing message from '${originatingUser}' with '${targetUser}' by consent.`));
     const contextualMessage = await generateContextualShare(originatingUser, targetUser, message);
     await addMessage(targetUser, contextualMessage, 'broadcast');
}

// ... (escalateToDoctor, processFactsAndEvents, etc. are unchanged)
async function escalateToDoctor(type, details) {
    console.log(chalk.red.bold(`[Orchestrator] Escalating to doctor: ${type}`));
    const escalationSummary = await generateDoctorAgentReply(type, details);
    await addMessage('doctor', escalationSummary, 'escalation');
}

async function processFactsAndEvents(userId, facts, criticality, message) {
    if (criticality === 'HIGH' && userId !== 'doctor') {
        const allUsers = await getUsers();
        const otherUser = allUsers.find(u => u !== userId && u !== 'doctor');
        if (otherUser) {
            console.log(chalk.cyan(`[Orchestrator] High criticality event from '${userId}'. Probing '${otherUser}'.`));
            const clarificationMessage = await generateMediatedClarification(otherUser, message);
            await addMessage(otherUser, clarificationMessage);
        }
    }
    for (const [factKey, factValue] of Object.entries(facts)) {
        if (!factKey || factValue === undefined) continue;
        const existingFact = await getFact(factKey);
        if (existingFact && existingFact.reported_by !== userId && String(existingFact.value) !== String(factValue)) {
            const conflictingUser = existingFact.reported_by;
            const conflictDetails = `User '${userId}' reported '${factKey}' as '${factValue}', contradicting '${conflictingUser}'.`;
            console.log(chalk.yellow.bold(`[Conflict] Detected: ${conflictDetails}`));
            await escalateToDoctor('CONFLICT', conflictDetails);
            const mediationMessage = await generateMediatedClarification(conflictingUser, factKey);
            await addMessage(conflictingUser, mediationMessage);
        }
        await upsertFact(factKey, userId, factValue);
    }
}


async function handleCommand(userId, command) {
    const parts = command.split(' ');
    const cmd = parts[0];
    if (cmd === '/consent') {
        const targetUser = parts[1];
        const level = parts[2];
        if (!targetUser || !level) {
            await addMessage(userId, "[System] Invalid. Use: /consent <user> <level>", 'system');
            return;
        }
        await updateUserConsent(userId, targetUser, level);
        await addMessage(userId, `[System] Consent for '${targetUser}' set to '${level}'.`, 'system');
    } else {
        await addMessage(userId, "[System] Unknown command.", 'system');
    }
}

async function handleDoctorMessage(message) {
    const targetUser = message.toLowerCase().includes('caregiver') ? 'caregiver' : 'patient';
    console.log(chalk.blue(`[Orchestrator] Doctor directive for '${targetUser}'.`));
    const conversationalMessage = await generateDoctorDirective(message, targetUser);
    await addMessage(targetUser, conversationalMessage);
    await addMessage('doctor', `[System] Your directive sent to ${targetUser}.`, 'system');
}

async function triggerRelationshipAnalysis() {
    console.log(chalk.magentaBright('[Orchestrator] Triggering periodic relationship analysis...'));
    const history = await getConversationHistory(20);
    if (history.length < 5) {
        console.log(chalk.magentaBright('[Orchestrator] Not enough history to analyze relationship yet.'));
        return;
    }
    const { relationshipType, closenessScore } = await analyzeRelationship(history);
    console.log(chalk.magentaBright(`[Orchestrator] Analysis result: Type=${relationshipType}, Closeness=${closenessScore}`));
    await updateRelationship('patient', 'caregiver', relationshipType, closenessScore);
    await updateRelationship('caregiver', 'patient', relationshipType, closenessScore); // Reciprocal
}


async function handlePendingActions(userId, message) {
    const pendingAction = await getPendingAction(userId);
    if (!pendingAction) return false;

    const affirmativeResponse = /^(yes|yep|y|ok|okay|sure|proceed|consent granted|do it)/i.test(message);

    if (affirmativeResponse) {
        if (pendingAction.actionType === 'share') {
            const { originalMessage, target } = pendingAction.payload;
            await shareMessageWithTarget(userId, originalMessage, target);
            await addMessage(userId, `[System] Understood. I've shared the update with the ${target}.`);
        }
        await deletePendingAction(userId);
        return true; 
    } else {
        await deletePendingAction(userId);
        await addMessage(userId, "[System] Okay, I won't share it.");
        return true;
    }
}

// --- Server Handlers ---
export const handleNewConnection = (req, res) => {
    const { userId } = req.params;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients[userId] = { res };
    console.log(chalk.blue(`[Orchestrator] Client '${userId}' connected.`));

    req.on('close', () => {
        delete clients[userId];
        console.log(chalk.yellow(`[Orchestrator] Client '${userId}' disconnected.`));
    });
};

export const handleSendMessage = async (req, res) => {
    const { userId, message } = req.body;
    await addUser(userId);

    if (await handlePendingActions(userId, message)) {
        res.status(200).send({ status: 'pending action handled' });
        return;
    }

    if (message.startsWith('/')) {
        await handleCommand(userId, message);
        res.status(200).send({ status: 'command processed' });
        return;
    }

    console.log(`[Orchestrator] Received message from '${userId}': '${message}'`);

    if (userId === 'doctor') {
        await handleDoctorMessage(message);
        res.status(200).send({ status: 'ok' });
        return;
    }

    const analysis = await processUserMessage(userId, message);
    console.log(`[Orchestrator] Unified analysis complete:`, analysis);
    await addMessage(userId, analysis.reply);

    if (analysis.criticality === 'HIGH') {
        await escalateToDoctor('CRITICAL', `User '${userId}' reported: "${message}"`);
    }

    await broadcastToCareCircle(userId, message, analysis.privacyLevel);
    await processFactsAndEvents(userId, analysis.facts || {}, analysis.criticality, message);

    if (analysis.sharingSuggestion && analysis.sharingSuggestion.target) {
        const { target, reason } = analysis.sharingSuggestion;
        const requestMessage = await generateSharingRequest(target, reason);
        await addMessage(userId, requestMessage);
        await createPendingAction(userId, 'share', { originalMessage: message, target });
    }

    messageCounter++;
    if (messageCounter % 10 === 0) {
        await triggerRelationshipAnalysis();
    }

    res.status(200).send({ status: 'ok' });
};

export const handleClearAll = async (req, res) => {
    console.log("[Orchestrator] Clearing all data.");
    await clearAllData();
    res.status(200).send({ status: 'cleared' });
};

