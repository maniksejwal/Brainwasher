import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCENARIOS } from '../../simulation/scenarios.js';
import { PATIENT_PERSONAS, CAREGIVER_PERSONAS, DOCTOR_PERSONAS, VERBOSITY_PERSONAS } from '../../simulation/personas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths relative to this lib file: ../../../
const PROJECT_ROOT = path.join(__dirname, '../../../');
const LOG_FILE = path.join(PROJECT_ROOT, 'training/training_log.jsonl');
const SIM_DB_FILE = path.join(PROJECT_ROOT, 'care_circle_simulation.db');
const PROD_DB_FILE = path.join(PROJECT_ROOT, 'care_circle.db');

export class TrainingMetricsAnalyzer {
    constructor() {
        this.logStats = {
            totalLines: 0,
            conversations: new Map(),
            users: new Set(),
            personas: new Set(),
            errors: {},
            interactions: 0,
            promptVersions: {},
            models: {},
            granular: {}
        };
        this.dbStats = {
            feedback: [],
            detailedFeedback: [],
            flags: [],
            personas: [],
            scenarios: [],
            meta: { lastUpdatedSim: null, lastUpdatedProd: null }
        };
    }

    async analyzeLogs() {
        if (!fs.existsSync(LOG_FILE)) {
            console.warn(`Log file not found at ${LOG_FILE}`);
            return this.logStats;
        }

        const fileStream = fs.createReadStream(LOG_FILE);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            try {
                const entry = JSON.parse(line);
                this.logStats.totalLines++;

                if (entry.conversation_id) {
                    this._processConversationEntry(entry);
                }
            } catch (e) {
                // Ignore parse errors
            }
        }

