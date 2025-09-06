import express from 'express';
import { EventEmitter } from 'events';
import { initializeDatabase, addMessage, getMessagesForUser, clearUserMessages, upsertFact, getFact, addEscalation, getUnreadEscalations, markEscalationsAsRead, clearAllData } from './database.js';
import { generatePersonalAgentReply, analyzeMessage } from './agents.js';
import chalk from 'chalk';

const app = express();
app.use(express.json());

const messageBus = new EventEmitter();
const doctorClients = new Set();


// --- Helper Functions ---
function broadcastToCareCircle(message) {
    messageBus.emit('care-circle-message', message);
}

function broadcastToDoctor(escalation) {
    doctorClients.forEach(client => {
        client.write(`data: ${JSON.stringify([escalation])}\n\n`);
    });
}

async function detectConflictAndEscalate(userId, facts) {
    for (const [factKey, factValue] of Object.entries(facts)) {
        const existingFact = await getFact(factKey);
        if (existingFact && existingFact.reported_by !== userId && String(existingFact.value) !== String(factValue)) {
            console.log(chalk.yellow.bold(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`));
            console.log(chalk.yellow.bold(`*** CONFLICT DETECTED on fact '${factKey}' ***`));
            console.log(chalk.yellow.bold(`-> ${userId} reports: ${factValue}`));
            console.log(chalk.yellow.bold(`-> ${existingFact.reported_by} reported: ${existingFact.value}`));
            console.log(chalk.yellow.bold(`-> ACTION: Silently escalating to Doctor.`));
            console.log(chalk.yellow.bold(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`));
            
            const newEscalation = await addEscalation('CONFLICT', `User '${userId}' reported '${factKey}' as '${factValue}', contradicting '${existingFact.reported_by}'.`);
            broadcastToDoctor(newEscalation);
        }
        await upsertFact(factKey, userId, factValue);
    }
}


// --- API Endpoints ---
app.post('/send', async (req, res) => {
    const { userId, message } = req.body;
    console.log(`[Orchestrator] Received message from '${userId}': '${message}'`);

    const analysis = await analyzeMessage(userId, message);
    console.log(`[Orchestrator] Analysis complete:`, analysis);

    // Criticality now directly influences the agent's reply.
    const personalReply = await generatePersonalAgentReply(userId, message, analysis.criticality);
    await addMessage(userId, personalReply);

    if (analysis.criticality === 'HIGH') {
        console.log(chalk.red.bold(`[Orchestrator] CRITICAL EVENT DETECTED. Escalating to doctor.`));
        const newEscalation = await addEscalation('CRITICAL', `User '${userId}' reported a critical event: "${message}"`);
        broadcastToDoctor(newEscalation);
    }

    if (analysis.privacyLevel === 'PUBLIC') {
        const broadcastMessage = `[Care Circle Update] The ${userId} has shared a new update.`;
        broadcastToCareCircle(broadcastMessage);
    } else {
         console.log(chalk.magenta(`[Orchestrator] Message from ${userId} is not for broadcast (Privacy: ${analysis.privacyLevel}).`));
    }
    
    let facts = {};
    if (message.toLowerCase().includes('took my medicine')) facts.medication_taken = true;
    if (message.toLowerCase().includes('did not take')) facts.medication_taken = false;
    if (message.toLowerCase().includes('chest pain')) facts.symptom_chest_pain = true;
    
    if (Object.keys(facts).length > 0) {
        await detectConflictAndEscalate(userId, facts);
    }

    res.status(200).send({ status: 'ok' });
});


app.get('/fetch/:userId', async (req, res) => {
    // BUG FIX: Added 'const { userId } = req.params;' to correctly capture the user ID.
    const { userId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const messageHandler = (message) => {
        res.write(`data: ${JSON.stringify({ messages: [message] })}\n\n`);
    };

    const pollMessages = async () => {
         const messages = await getMessagesForUser(userId);
         if (messages.length > 0) {
             res.write(`data: ${JSON.stringify({ messages })}\n\n`);
             await clearUserMessages(userId);
         }
    };
    
    pollMessages(); 
    const interval = setInterval(pollMessages, 2000); 
    messageBus.on('care-circle-message', messageHandler);

    req.on('close', () => {
        clearInterval(interval);
        messageBus.removeListener('care-circle-message', messageHandler);
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

