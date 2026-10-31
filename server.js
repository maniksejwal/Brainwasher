/**
 * @fileoverview The main Express.js server for the application.
 * Modularized version: Routes logic is delegated to the /routes directory.
 */

import express from 'express';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import config from './config.js';
import { initializeDatabase } from './db/index.js';
import { runDueAutoAlerts } from './services/escalationService.js';
import { startConversationWorker } from './services/conversationJobs.js';
import { events } from './orchestrator.js';
import { setupLogger, getLogs } from './lib/logger.js';
import { addClient, removeClient, broadcast } from './lib/sse.js';
import { authenticate, authenticateStream, authorize, requireSelf } from './middleware/auth.js';
import { captureRawBody } from './middleware/serviceAuth.js';

// Route Modules
import authRouter from './routes/auth.js';
import integrationsRouter from './routes/integrations.js';
import coreRouter from './routes/core.js';
import simulationRouter from './routes/simulation.js';
import dataRouter from './routes/data.js';
import guiRouter from './routes/gui.js';
import cliRouter from './routes/cli.js';
import analysisRouter from './routes/analysis.js';
import componentsRouter from './routes/components.js';
import notificationsRouter from './routes/notifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// CORS_ORIGINS (comma-separated) limits which sites may call the API from a browser.
// Unset, any origin may (local development). Requests still need a session token either way.
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
app.use(cors(corsOrigins.length > 0 ? { origin: corsOrigins } : {}));
// The raw body is kept so signed integration requests can verify their body digest
app.use(express.json({ verify: captureRawBody }));

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
// A user can only listen to their own events
app.get('/events/:userId', authenticateStream, requireSelf(), (req, res) => {
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
        console.log(`[Server] Broadcasting to ${Array.isArray(payload.targetUsers) ? payload.targetUsers.join(', ') : '<none>'} | from=${payload.from || 'unknown'} | preview="${preview ? String(preview).slice(0, 60) : ''}"`);
    } catch (err) {
        console.warn('[Server] Failed to log broadcast payload:', err?.message || err);
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
            newRole: payload.newRole
        });
    }
});

// An escalation is sent only to its recipients; there is no circle-wide or global fallback
events.on('escalate', ({ circleId, escalationId, type, recipients }) => {
    if (!recipients?.length) {
        console.error(`[Server] Escalation ${escalationId} in circle ${circleId} has no recipients; not sending it`);
        return;
    }
    broadcast(recipients, { type: 'escalation', circleId, escalationId, escalationType: type });
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

// HealthyMitra integration: signed service requests only
app.use('/api/integrations/healthymitra', integrationsRouter);

// CLI Endpoints
app.use('/api/cli', cliRouter);

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

// Core API (send, command, escalations, prompts) -> mounted at root for /send, /command and /doctor/*
app.use('/', coreRouter);


// Logs API (Uses lib/logger)
app.get('/api/logs', authenticate, authorize('logs:view'), (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const recent = getLogs(limit);
    res.json({ logs: recent });
});

// ========== STARTUP ==========

const PORT = config.PORT || 3000; // Use config port or default to 3000? original used config.PORT
const HOST = config.HOST || 'localhost';

// How often unanswered emergency proposals are checked for their automatic send time
const AUTO_ALERT_SWEEP_MS = 15000;

const sweepAutoAlerts = () => runDueAutoAlerts().catch(error => console.error('[Server] Automatic alert sweep failed:', error.message));

initializeDatabase().then(() => {
    // The first run sends alerts that fell due while the server was down
    sweepAutoAlerts();
    setInterval(sweepAutoAlerts, AUTO_ALERT_SWEEP_MS).unref();
    // HealthyMitra conversations: transcripts and queued messages, including any left by a restart
    startConversationWorker().catch(error => console.error('[Server] Conversation worker failed to start:', error.message));
    app.listen(PORT, HOST, () => {
        console.log(`--- Multi-Agent Orchestrator (JS) is RUNNING ---`);
        console.log(`Listening on http://${HOST}:${PORT}`);
        console.log(`---------------------------------------------`);
    });
}).catch(console.error);
