import express from 'express';
import { initializeDatabase, getUnreadEscalations } from './database.js';
import { handleNewUser, handleMessage, events } from './orchestrator.js';
import config from './config.js';

const app = express();
app.use(express.json());

let clients = [];

// Endpoint for real-time updates (SSE)
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = Date.now();
    const newClient = {
        id: clientId,
        res,
    };
    clients.push(newClient);
    console.log(`[Server] Client connected: ${clientId}. Total clients: ${clients.length}`);

    const heartbeat = setInterval(() => {
        res.write(': \n\n');
    }, 10000);

    req.on('close', () => {
        clearInterval(heartbeat);
        clients = clients.filter(client => client.id !== clientId);
        console.log(`[Server] Client disconnected: ${clientId}. Total clients: ${clients.length}`);
    });
});

function broadcast(data) {
    clients.forEach(client => client.res.write(`data: ${JSON.stringify(data)}\n\n`));
}

events.on('broadcast', (payload) => {
    broadcast({ type: 'message', ...payload });
});

events.on('escalate', () => {
    broadcast({ type: 'escalation' });
});

// ** FIX: Added the missing endpoint for the doctor to fetch escalation details **
app.get('/doctor/escalations/unread', async (req, res) => {
    const escalations = await getUnreadEscalations();
    res.status(200).json(escalations);
});

app.post('/user', async (req, res) => {
    const { userId, role } = req.body;
    const result = await handleNewUser(userId, role);
    if (result.error) {
        return res.status(400).json(result);
    }
    res.status(200).json(result);
});

app.post('/send', (req, res) => {
    const { userId, role, message } = req.body;
    if (!userId || !role || !message) {
        return res.status(400).json({ error: 'Missing userId, role, or message' });
    }
    handleMessage(userId, role, message);
    res.status(202).send();
});

app.post('/clear', (req, res) => {
    console.log('[Server] Received request to clear database.');
    events.emit('clear_db');
    res.status(200).send({ message: 'Database clear initiated.' });
});

const PORT = config.PORT;
const HOST = config.HOST;
initializeDatabase().then(() => {
    app.listen(PORT, HOST, () => {
        console.log(`--- Multi-Agent Orchestrator (JS) is RUNNING ---`);
        console.log(`Listening on http://${HOST}:${PORT}`);
        console.log(`---------------------------------------------`);
    });
}).catch(console.error);