        this._postProcessStats();
        return this.logStats;
    }

    _processConversationEntry(entry) {
        const stats = this.logStats;

        // 1. Conversation Aggregation
        if (!stats.conversations.has(entry.conversation_id)) {
            const timestampMatch = entry.conversation_id.match(/sim_(\d+)_/);
            const timestamp = timestampMatch ? parseInt(timestampMatch[1]) : (entry.timestamp || Date.now());

            stats.conversations.set(entry.conversation_id, {
                timestamp,
                msgLens: [],
                respLens: [],
                errors: [],
                interactionCount: 0,
                promptVersion: entry.prompt_version || 'unknown',
                modelUsed: entry.model_used || 'unknown',
                participants: new Set(),
                roleCounts: {}
            });
        }
        const convData = stats.conversations.get(entry.conversation_id);

        if (convData.modelUsed === 'unknown' && entry.model_used) {
            convData.modelUsed = entry.model_used;
        }

        // 2. User Stats
        if (entry.user_id) stats.users.add(entry.user_id);

        // 3. Length Stats
        if (entry.message_length) convData.msgLens.push(entry.message_length);
        if (entry.response_length) convData.respLens.push(entry.response_length);

        // 4. Error Tracking
        if (entry.agent_response && typeof entry.agent_response === 'string' && entry.agent_response.includes('SIMULATION ERROR')) {
            const errorMsg = entry.agent_response;
            stats.errors[errorMsg] = (stats.errors[errorMsg] || 0) + 1;
            convData.errors.push(errorMsg);
        }

        if (entry.persona) {
            stats.personas.add(entry.persona);
        }

        // 5. Interaction Count
        if (entry.message && entry.agent_response) {
            stats.interactions++;
            convData.interactionCount++;
        }

        // 6. Role Inference
        let role = entry.role;
        if (!role && entry.user_id) {
            const lcUser = entry.user_id.toLowerCase();
            role = lcUser.includes('doctor') ? 'doctor' :
                lcUser.includes('caregiver') ? 'caregiver' :
                    (lcUser.includes('patient') || !lcUser.includes('_')) ? 'patient' : 'unknown';
        }

        if (role && role !== 'unknown' && role !== 'agent' && role !== 'model') {
            convData.participants.add(role);
            convData.roleCounts[role] = (convData.roleCounts[role] || 0) + 1;
        }
    }

    _postProcessStats() {
        const stats = this.logStats;

        for (const [convId, data] of stats.conversations) {
            const pVersion = data.promptVersion;
            const model = data.modelUsed;

            // Model Stats
            if (model) {
                if (!stats.models[model]) {
                    stats.models[model] = { count: 0, conversationIds: new Set() };
                }
                stats.models[model].count++;
                stats.models[model].conversationIds.add(convId);
            }

            // Granular Bucket
            if (!stats.granular[pVersion]) {
                stats.granular[pVersion] = {
                    total: 0,
                    casts: {},
                    failures: { startup: 0, error: 0, other: 0 },
                    avgInteractions: 0,
                    interactionSum: 0,
                    conversationIds: []
                };
            }
            const bucket = stats.granular[pVersion];
            bucket.total++;
            bucket.interactionSum += data.interactionCount;
            bucket.conversationIds.push(convId);

            // Cast Stats
            const castKey = Array.from(data.participants).sort().join(', ') || 'No Cast (Empty)';
            bucket.casts[castKey] = (bucket.casts[castKey] || 0) + 1;

            // Failure Heuristics
            if (data.errors.length > 0) {
                bucket.failures.error++;
            } else if (data.interactionCount === 0) {
                bucket.failures.startup++;
            }
        }

        // Averaging
        for (const key in stats.granular) {
            if (stats.granular[key].total > 0) {
                stats.granular[key].avgInteractions = (stats.granular[key].interactionSum / stats.granular[key].total).toFixed(1);
            }
        }

        // Global Prompt Versions
        for (const k in stats.granular) {
            stats.promptVersions[k] = {
                count: stats.granular[k].total,
                conversationIds: new Set()
            };
        }
    }

    async analyzeDB() {
        // Timestamps
        const getMaxTime = (arr) => (!arr || arr.length === 0) ? null : Math.max(...arr.map(i => i.timestamp || 0));

        // 1. SIMULATION DB
        try {
            const simDb = await open({ filename: SIM_DB_FILE, driver: sqlite3.Database });
            const simFeedback = await simDb.all("SELECT *, 'simulation' as source FROM feedback");
            this.dbStats.feedback.push(...simFeedback);
            this.dbStats.meta.lastUpdatedSim = getMaxTime(simFeedback);
            this.dbStats.detailedFeedback = await simDb.all('SELECT * FROM detailed_feedback');
            this.dbStats.flags = await simDb.all('SELECT * FROM simulation_flags');
            this.dbStats.personas = await simDb.all('SELECT DISTINCT role FROM care_circle_members WHERE role IS NOT NULL');
            try {
                this.dbStats.scenarios = await simDb.all('SELECT DISTINCT name, description FROM simulation_scenarios');
            } catch (e) { /* ignore */ }
            await simDb.close();
        } catch (err) {
            console.warn("Could not read Simulation DB:", err.message);
        }

        // 2. PRODUCTION DB
        try {
            const prodDb = await open({ filename: PROD_DB_FILE, driver: sqlite3.Database });
            const prodFeedback = await prodDb.all("SELECT *, 'production' as source FROM feedback");
            this.dbStats.feedback.push(...prodFeedback);
            this.dbStats.meta.lastUpdatedProd = getMaxTime(prodFeedback);
            await prodDb.close();
        } catch (err) {
            console.warn("Could not read Production DB:", err.message);
        }

        return this.dbStats;
    }

    processTimeSeriesData() {
        const timeSeries = [];
        const aiTimeSeries = [];
        const humanTimeSeries = [];

        for (const [convId, logData] of this.logStats.conversations) {
            const feedbackEntry = this.dbStats.feedback.find(f => f.conversation_id === convId);

            const dataPoint = {
                timestamp: logData.timestamp,
                date: new Date(logData.timestamp).toLocaleString(),
                avgMsgLen: logData.msgLens.length ? logData.msgLens.reduce((a, b) => a + b, 0) / logData.msgLens.length : 0,
                avgRespLen: logData.respLens.length ? logData.respLens.reduce((a, b) => a + b, 0) / logData.respLens.length : 0,
                score: feedbackEntry ? feedbackEntry.score : null,
                errors: logData.errors.length,
                promptVersion: logData.promptVersion,
                modelUsed: logData.modelUsed,
                interactionCount: logData.interactionCount,
                source: feedbackEntry ? feedbackEntry.source : null
            };

            timeSeries.push(dataPoint);

            if (feedbackEntry) {
                if (feedbackEntry.source === 'simulation') {
                    aiTimeSeries.push(dataPoint);
                } else {
                    humanTimeSeries.push(dataPoint);
                }
            }
        }

        timeSeries.sort((a, b) => a.timestamp - b.timestamp);
        aiTimeSeries.sort((a, b) => a.timestamp - b.timestamp);
        humanTimeSeries.sort((a, b) => a.timestamp - b.timestamp);

        return { timeSeries, aiTimeSeries, humanTimeSeries };
    }

    getDefinedPersonas() {
        return {
            'Patients': Object.keys(PATIENT_PERSONAS),
            'Caregivers': Object.keys(CAREGIVER_PERSONAS),
            'Doctors': Object.keys(DOCTOR_PERSONAS),
            'Verbosity/Variations': Object.keys(VERBOSITY_PERSONAS)
        };
    }

    getScenarios() {
        return SCENARIOS;
    }
}
