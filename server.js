/**
 * @fileoverview The main Express.js server for the application.
 * Modularized version: Routes logic is delegated to the /routes directory.
 */

import express from 'express';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import config from './config.js';
import { initializeDatabase, addHTNBenchmarkTables, addConversationIntelligenceTables } from './db/index.js';
import { events } from './orchestrator.js';
import { setupLogger, getLogs } from './lib/logger.js';
import { addClient, removeClient, broadcast } from './lib/sse.js';

// Route Modules
import authRouter from './routes/auth.js';
import coreRouter from './routes/core.js';
import trainingRouter from './routes/training.js';
import simulationRouter from './routes/simulation.js';
import dataRouter from './routes/data.js';
import guiRouter from './routes/gui.js';
import cliRouter from './routes/cli.js';
import analysisRouter from './routes/analysis.js';
import componentsRouter from './routes/components.js';
import notificationsRouter from './routes/notifications.js';
import businessRouter from './routes/business.js';
import dialogGraphsRouter from './routes/dialog_graphs.js';
import benchmarksRouter from './routes/benchmarks.js';
import interventionsRouter from './routes/interventions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors()); // Allow all origins for now (Refine for production)
app.use(express.json());

// Trust Proxy for ALB
app.enable('trust proxy');

// Initialize Logger
setupLogger();

// Serve Static Files
// Specific route must come BEFORE the static middleware for the same path prefix to take precedence
app.get('/reports/simulation', (req, res) => {
    const reportPath = path.join(__dirname, 'training/analysis/reports/simulation_report.html');
    res.sendFile(reportPath);
});

app.use('/gui', express.static(path.join(__dirname, 'gui')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use('/reports', express.static(path.join(__dirname, 'training/analysis/reports')));

// ========== SERVER-SENT EVENTS (SSE) ==========

// Client Connection
app.get('/events/:userId', (req, res) => {
    const { userId } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    addClient(userId, res);

    const heartbeat = setInterval(() => res.write(': \n\n'), 10000);

    req.on('close', () => {
        clearInterval(heartbeat);
        removeClient(userId);
    });
});

// Event Bindings (Orchestrator -> SSE)
events.on('broadcast', (payload) => {
    try {
        const preview = payload.reply || payload.message || '';
        console.log(`[Server] Delivering to ${Array.isArray(payload.targetUsers) ? payload.targetUsers.join(', ') : '<none>'} | from=${payload.from || 'unknown'} | preview="${preview ? String(preview).slice(0, 60) : ''}"`);
    } catch (err) {
        console.warn('[Server] Failed to log delivery payload:', err?.message || err);
    }
    broadcast(payload.targetUsers, { type: 'message', ...payload });
});

events.on('future_plan_executed', (planData) => {
    if (planData.userId) {
        broadcast([planData.userId], { type: 'future_plan_executed', ...planData });
    }
});

events.on('context_switch', (payload) => {
    if (payload.userId) {
        broadcast([payload.userId], {
            type: 'context_switched',
            newCircleId: payload.newCircleId,
            patientUsername: payload.patientUsername,
            circleType: payload.circleType,
            circleName: payload.circleName,
            newRole: payload.newRole
        });
    }
});

events.on('escalate', (payload) => {
    // The escalate event is a post-hoc signal — the actual directed notifications
    // (to caregivers, doctors, etc.) have already been sent by escalationTiers.js
    // before this event fires. This handler only delivers a secondary SSE push
    // to the triggering user (confirmation) and respects anonymity flags.
    //
    // Escalations are NOT broadcasts — they are directed sharing actions:
    //   Tier 2 → caregivers only           (handled by escalationTiers.handleTier2Caregiver)
    //   Tier 3 → anonymous, no identity    (handled by escalationTiers.handleTier3Anonymous)
    //   Tier 4 → doctor with full context  (handled by escalationTiers.handleTier4Consultation)
    //
    // Anonymous escalations (payload.anonymous = true) must NOT carry patient
    // details in the SSE push — identity is explicitly withheld at Tier 3.
    import('./lib/sse.js').then(({ broadcast }) => {
        if (!payload.userId) return;   // no triggering user — nothing to confirm
        const safePayload = payload.anonymous
            ? { type: 'escalation', circleId: payload.circleId, anonymous: true }
            : { type: 'escalation', ...payload };
        broadcast([payload.userId], safePayload);
    });
});

events.on('analysis_progress', (payload) => {
    if (payload.userId) {
        broadcast([payload.userId], { type: 'analysis_progress', ...payload });
    }
});

// ========== ROUTE MOUNTING ==========

// Health Check
app.get('/api/auth/health', (req, res) => res.status(200).send('OK'));

// Auth
app.use('/api/auth', authRouter);

// CLI Endpoints
app.use('/api/cli', cliRouter);

// A3C training/benchmark endpoints (training scenarios, benchmark message)
app.use('/api', trainingRouter);

// Simulation & Scenarios
app.use('/api', simulationRouter);

// Data Access (User, Circles)
app.use('/api', dataRouter);

// GUI Specific (Conversations, Feedback)
app.use('/api', guiRouter);

// Analysis
app.use('/api', analysisRouter);

// Components
app.use('/api', componentsRouter);

// Notifications
app.use('/api', notificationsRouter);

app.use('/api', businessRouter);
app.use('/api', dialogGraphsRouter);
app.use('/api/benchmarks', benchmarksRouter);
app.use('/api', interventionsRouter);

// Core API (Prompts, Command, Legacy Login) -> Mounted at root because it handles both /login and /api/prompts
app.use('/', coreRouter);


// Logs API (Uses lib/logger)
app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const recent = getLogs(limit);
    res.json({ logs: recent });
});

// ── Process-level crash guards ───────────────────────────────────────────────
// Without these an unhandled promise rejection silently kills the Node process,
// causing the reload button to fail with "connection refused" until manual restart.
process.on('uncaughtException', (err) => {
    console.error('[Server] UNCAUGHT EXCEPTION — server will stay up:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[Server] UNHANDLED REJECTION — server will stay up:', reason);
});

// ========== STARTUP ==========

const PORT = config.PORT || 3000; // Use config port or default to 3000? original used config.PORT
const HOST = config.HOST || 'localhost';

initializeDatabase()
    .then(() => addHTNBenchmarkTables())
    .then(() => addConversationIntelligenceTables())
    .then(() => {
    app.listen(PORT, HOST, () => {
        console.log(`--- Multi-Agent Orchestrator (JS) is RUNNING ---`);
        console.log(`Listening on http://${HOST}:${PORT}`);
        console.log(`---------------------------------------------`);
    });
}).catch(console.error);
