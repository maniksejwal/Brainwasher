/**
 * @fileoverview The main Express.js server for the application.
 * This file sets up all API endpoints, manages real-time client connections
 * using Server-Sent Events (SSE), and dispatches requests to the orchestrator.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
// FIX: Import the correct function
import { initializeDatabase, getUnreadEscalationsForUser, getDb } from './db/index.js';
import { handleLogin, handleMessage, handleCommand, events } from './orchestrator.js';
import config from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

// Simulation feedback is displayed inline - no copying needed

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

// Listen for future plan execution events (for client notifications)
events.on('future_plan_executed', (planData) => {
    // Broadcast plan execution to relevant users
    if (planData.userId && clients[planData.userId]) {
        clients[planData.userId].write(`data: ${JSON.stringify({ 
            type: 'future_plan_executed', 
            ...planData 
        })}\n\n`);
    }
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

events.on('analysis_progress', (payload) => {
    if (clients[payload.userId]) {
        clients[payload.userId].write(`data: ${JSON.stringify({ 
            type: 'analysis_progress', 
            ...payload 
        })}\n\n`);
    }
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

// POST endpoint to submit feedback
app.post('/api/feedback', async (req, res) => {
    try {
        const { userId, conversationId, score, comment } = req.body;
        const db = await getDb();
        
        await db.run(`
            INSERT INTO feedback (conversation_id, user_id, circle_id, score, comment, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            conversationId,
            userId,
            userId, // circle_id same as user_id for now
            score,
            comment || null,
            Date.now()
        ]);
        
        res.json({ success: true, message: 'Feedback saved' });
    } catch (error) {
        console.error('[Server] Save feedback error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Get available scenarios and personas
app.get('/api/scenarios', async (req, res) => {
    try {
        const personasModule = await import('./training/simulation/personas.js');
        const scenariosModule = await import('./training/simulation/scenarios.js');
        
        res.json({
            personas: personasModule.PERSONAS || {},
            scenarios: scenariosModule.SCENARIOS || {}
        });
    } catch (error) {
        console.error('[Server] Error loading scenarios:', error);
        res.status(500).json({ error: error.message });
    }
});

// Trigger simulation
app.post('/api/simulate', async (req, res) => {
    try {
        let { runs = 5, scenario: scenarioKey = 'random_single', turns = 3 } = req.body;
        
        // Handle random turns
        if (turns === 'random') {
            turns = [3, 5, 10, 15, 20][Math.floor(Math.random() * 5)];
        } else {
            turns = parseInt(turns) || 3;
        }
        
        // Import modules
        const { SimulationDriver } = await import('./training/simulation/simulator.js');
        const personasModule = await import('./training/simulation/personas.js');
        const scenariosModule = await import('./training/simulation/scenarios.js');
        
        const PERSONAS = personasModule.PERSONAS || personasModule.default;
        const SCENARIOS = scenariosModule.SCENARIOS || {};
        
        if (!PERSONAS) {
            throw new Error('PERSONAS not found');
        }
        
        // Get scenario definition
        let scenarioDef;
        if (scenarioKey === 'random') {
            // Truly random - pick any scenario
            const allScenarioKeys = Object.keys(SCENARIOS);
            if (allScenarioKeys.length > 0) {
                const randomKey = allScenarioKeys[Math.floor(Math.random() * allScenarioKeys.length)];
                scenarioDef = SCENARIOS[randomKey];
                console.log(`[Server] Random scenario selected: ${randomKey} - ${scenarioDef.name}`);
            } else {
                // Fallback if no scenarios
                const personaKeys = Object.keys(PERSONAS);
                const randomPersona = personaKeys[Math.floor(Math.random() * personaKeys.length)];
                scenarioDef = {
                    name: `Random - ${PERSONAS[randomPersona]?.name || randomPersona}`,
                    complexity: 1,
                    users: [{ role: 'patient', personaKey: randomPersona }]
                };
            }
        } else {
            scenarioDef = SCENARIOS[scenarioKey];
            if (!scenarioDef) {
                // Fallback to random single user
                const personaKeys = Object.keys(PERSONAS);
                const randomPersona = personaKeys[Math.floor(Math.random() * personaKeys.length)];
                scenarioDef = {
                    name: `Random - ${PERSONAS[randomPersona]?.name || randomPersona}`,
                    complexity: 1,
                    users: [{ role: 'patient', personaKey: randomPersona }]
                };
            }
        }
        
        // Build simulation config
        const simConfig = {
            name: `GUI: ${scenarioDef.name}`,
            users: scenarioDef.users.map((user, idx) => ({
                userId: `sim_${user.role}_${idx}`,
                role: user.role,
                personaKey: user.personaKey === 'random' ? 
                    Object.keys(PERSONAS)[Math.floor(Math.random() * Object.keys(PERSONAS).length)] :
                    user.personaKey,
                relationship: user.relationship,
                consent: user.consent
            })),
            circle: { 
                patientId: `sim_${scenarioDef.users[0].role}_0`,
                caregiverIds: scenarioDef.users.slice(1).map((_, idx) => `sim_${scenarioDef.users[idx + 1].role}_${idx + 1}`)
            },
            turns: parseInt(turns) || 3,
            complexity: scenarioDef.complexity,
            instructions: scenarioDef.instructions
        };

        const sim = new SimulationDriver('./care_circle_simulation.db', true, true); // dbPath, autoFeedback, logResults
        
        // Set up progress callback to emit events
        sim.progressCallback = (progress) => {
            console.log('[Server] Simulation progress:', progress);
            
            // Emit simulation progress to all connected clients
            Object.keys(clients).forEach(clientId => {
                clients[clientId].write(`data: ${JSON.stringify({ 
                    type: 'simulation_progress', 
                    ...progress 
                })}\n\n`);
            });
        };
        
        await sim.runScenario(simConfig);
        
        // No need to copy - simulation results are shown inline
        
        await sim.cleanup();

        res.json({ 
            success: true, 
            runs: 1, 
            message: `Simulation complete: ${scenarioDef.name}`,
            scenarioKey,
            scenarioName: scenarioDef.name,
            complexity: scenarioDef.complexity,
            turns: simConfig.turns,
            timestamp: new Date().toISOString()
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

// ========== CLI COMMAND PROXY ENDPOINTS ==========

/**
 * Generic CLI command executor with streaming support
 */
