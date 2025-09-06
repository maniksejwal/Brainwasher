import express from 'express';
import { 
    initializeDatabase, addMessage as dbAddMessage, 
    upsertFact, getFact, 
    clearAllData, updateUserConsent, getConsentLevel, getUsers, addUser
} from './database.js';
import { processUserMessage, generateMediatedClarification, generateDoctorAgentReply } from './agents.js';
import chalk from 'chalk';

const app = express();
app.use(express.json());

// --- Real-time Event System (Server-Sent Events) ---
let clients = {};

const sendMessageToUser = (userId, message) => {
    if (clients[userId]) {
        clients[userId].res.write(`data: ${JSON.stringify({ message })}\n\n`);
    }
};

async function addMessage(userId, message) {
    await dbAddMessage(userId, message);
    sendMessageToUser(userId, message);
}

app.get('/events/:userId', (req, res) => {
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
});


// --- Helper Functions ---
async function broadcastToCareCircle(originatingUser, message, privacyLevel) {
    if (privacyLevel !== 'PUBLIC') {
        console.log(chalk.magenta(`[Orchestrator] Message from ${originatingUser} is not for public broadcast (Privacy: ${privacyLevel}).`));
        return;
    }

    const allUsers = await getUsers();
    for (const targetUser of allUsers) {
        if (targetUser === originatingUser || targetUser === 'doctor') continue;

        const consentLevel = await getConsentLevel(originatingUser, targetUser);
        if (consentLevel === 'full') {
            await addMessage(targetUser, message);
        } else {
            console.log(chalk.cyan(`[Orchestrator] Broadcast to '${targetUser}' blocked by consent level: '${consentLevel}'`));
        }
    }
}

async function escalateToDoctor(type, details) {
    console.log(chalk.red.bold(`[Orchestrator] CRITICAL EVENT DETECTED. Escalating to doctor.`));
    const escalationSummary = await generateDoctorAgentReply(type, details);
    await addMessage('doctor', escalationSummary);
}


async function detectConflictAndMediate(userId, facts) {
    for (const [factKey, factValue] of Object.entries(facts)) {
        if (!factKey || factValue === undefined) continue; // Skip invalid facts
        
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
        const level = parts[2]; // 'full', 'limited', 'none'
        if (!targetUser || !level) {
            await addMessage(userId, "[System] Invalid command. Use: /consent <user> <level>");
            return;
        }
        await updateUserConsent(userId, targetUser, level);
        await addMessage(userId, `[System] Consent for '${targetUser}' set to '${level}'.`);
    } else {
        await addMessage(userId, "[System] Unknown command.");
    }
}

// --- API Endpoints ---
app.post('/send', async (req, res) => {
    const { userId, message } = req.body;
    await addUser(userId);

    if (message.startsWith('/')) {
        await handleCommand(userId, message);
        res.status(200).send({ status: 'command processed' });
        return;
    }

    console.log(`[Orchestrator] Received message from '${userId}': '${message}'`);

    // SINGLE API CALL
    const { reply, privacyLevel, criticality, facts } = await processUserMessage(userId, message);
    
    console.log(`[Orchestrator] Unified analysis complete:`, { reply, privacyLevel, criticality, facts });

    // 1. Always send personal reply
    await addMessage(userId, reply);

    // 2. Escalate if critical
    if (criticality === 'HIGH') {
        await escalateToDoctor('CRITICAL', `User '${userId}' reported: "${message}"`);
    }

    // 3. Broadcast to circle if public
    if (userId !== 'doctor') {
        await broadcastToCareCircle(userId, `[Care Circle Update] The ${userId} has shared an update.`, privacyLevel);
    }
    
    // 4. Detect conflicts from extracted facts
    if (facts && Object.keys(facts).length > 0) {
        await detectConflictAndMediate(userId, facts);
    }

    res.status(200).send({ status: 'ok' });
});

app.post('/clear-all', async (req, res) => {
    console.log("[Orchestrator] Clearing all data.");
    await clearAllData();
    res.status(200).send({ status: 'cleared' });
});

const PORT = 5000;
app.listen(PORT, async () => {
    await initializeDatabase();
    console.log(chalk.green.bold('--- Multi-Agent Orchestrator (JS) is RUNNING ---'));
    console.log(chalk.cyan('This terminal acts as the main system Log.'));
    console.log(`Listening on http://127.0.0.1:${PORT}`);
    console.log(chalk.yellow('---------------------------------------------'));
});

