import express from 'express';
import { broadcastToAll } from '../lib/sse.js';
import fs from 'fs/promises';

const router = express.Router();

// Trigger simulation
router.post('/simulate', async (req, res) => { // NOTE: Changed path from /simulate to /run (mounted at /api/simulations/run ?) 
    // Wait, original was /api/simulate. I should map it correctly.
    // If I mount this router at /api/simulations, then this is /run.
    // But original was /api/simulate.
    // I'll keep it as / (root of router) and mount at /api/simulate?
    // But there are other routes like /history.
    // Better: Mount at /api/simulations.
    // Original: POST /api/simulate. New: POST /api/simulations/run.
    // ERROR: This breaks API client!
    // I must preserve routes or update client.
    // I'll update client if needed, or keep route /simulate (root).
    // Let's use specific paths here and mount carefully.

    // I will use /simulate for compatibility matching `apiClient.runSimulation`.
    // Actually, I'll fix the route in this file to match what the client expects, or change client.
    // Client calls `/api/simulate`.
    // If I mount at `/api`, then route is `/simulate`.
    // If I mount at `/`, then `/api/simulate`.
    // I will export specific routes matching the original paths relative to where I mount.
    // I'll mount this router at `/api`.

    try {
        let { runs = 5, scenario: scenarioKey = 'random_single', turns = 3 } = req.body;

        // Handle random turns
        if (turns === 'random') {
            turns = [3, 5, 10, 15, 20][Math.floor(Math.random() * 5)];
        } else {
            turns = parseInt(turns) || 3;
        }

        // Import modules dynamically
        const { SimulationDriver } = await import('../training/simulation/simulator.js');
        const personasModule = await import('../training/simulation/personas.js');
        const scenariosModule = await import('../training/simulation/scenarios.js');

        const PERSONAS = personasModule.PERSONAS || personasModule.default;
        const SCENARIOS = scenariosModule.SCENARIOS || {};

        if (!PERSONAS) {
            throw new Error('PERSONAS not found');
        }

        // Get scenario definition
        let scenarioDef;
        if (scenarioKey === 'random') {
            const allScenarioKeys = Object.keys(SCENARIOS);
            if (allScenarioKeys.length > 0) {
                const randomKey = allScenarioKeys[Math.floor(Math.random() * allScenarioKeys.length)];
                scenarioDef = SCENARIOS[randomKey];
                console.log(`[Simulation] Random scenario selected: ${randomKey} - ${scenarioDef.name}`);
            } else {
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
                const personaKeys = Object.keys(PERSONAS);
                const randomPersona = personaKeys[Math.floor(Math.random() * personaKeys.length)];
                scenarioDef = {
                    name: `Random - ${PERSONAS[randomPersona]?.name || randomPersona}`,
                    complexity: 1,
                    users: [{ role: 'patient', personaKey: randomPersona }]
                };
            }
        }

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

        const sim = new SimulationDriver('./care_circle_simulation.db', true, true);

        sim.progressCallback = (progress) => {
            broadcastToAll({
                type: 'simulation_progress',
                ...progress
            });
        };

        await sim.runScenario(simConfig);
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
        console.error('[Simulation] Error:', error);
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});

// Get available scenarios and personas
router.get('/scenarios', async (req, res) => {
    try {
        const personasModule = await import('../training/simulation/personas.js');
        const scenariosModule = await import('../training/simulation/scenarios.js');

        res.json({
            personas: personasModule.PERSONAS || {},
            scenarios: scenariosModule.SCENARIOS || {}
        });
    } catch (error) {
        console.error('[Simulation] Error loading scenarios:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get full simulation history
router.get('/simulations/history', async (req, res) => {
    try {
        try {
            await fs.access('./training/training_log.jsonl');
        } catch {
            return res.json({ sessions: [] });
        }

        const logData = await fs.readFile('./training/training_log.jsonl', 'utf-8');
        const lines = logData.trim().split('\n').filter(line => line);
        const allLogs = lines.map(line => {
            try { return JSON.parse(line); } catch (e) { return null; }
        }).filter(l => l);

        const sessionsMap = {};
        allLogs.forEach(log => {
            const convId = log.conversation_id;
            if (!convId || !convId.startsWith('sim_')) return;

            if (!sessionsMap[convId]) {
                sessionsMap[convId] = {
                    id: convId,
                    timestamp: log.timestamp,
                    turns: 0,
                    score: undefined,
                    scenario: 'Unknown',
                    logs: []
                };
            }

            if (sessionsMap[convId].scenario === 'Unknown') {
                const parts = convId.split('_');
                if (parts.length >= 3) {
                    sessionsMap[convId].scenario = parts.slice(2).join('_');
                }
            }

            if (log.role === 'user' || log.user_id?.startsWith('sim_')) {
                sessionsMap[convId].turns++;
            }

            if (log.type === 'feedback' && log.score !== undefined) {
                sessionsMap[convId].score = log.score;
            }
        });

        const sessions = Object.values(sessionsMap).sort((a, b) => b.timestamp - a.timestamp);
        res.json({ sessions });

    } catch (error) {
        console.error('[Simulation] History error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get specific simulation logs
router.get('/simulations/:id/logs', async (req, res) => {
    try {
        const { id } = req.params;
        try {
            await fs.access('./training/training_log.jsonl');
        } catch {
            return res.json({ logs: [] });
        }

        const logData = await fs.readFile('./training/training_log.jsonl', 'utf-8');
        const lines = logData.trim().split('\n').filter(line => line);

        const logs = lines
            .map(line => { try { return JSON.parse(line); } catch (e) { return null; } })
            .filter(log => log && log.conversation_id === id)
            .flatMap(log => {
                const results = [];
                const formatUser = (uid) => {
                    if (!uid) return 'Unknown';
                    return uid.replace(/^cli_/, '').replace(/_run_\d+.*$/, '').replace(/_/g, ' ');
                };
                const userName = formatUser(log.user_id);
                const companionName = `Companion (${userName})`;

                if (log.message) {
                    results.push({
                        role: log.role || (log.user_id === 'system' ? 'system' : 'user'),
                        speaker: userName,
                        target: companionName,
                        content: log.message,
                        timestamp: log.timestamp,
                        type: 'message'
                    });
                }
                if (log.agent_response) {
                    let target = userName;
                    let content = log.agent_response;
                    const sentMatch = content.match(/sent to ([\w_]+)/i);
                    if (sentMatch) target = formatUser(sentMatch[1]);

                    results.push({
                        role: 'assistant',
                        speaker: companionName,
                        target: target,
                        content: content,
                        timestamp: log.timestamp + 100,
                        type: 'response'
                    });
                }
                if (!log.message && !log.agent_response && log.action) {
                    results.push({
                        role: 'system',
                        speaker: 'System',
                        target: 'All',
                        content: log.action,
                        timestamp: log.timestamp,
                        type: 'action'
                    });
                }
                return results;
            });

        res.json({ logs });

    } catch (error) {
        console.error('[Simulation] Logs error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