function executeCLICommand(command, args, res, timeoutMs = 300000) {
    const childProcess = spawn('node', [command, ...args], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const ensureHeaders = () => {
        if (!res.headersSent) {
            res.setHeader('Content-Type', 'application/json');
        }
    };

    const timeout = setTimeout(() => {
        ensureHeaders();
        if (!res.writableEnded) {
            res.write(JSON.stringify({ type: 'stderr', data: 'Command timeout' }) + '\n');
            res.write(JSON.stringify({
                type: 'result',
                data: {
                    success: false,
                    code: -1,
                    stdout: '',
                    stderr: 'Command timeout'
                }
            }) + '\n');
            res.end();
        }
        if (childProcess && !childProcess.killed) {
            childProcess.kill();
        }
    }, timeoutMs);

    let stdout = '';
    let stderr = '';

    childProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        console.log(`[CLI stdout ${command}] chunk length: ${chunk.length}`);
        ensureHeaders();
        if (!res.writableEnded) {
            res.write(JSON.stringify({ type: 'stdout', data: chunk }) + '\n');
        }
    });

    childProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        console.log(`[CLI stderr ${command}] chunk length: ${chunk.length}`);
        ensureHeaders();
        if (!res.writableEnded) {
            res.write(JSON.stringify({ type: 'stderr', data: chunk }) + '\n');
        }
    });

    childProcess.on('close', (code) => {
        clearTimeout(timeout);
        ensureHeaders();
        console.log(`[CLI close ${command}] code=${code} stdoutLen=${stdout.length} stderrLen=${stderr.length}`);
        if (!res.writableEnded) {
            res.write(JSON.stringify({
                type: 'result',
                data: {
                    success: code === 0,
                    code,
                    stdout,
                    stderr
                }
            }) + '\n');
            res.end();
        }
    });

    childProcess.on('error', (error) => {
        clearTimeout(timeout);
        ensureHeaders();
        if (!res.writableEnded) {
            res.write(JSON.stringify({ type: 'stderr', data: error.message }) + '\n');
            res.write(JSON.stringify({
                type: 'result',
                data: {
                    success: false,
                    code: -1,
                    stdout,
                    stderr: stderr ? `${stderr}\n${error.message}` : error.message
                }
            }) + '\n');
            res.end();
        }
    });
}

// Run simulation CLI
app.post('/api/cli/run-simulation', async (req, res) => {
    try {
        const { scenario, turns, skipFeedback } = req.body;
        const args = [];
        if (scenario) args.push('--scenario', scenario);
        if (turns) args.push('--turns', String(turns));
        const shouldSkip = skipFeedback !== false;
        if (shouldSkip) {
            args.push('--skip-feedback');
        } else {
            args.push('--with-feedback');
        }
        args.push('--from-dashboard');
        
        executeCLICommand('cli/run_simulation.js', args, res);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Train CLI
app.post('/api/cli/train', async (req, res) => {
    try {
        const { command = 'run', prompts, scenarios } = req.body;
        const args = [command];
        if (prompts) args.push('--prompts', prompts);
        if (scenarios) args.push('--scenarios', String(scenarios));
        
        executeCLICommand('cli/train.js', args, res);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Analyze CLI
app.post('/api/cli/analyze', async (req, res) => {
    try {
        const { command = 'all' } = req.body;
        executeCLICommand('cli/analyze.js', [command], res);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// World simulation CLI
app.post('/api/cli/world-simulation', async (req, res) => {
    try {
        const { scenario, skipFeedback } = req.body;
        const args = [];
        if (scenario) args.push('--scenario', scenario);
        const shouldSkip = skipFeedback !== false;
        if (shouldSkip) {
            args.push('--skip-feedback');
        } else {
            args.push('--with-feedback');
        }
        
        executeCLICommand('cli/world_simulation_cli.js', args, res);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Prompts CLI
app.post('/api/cli/prompts', async (req, res) => {
    try {
        const { command, version, compare } = req.body;
        const args = [command];
        if (version) args.push(version);
        if (compare) args.push('--compare');
        
        executeCLICommand('cli/prompts.js', args, res);
    } catch (error) {
        res.status(500).json({ error: error.message });
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

