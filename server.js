/**
 * @fileoverview The main Express.js server for the application.
 * This file sets up all API endpoints, manages real-time client connections
 * using Server-Sent Events (SSE), and dispatches requests to the orchestrator.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
// FIX: Import the correct function
import { initializeDatabase, getUnreadEscalationsForUser, getDb } from './db/index.js';
import { handleLogin, handleMessage, handleCommand, events } from './orchestrator.js';
import config from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

const clients = {};

// Log buffer for GUI (circular buffer, last 200 entries)
const logBuffer = [];
const MAX_LOGS = 200;

// Override console.log to capture logs
const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    logBuffer.push({ timestamp: Date.now(), level: 'info', message });
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
    originalLog(...args);
};

console.error = (...args) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    logBuffer.push({ timestamp: Date.now(), level: 'error', message });
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
    originalError(...args);
};

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
        clients[payload.userId].write(`data: ${JSON.stringify({ 
            type: 'context_switched', 
            newCircleId: payload.newCircleId,
            patientUsername: payload.patientUsername,
            newRole: payload.newRole
        })}\n\n`);
    }
});

events.on('escalate', (payload) => {
    Object.keys(clients).forEach(clientId => {
        clients[clientId].write(`data: ${JSON.stringify({ type: 'escalation', ...payload })}\n\n`);
    });
});

// FIX: Update endpoint to be user-specific for security and correctness
app.get('/doctor/escalations/unread/:userId', async (req, res) => {
    const { userId } = req.params;
    const escalations = await getUnreadEscalationsForUser(userId);
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

// ========== GUI & TRAINING API ENDPOINTS ==========

// Serve GUI static files
app.use('/gui', express.static(path.join(__dirname, 'gui')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// Get conversation history (grouped by conversation_id)
app.get('/api/conversations/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const fs = await import('fs/promises');
        
        // Read training log
        const logData = await fs.readFile('./training/training_log.jsonl', 'utf-8');
        const lines = logData.trim().split('\n').filter(line => line);
        
        // Parse and filter by user
        const allLogs = lines.map(line => JSON.parse(line));
        const userLogs = allLogs.filter(log => log.user_id === userId);
        
        // Group by conversation_id
        const conversations = {};
        userLogs.forEach(log => {
            const convId = log.conversation_id;
            if (!conversations[convId]) {
                conversations[convId] = {
                    conversation_id: convId,
                    messages: [],
                    start_time: log.timestamp,
                    end_time: log.timestamp
                };
            }
            conversations[convId].messages.push(log);
            conversations[convId].end_time = Math.max(conversations[convId].end_time, log.timestamp);
        });
        
        // Convert to array and sort by most recent
        const result = Object.values(conversations).sort((a, b) => b.start_time - a.start_time);
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message, conversations: [] });
    }
});

// Get user's feedback history from database
app.get('/api/feedback/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const db = await getDb();
        
        // Check if feedback table exists
        const tableExists = await db.get(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='feedback'
        `);
        
        if (!tableExists) {
            // Table doesn't exist yet - return empty array
            return res.json([]);
        }
        
        const feedback = await db.all(`
            SELECT * FROM feedback 
            WHERE user_id = ? 
            ORDER BY timestamp DESC 
            LIMIT 100
        `, [userId]);
        
        res.json(feedback || []);
    } catch (error) {
        console.error('[Server] Feedback error:', error.message);
        res.status(500).json({ error: error.message, feedback: [] });
    }
});

// Trigger simulation
app.post('/api/simulate', async (req, res) => {
    try {
        const { runs = 5 } = req.body;
        
        // Import and run simulator
        const { SimulationDriver } = await import('./training/simulation/simulator.js');
        const personasModule = await import('./training/simulation/personas.js');
        const PERSONAS = personasModule.PERSONAS || personasModule.default;
        
        if (!PERSONAS) {
            throw new Error('PERSONAS not found in personas.js');
        }
        
        const personaKeys = Object.keys(PERSONAS);
        const randomPersona = personaKeys[Math.floor(Math.random() * personaKeys.length)];
        
        const scenario = {
            name: `GUI Simulation - ${randomPersona}`,
            users: [
                { userId: 'sim_patient', role: 'patient', personaKey: randomPersona }
            ],
            circle: { patientId: 'sim_patient', caregiverIds: [] },
            turns: 3
        };

        const sim = new SimulationDriver({ logResults: true });
        await sim.runScenario(scenario);
        await sim.cleanup();

        res.json({ 
            success: true, 
            runs: 1, 
            message: `Simulation complete (${randomPersona})`,
            persona: randomPersona
        });
    } catch (error) {
        console.error('[Server] Simulation error:', error);
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});

// Generate analysis report
app.post('/api/analyze', async (req, res) => {
    try {
        const fs = await import('fs/promises');
        
        // Read training log
        const logData = await fs.readFile('./training/training_log.jsonl', 'utf-8');
        const lines = logData.trim().split('\n').filter(line => line);
        const allLogs = lines.map(line => JSON.parse(line));
        
        // Calculate simple stats
        const totalInteractions = allLogs.length;
        const avgLatency = allLogs.reduce((sum, log) => sum + (log.latency_ms || 0), 0) / totalInteractions;
        const escalations = allLogs.filter(log => log.escalated).length;
        const shares = allLogs.filter(log => log.shared).length;
        
        res.json({
            success: true,
            total: totalInteractions,
            avgScore: 0, // Would need feedback data
            avgLatency: Math.round(avgLatency),
            escalations,
            shares,
            report: 'Analysis complete'
        });
    } catch (error) {
        console.error('[Server] Analysis error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Get server logs (NO LOGGING HERE to avoid infinite loop!)
app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const recent = logBuffer.slice(-limit);
    res.json({ logs: recent });
});

// Get circle members
app.get('/api/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { findUserById } = await import('./db/index.js');
        
        const user = await findUserById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ user });
    } catch (error) {
        console.error('[Server] User API error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all circles for a user
app.get('/api/mycircles/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { getUserCircles } = await import('./db/index.js');
        
        const circles = await getUserCircles(userId);
        res.json({ circles });
    } catch (error) {
        console.error('[Server] MyCircles API error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get patients for a doctor
app.get('/api/patients/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { getUserCircles } = await import('./db/index.js');
        
        const allCircles = await getUserCircles(userId);
        const doctorCircles = allCircles.filter(circle => circle.role === 'doctor');
        
        res.json({ patients: doctorCircles });
    } catch (error) {
        console.error('[Server] Patients API error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/circle/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { getCircleMembers, getUserCircles } = await import('./db/index.js');
        
        // Get user's circles
        const circles = await getUserCircles(userId);
        
        if (!circles || circles.length === 0) {
            return res.json({ members: [], circleId: null });
        }
        
        // Get the primary circle (where user is patient)
        const primaryCircle = circles.find(c => c.circle_id === userId) || circles[0];
        
        // Get members of that circle
        const members = await getCircleMembers(primaryCircle.circle_id);
        
        res.json({ 
            members: members || [], 
            circleId: primaryCircle.circle_id,
            patientUsername: primaryCircle.patient_username
        });
    } catch (error) {
        console.error('[Server] Circle API error:', error);
        res.status(500).json({ error: error.message, members: [] });
    }
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

