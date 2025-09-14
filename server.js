import express from 'express';
// FIX: Update import path to the new db package index
import { initializeDatabase, getUnreadEscalations } from './db/index.js';
import { handleLogin, handleMessage, handleCommand, events } from './orchestrator.js';
import config from './config.js';

const app = express();
app.use(express.json());

const clients = {};

app.get('/events/:userId', (req, res) => {
    const { userId } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients[userId] = res;
    console.log(`[Server] Client connected: ${userId}`);

    const heartbeat = setInterval(() => res.write(': \n\n'), 10000);

    req.on('close', () => {
        clearInterval(heartbeat);
        delete clients[userId];
        console.log(`[Server] Client disconnected: ${userId}`);
    });
});

function broadcast(targetUsers, data) {
    targetUsers.forEach(userId => {
        if (clients[userId]) {
            clients[userId].write(`data: ${JSON.stringify(data)}\n\n`);
        }
    });
}

events.on('broadcast', (payload) => {
    broadcast(payload.targetUsers, { type: 'message', ...payload });
});

events.on('context_switch', (payload) => {
     if (clients[payload.userId]) {
        clients[payload.userId].write(`data: ${JSON.stringify({ type: 'context_switched', newCircleId: payload.newCircleId })}\n\n`);
    }
});

events.on('escalate', (payload) => {
    Object.keys(clients).forEach(clientId => {
        clients[clientId].write(`data: ${JSON.stringify({ type: 'escalation', ...payload })}\n\n`);
    });
});

app.get('/doctor/escalations/unread', async (req, res) => {
    const escalations = await getUnreadEscalations();
    res.status(200).json(escalations);
});

app.post('/login', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: 'Missing username' });
    }
    const result = await handleLogin(username);
    res.status(200).json(result);
});

app.post('/command', (req, res) => {
    const { userId, circleId, message } = req.body;
     if (!userId || !circleId || !message) {
        return res.status(400).json({ error: 'Missing userId, circleId, or message' });
    }
    handleCommand(userId, circleId, message);
    res.status(202).send();
});

app.post('/send', (req, res) => {
    const { userId, circleId, message } = req.body;
    if (!userId || !circleId || !message) {
        return res.status(400).json({ error: 'Missing userId, circleId, or message' });
    }
    handleMessage(userId, circleId, message);
    res.status(202).send();
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

