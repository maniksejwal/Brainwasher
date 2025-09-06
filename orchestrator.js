import express from 'express';
import { EventEmitter } from 'events';
import { 
    initializeDatabase, addMessage, getMessagesForUser, clearUserMessages, 
    upsertFact, getFact, addEscalation, getUnreadEscalations, markEscalationsAsRead, 
    clearAllData, updateUserConsent, getConsentLevel, getUsers
} from './database.js';
import { generatePersonalAgentReply, analyzeMessage, generateMediatedClarification } from './agents.js';
import chalk from 'chalk';

const app = express();
app.use(express.json());

const messageBus = new EventEmitter();
const doctorClients = new Set();

// --- Helper Functions ---
async function broadcastToCareCircle(originatingUser, message, privacyLevel) {
    if (privacyLevel !== 'PUBLIC') {
        console.log(chalk.magenta(`[Orchestrator] Message from ${originatingUser} is not for public broadcast (Privacy: ${privacyLevel}).`));
        return;
    }

    const allUsers = await getUsers();
    for (const targetUser of allUsers) {
        if (targetUser === originatingUser) continue;

        const consentLevel = await getConsentLevel(originatingUser, targetUser);
        if (consentLevel === 'full') {
            messageBus.emit('message-for-user', { userId: targetUser, message });
        } else {
            console.log(chalk.cyan(`[Orchestrator] Broadcast to '${targetUser}' blocked by consent level: '${consentLevel}'`));
        }
    }
}

function broadcastToDoctor(escalation) {
    doctorClients.forEach(client => {
        client.write(`data: ${JSON.stringify([escalation])}\n\n`);
    });
}

async function detectConflictAndMediate(userId, facts) {
    for (const [factKey, factValue] of Object.entries(facts)) {
        const existingFact = await getFact(factKey);
        if (existingFact && existingFact.reported_by !== userId && String(existingFact.value) !== String(factValue)) {
            const conflictingUser = existingFact.reported_by;
            console.log(chalk.yellow.bold(`[Conflict] Detected on '${factKey}'. Escalating and attempting mediated clarification.`));
            
            const escalation = await addEscalation('CONFLICT', `User '${userId}' reported '${factKey}' as '${factValue}', contradicting '${conflictingUser}'.`);
            broadcastToDoctor(escalation);

            // Mediate: Ask the *first* person who reported the fact to clarify.
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

    if (message.startsWith('/')) {
        await handleCommand(userId, message);
        res.status(200).send({ status: 'command processed' });
        return;
    }

    console.log(`[Orchestrator] Received message from '${userId}': '${message}'`);

    const analysis = await analyzeMessage(userId, message);
    console.log(`[Orchestrator] Analysis complete:`, analysis);

    const personalReply = await generatePersonalAgentReply(userId, message, analysis.criticality);
    await addMessage(userId, personalReply);

    if (analysis.criticality === 'HIGH') {
        console.log(chalk.red.bold(`[Orchestrator] CRITICAL EVENT DETECTED. Escalating to doctor.`));
        const newEscalation = await addEscalation('CRITICAL', `User '${userId}' reported: "${message}"`);
        broadcastToDoctor(newEscalation);
    }

    await broadcastToCareCircle(userId, `[Care Circle Update] The ${userId} has shared a new update.`, analysis.privacyLevel);
    
    let facts = {};
    if (message.toLowerCase().includes('took my medicine')) facts.medication_taken = true;
    if (message.toLowerCase().includes('did not take')) facts.medication_taken = false;
    
    if (Object.keys(facts).length > 0) {
        await detectConflictAndMediate(userId, facts);
    }

    res.status(200).send({ status: 'ok' });
});

app.get('/fetch/:userId', async (req, res) => {
    const { userId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const specificMessageHandler = (data) => {
        if (data.userId === userId) {
            res.write(`data: ${JSON.stringify({ messages: [data.message] })}\n\n`);
        }
    };
    
    const pollMessages = async () => {
         const messages = await getMessagesForUser(userId);
         if (messages.length > 0) {
             res.write(`data: ${JSON.stringify({ messages })}\n\n`);
             await clearUserMessages(userId);
         }
    };
    
    pollMessages(); 
    const interval = setInterval(pollMessages, 1500); 
    messageBus.on('message-for-user', specificMessageHandler);

    req.on('close', () => {
        clearInterval(interval);
        messageBus.removeListener('message-for-user', specificMessageHandler);
        res.end();
    });
});

app.get('/doctor/escalations', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    
    doctorClients.add(res);
    console.log(chalk.blue(`[Orchestrator] Doctor client connected. Total clients: ${doctorClients.size}`));

    getUnreadEscalations().then(async (escalations) => {
        if (escalations.length > 0) {
            res.write(`data: ${JSON.stringify(escalations)}\n\n`);
            await markEscalationsAsRead(escalations.map(e => e.id));
        }
    });

    req.on('close', () => {
        doctorClients.delete(res);
        console.log(chalk.blue(`[Orchestrator] Doctor client disconnected. Total clients: ${doctorClients.size}`));
        res.end();
    });
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
    console.log(chalk.cyan('This terminal acts as the Doctor\'s Log.'));
    console.log(`Listening on http://127.0.0.1:${PORT}`);
    console.log(chalk.yellow('---------------------------------------------'));
});

