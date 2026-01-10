import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(__dirname, '../training_log.jsonl');
const DB_FILE = path.join(__dirname, '../../care_circle_simulation.db');
const REPORT_FILE = path.join(__dirname, 'reports/simulation_report.html');

// Failure Category Definitions
const FAILURE_DEFINITIONS = {
    'critical_failure': 'Severe issues that require immediate attention (safety, escalation failures).',
    'escalation': 'Issues related to identifying and acting on urgent medical symptoms.',
    'empathy_loop': 'The agent gets stuck in a loop of repetitive empathetic statements without progressing.',
    'verbosity': 'The agent is too wordy or provides overwhelming information.',
    'generic_response': 'The response is too generic and lacks personalization or context awareness.',
    'information_gathering': 'Failed to ask necessary probing questions or gather key details.',
    'conversation_quality': 'General issues with flow, tone, or engagement.',
    'failure_memory_leakage': 'Agent referenced information from a different user or session invalidly.',
    'denial': 'Agent failed to handle patient denial of symptoms correctly.',
    'vagueness': 'Response lacked specificity or actionable advice.',
    'failure_enabling_misconception': 'Agent failed to correct or validated a harmful medical misconception.',
    'failure_missing_escalation': 'Critical failure: Agent missed a clear escalation trigger.'
};

async function analyzeLogs() {
    const fileStream = fs.createReadStream(LOG_FILE);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const stats = {
        totalLines: 0,
        conversations: new Map(),
        users: new Set(),
        errors: {},
        interactions: 0,
        promptVersions: {}, // Global breakdown
        models: {},         // NEW: { modelName: { count: 0, conversationIds: Set } }
        granular: {} // { promptVersion: { total: 0, casts: {}, failures: { startup: 0, error: 0, partial: 0 }, interactionCounts: [] } }
    };

    for await (const line of rl) {
        try {
            const entry = JSON.parse(line);
            stats.totalLines++;

            if (entry.conversation_id) {
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
                        modelUsed: entry.model_used || 'unknown', // Capture model
                        participants: new Set(),
                        roleCounts: {}
                    });
                }
                const convData = stats.conversations.get(entry.conversation_id);

                // Update model if it was unknown (e.g. from previous log entries) and now appears
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

                // 5. Interaction Count
                if (entry.message && entry.agent_response) {
                    stats.interactions++;
                    convData.interactionCount++;
                }

                // 6. Prompt Version Tracking
                const pVersion = entry.prompt_version || 'unknown';

                // 7. Scenario Inference logic
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

        } catch (e) {
            // Ignore parse errors
        }
    }

    // Post-process conversations to build Granular Stats
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

        // Initialize Granular Bucket
        if (!stats.granular[pVersion]) {
            stats.granular[pVersion] = {
                total: 0,
                casts: {}, // { "patient, caregiver": count }
                failures: {
                    startup: 0, // 0 interactions
                    error: 0,   // logged errors
                    other: 0
                },
                avgInteractions: 0,
                interactionSum: 0,
                conversationIds: [] // Track IDs for feedback lookup
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

    // Global Prompt Versions (Legacy support)
    for (const k in stats.granular) {
        stats.promptVersions[k] = {
            count: stats.granular[k].total,
            conversationIds: new Set() // Placeholder as we don't strictly need list for report
        };
    }

    return stats;
}

async function analyzeDB() {
    const db = await open({
        filename: DB_FILE,
        driver: sqlite3.Database
    });

    const feedback = await db.all('SELECT * FROM feedback');

    let detailedFeedback = [];
    try {
        detailedFeedback = await db.all('SELECT * FROM detailed_feedback');
    } catch (err) {
        console.warn("Could not query detailed_feedback table.");
    }

    let flags = [];
    try {
        flags = await db.all('SELECT * FROM simulation_flags');
    } catch (err) {
        console.warn("Could not query simulation_flags table.");
    }

    // Query actual personas from DB
    let personas = [];
    try {
        personas = await db.all('SELECT DISTINCT role FROM care_circle_members WHERE role IS NOT NULL');
    } catch (err) {
        console.warn("Could not query personas from care_circle_members.");
    }

    // Query scenarios from simulation worlds/scenarios table if it exists
    let scenarios = [];
    try {
        scenarios = await db.all('SELECT DISTINCT name, description FROM simulation_scenarios');
    } catch (err) {
        // Table might not exist, scenarios will be inferred from logs
        console.warn("Could not query simulation_scenarios table.");
    }

    await db.close();

    return { feedback, detailedFeedback, flags, personas, scenarios };
}

function groupFlags(flags) {
    const groups = {}; // { groupName: count }

    flags.forEach(flag => {
        let reason = flag.reason.toLowerCase();

        // Semantic Grouping Logic
        let groupName = flag.flag_type + ": Other"; // Default

        if (reason.includes('empathy') || reason.includes('emotional')) {
            groupName = "Lack of Empathy / Emotional Intelligence";
        } else if (reason.includes('depth') || reason.includes('generic') || reason.includes('specificity')) {
            groupName = "Lack of Depth / Generic Response";
        } else if (reason.includes('escalat') || reason.includes('urgent') || reason.includes('symptom')) {
            groupName = "Escalation Failure";
        } else if (reason.includes('probing') || reason.includes('question') || reason.includes('information')) {
            groupName = "Information Gathering Failure";
        } else if (reason.includes('leakage') || reason.includes('other user')) {
            groupName = "Data Leakage";
        } else if (reason.includes('denial')) {
            groupName = "Handling Denial Failure";
        } else {
            // Fallback to raw simplified reason if no category matches
            groupName = `${flag.flag_type}: ${flag.reason.substring(0, 50)}...`;
        }

        groups[groupName] = (groups[groupName] || 0) + 1;
    });

    return groups;
}

function extractScenarioName(data) {
    // Priority 1: If promptVersion contains a known scenario key from world_scenarios.js
    // Known world scenarios: patient_caregiver_swap, family_network_care, sandwich_generation, blended_family_care, complex_family_medical_crisis
    const worldScenarioKeys = ['patient_caregiver_swap', 'family_network_care', 'sandwich_generation', 'blended_family_care', 'complex_family_medical_crisis'];

    for (const key of worldScenarioKeys) {
        if (data.promptVersion.includes(key)) {
            // Convert snake_case to Title Case
            return key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        }
    }

    // Priority 2: If promptVersion contains the scenario name (non-timestamped part)
    // format: simulation_v<timestamp>_<scenario_name> or world_v<timestamp>
    const pvMatch = data.promptVersion.match(/(?:simulation|world)_v\d+_(.+)/);
    if (pvMatch) return pvMatch[1].replace(/_/g, ' ');

    // Priority 3: If it's just "world_v<timestamp>", return "World"
    if (data.promptVersion.match(/^world_v\d+$/)) return "World";

    // Priority 4: From conversation_id or participants
    const participants = Array.from(data.participants);
    const mainUser = participants.find(p => p !== 'agent' && p !== 'model' && p !== 'unknown');
    if (mainUser) return mainUser.replace(/_\d+$/, '').replace(/_/g, ' '); // remove trailing numbers

    return data.promptVersion; // Fallback
}

function processTimeSeriesData(logStats, dbStats) {
    const timeSeries = [];
    const aiTimeSeries = [];
    const humanTimeSeries = [];

    for (const [convId, logData] of logStats.conversations) {
        const feedbackEntry = dbStats.feedback.find(f => f.conversation_id === convId);

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

        // Separate by feedback source
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

function generateHTML(logStats, dbStats, timeSeriesData) {
    const { timeSeries, aiTimeSeries, humanTimeSeries } = timeSeriesData;

    // Calculate separate averages
    const aiScores = aiTimeSeries.filter(t => t.score !== null).map(t => t.score);
    const humanScores = humanTimeSeries.filter(t => t.score !== null).map(t => t.score);
    const avgAiScore = aiScores.length ? (aiScores.reduce((a, b) => a + b, 0) / aiScores.length).toFixed(2) : "N/A";
    const avgHumanScore = humanScores.length ? (humanScores.reduce((a, b) => a + b, 0) / humanScores.length).toFixed(2) : "N/A";

    // --- Chart Data Preparation ---
    const labels = timeSeries.map(t => t.date);
    const aiLabels = aiTimeSeries.map(t => t.date);
    const humanLabels = humanTimeSeries.map(t => t.date);
    const aiScoresChart = aiTimeSeries.map(t => t.score);
    const humanScoresChart = humanTimeSeries.map(t => t.score);
    const msgLens = timeSeries.map(t => t.avgMsgLen);
    const respLens = timeSeries.map(t => t.avgRespLen);
    const interactionCounts = timeSeries.map(t => t.interactionCount);

    // --- Groupings ---
    const flagGroups = groupFlags(dbStats.flags);
    const issueCounts = {};
    dbStats.detailedFeedback.forEach(f => {
        issueCounts[f.category] = (issueCounts[f.category] || 0) + 1;
    });

    // --- Human Feedback Extraction ---
    const humanFeedback = dbStats.detailedFeedback.filter(f => f.source && f.source !== 'simulation');

    // --- Prompt Version Stats ---
    const promptStatsHtml = Object.entries(logStats.promptVersions).map(([version, data]) => {
        // Calculate avg score for this version
        const versionScores = timeSeries.filter(t => t.promptVersion === version && t.score !== null).map(t => t.score);
        const vAvgScore = versionScores.length ? (versionScores.reduce((a, b) => a + b, 0) / versionScores.length).toFixed(2) : "N/A";
        return `<tr><td>${version}</td><td>${data.count}</td><td>${data.conversationIds.size}</td><td>${vAvgScore}</td></tr>`;
    }).join('');

    // --- Model Stats ---
    const modelStatsHtml = Object.entries(logStats.models).map(([model, data]) => {
        // Calculate avg score for this model
        const modelScores = timeSeries.filter(t => t.modelUsed === model && t.score !== null).map(t => t.score);
        const mAvgScore = modelScores.length ? (modelScores.reduce((a, b) => a + b, 0) / modelScores.length).toFixed(2) : "N/A";
        return `<tr><td>${model}</td><td>${data.count}</td><td>${data.conversationIds.size}</td><td>${mAvgScore}</td></tr>`;
    }).join('');


    // --- Scenario Grouping (Restructured Hierarchy) ---
    // NEW STRUCTURE: Scenario Name -> Versions (timestamped runs)
    const scenarioGroups = {}; // { "Scenario Name": [ { version, timestamp, data } ] }

    Object.entries(logStats.granular).forEach(([version, data]) => {
        // Extract scenario name from first conversation
        let scenarioName = "Unknown Scenario";
        if (data.conversationIds.length > 0) {
            const firstConvId = data.conversationIds[0];
            const convData = logStats.conversations.get(firstConvId);
            if (convData) {
                scenarioName = extractScenarioName(convData);
            }
        }

        // Extract timestamp from version string or conversation data
        let timestamp = Date.now();
        const tsMatch = version.match(/_v(\d+)_/);
        if (tsMatch) {
            timestamp = parseInt(tsMatch[1]);
        } else if (data.conversationIds.length > 0) {
            const firstConvId = data.conversationIds[0];
            const convData = logStats.conversations.get(firstConvId);
            if (convData && convData.timestamp) {
                timestamp = convData.timestamp;
            }
        }

        if (!scenarioGroups[scenarioName]) scenarioGroups[scenarioName] = [];
        scenarioGroups[scenarioName].push({ version, timestamp, data });
    });

    // Sort versions within each scenario by timestamp (newest first)
    Object.values(scenarioGroups).forEach(versions => {
        versions.sort((a, b) => b.timestamp - a.timestamp);
    });

    // --- Generate Scenario HTML (Restructured: Scenario -> Versions) ---
    let scenarioHtml = Object.entries(scenarioGroups).sort((a, b) => a[0].localeCompare(b[0])).map(([scenarioName, versions]) => {
        // Calculate aggregate stats for this scenario
        const totalConvs = versions.reduce((sum, v) => sum + v.data.total, 0);
        const totalFailures = versions.reduce((sum, v) => sum + v.data.failures.startup + v.data.failures.error, 0);
        const scenarioFailRate = ((totalFailures / totalConvs) * 100).toFixed(1);

        // Version rows (nested under scenario)
        const versionRows = versions.map(v => {
            const failTotal = v.data.failures.startup + v.data.failures.error;
            const failRate = ((failTotal / v.data.total) * 100).toFixed(1);
            const dateStr = new Date(v.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

            // Get score from timeSeries
            const scores = timeSeries.filter(t => t.promptVersion === v.version && t.score !== null).map(t => t.score);
            const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : "N/A";

            return `
                <tr style="background: #f9f9f9;">
                    <td style="padding-left: 30px; font-family: monospace; font-size: 0.85em;">${v.version}</td>
                    <td>${dateStr}</td>
                    <td>${v.data.total}</td>
                    <td>${v.data.avgInteractions}</td>
                    <td style="color: ${failRate > 10 ? '#e74c3c' : '#2ecc71'}">${failRate}%</td>
                    <td>${avgScore}</td>
                </tr>
            `;
        }).join('');

        return `
            <div class="scenario-group" style="margin-bottom: 30px;">
                <h3 class="group-title" style="background: #ecf0f1; padding: 15px; border-radius: 6px; margin-bottom: 10px;">
                    ${scenarioName} 
                    <span style="font-size:0.6em; color:#7f8c8d; font-weight:normal; margin-left: 10px;">
                        (${versions.length} versions | ${totalConvs} total runs | ${scenarioFailRate}% fail rate)
                    </span>
                </h3>
                <table style="width: 100%; margin-bottom: 20px;">
                    <thead>
                        <tr>
                            <th>Version</th>
                            <th>Date</th>
                            <th>Runs</th>
                            <th>Avg Turns</th>
                            <th>Fail Rate</th>
                            <th>Avg Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${versionRows}
                    </tbody>
                </table>
            </div>
        `;
    }).join('');

    // User wants only Scenario Analysis tab, not Version Comparison
    const versionMatrixHtml = ''; // Empty - tab will be removed

    // --- Groupings (flagGroups already declared earlier) ---

    return `<!DOCTYPE html>
<html>
<head>
    <title>Simulation Analysis Report (Enhanced)</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background-color: #f4f4f9; color: #333; line-height: 1.6; display: flex; height: 100vh; overflow: hidden; }
        
        /* Sidebar Navigation */
        .sidebar { width: 250px; background: #2c3e50; color: #ecf0f1; flex-shrink: 0; display: flex; flex-direction: column; overflow-y: auto; }
        .sidebar-header { padding: 20px; font-size: 1.2em; font-weight: bold; border-bottom: 1px solid #34495e; }
        .nav-item { padding: 15px 20px; cursor: pointer; transition: background 0.2s; border-left: 4px solid transparent; }
        .nav-item:hover { background: #34495e; }
        .nav-item.active { background: #34495e; border-left-color: #3498db; }
        
        .sidebar-footer { margin-top: auto; padding: 20px; border-top: 1px solid #34495e; font-size: 0.8em; color: #bdc3c7; }
        .metric-def { margin-bottom: 10px; }
        .metric-def strong { color: #fff; display: block; }
        
        /* Main Content */
        .main-content { flex: 1; overflow-y: auto; padding: 40px; position: relative; }
        .tab-content { display: none; animation: fadeIn 0.3s; }
        .tab-content.active { display: block; }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        .container { max-width: 1200px; margin: 0 auto; }
        h1, h2, h3 { color: #2c3e50; }
        h1 { margin-top: 0; border-bottom: 2px solid #eee; padding-bottom: 15px; }
        
        /* Stats Grid */
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); text-align: center; }
        .stat-value { font-size: 28px; font-weight: bold; color: #3498db; }
        .stat-label { color: #7f8c8d; font-size: 0.85em; text-transform: uppercase; }

        /* Tables */
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; font-weight: 600; }
        
        /* Charts */
        .chart-section { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); margin-bottom: 30px; }
        .chart-container { position: relative; height: 350px; }

        /* Scenarios & A/B */
        .scenario-group { margin-bottom: 40px; padding-bottom: 20px; border-bottom: 1px solid #e0e0e0; }
        .group-title { margin-bottom: 15px; display: flex; align-items: baseline; gap: 10px; }
        
        .comparison-card { background: #eaf2f8; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #d6eaf8; }
        .comparison-card h4 { margin-top: 0; color: #2980b9; }
        .comparison-card table { background: transparent; box-shadow: none; margin-bottom: 0; }
        .comparison-card th { background: rgba(255,255,255,0.5); }

        .scenario-details { background: #fff; border: 1px solid #eee; border-radius: 6px; margin-bottom: 10px; overflow: hidden; }
        .scenario-details summary { padding: 15px; cursor: pointer; background: #fdfdfd; display: flex; justify-content: space-between; align-items: center; user-select: none; }
        .scenario-details summary:hover { background: #f9f9f9; }
        .summary-title { font-weight: 600; font-family: monospace; color: #2c3e50; }
        .summary-stats { font-size: 0.9em; color: #7f8c8d; }
        .scenario-card-content { padding: 20px; border-top: 1px solid #eee; }
        
        .error-text { color: #e74c3c; font-family: monospace; }
        .human-feedback-card { border-left: 4px solid #f39c12; background-color: #fef9e7; padding: 15px; margin-bottom: 15px; }

        /* Info Tooltip */
        .info-icon { cursor: pointer; color: #95a5a6; margin-left: 5px; font-size: 0.8em; position: relative; }
        .info-icon:hover { color: #2c3e50; }
        .info-icon:hover::after {
            content: attr(tooltip);
            position: absolute;
            bottom: 120%;
            left: 50%;
            transform: translateX(-50%);
            background: #34495e;
            color: #fff;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            white-space: nowrap;
            z-index: 100;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            text-transform: none;
            font-weight: normal;
        }
    </style>
</head>
<body>
    <div class="sidebar">
        <div class="sidebar-header">Statistics</div>
        <div class="nav-item active" onclick="switchTab('dashboard')">📊 Dashboard</div>
        <div class="nav-item" onclick="switchTab('trends')">📈 Trends & Charts</div>
        <div class="nav-item" onclick="switchTab('scenarios')">🧪 Scenario Analysis</div>
        
    </div>

    <div class="main-content">
        <!-- DASHBOARD TAB -->
        <div id="dashboard" class="tab-content active">
            <h1>Simulation Dashboard</h1>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">
                        Conversations 
                        <span class="info-icon" tooltip="Unique simulation sessions (1 full run)">ⓘ</span>
                    </div>
                    <div class="stat-value">${logStats.conversations.size}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">
                        Interactions
                        <span class="info-icon" tooltip="Total turns (User + Agent pairs) across all sessions">ⓘ</span>
                    </div>
                    <div class="stat-value">${logStats.interactions}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">AI Feedback Score</div>
                    <div class="stat-value" style="color: #3498db;">${avgAiScore}</div>
                    <div style="font-size: 0.7em; color: #7f8c8d; margin-top: 4px;">${aiScores.length} samples</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Human Feedback Score</div>
                    <div class="stat-value" style="color: #9b59b6;">${avgHumanScore}</div>
                    <div style="font-size: 0.7em; color: #7f8c8d; margin-top: 4px;">${humanScores.length} samples</div>
                </div>
                 <div class="stat-card">
                    <div class="stat-label">
                        Critical Flags
                         <span class="info-icon" tooltip="High-severity issues like Safety violations or Escalation failures">ⓘ</span>
                    </div>
                    <div class="stat-value" style="color: #e74c3c;">${dbStats.flags.length}</div>
                </div>
            </div>

            <h2>🤖 Model Performance</h2>
             <table>
                <thead><tr><th>Model</th><th>Conversations</th><th>Unique Scenarios</th><th>Avg. Score</th></tr></thead>
                <tbody>${modelStatsHtml}</tbody>
            </table>

            <div class="stats-grid" style="margin-top: 20px;">
                 <div class="stat-card clickable" onclick="showPersonasList()" style="cursor: pointer; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                    <div class="stat-label">User Personas 👁️</div>
                    <div class="stat-value">${logStats.users.size}</div>
                    <div style="font-size: 0.7em; color: #3498db; margin-top: 4px;">Click to view list</div>
                </div>
                 <div class="stat-card clickable" onclick="showScenariosList()" style="cursor: pointer; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                    <div class="stat-label">Unique Scenarios 👁️</div>
                    <div class="stat-value">${Object.keys(scenarioGroups).length}</div>
                    <div style="font-size: 0.7em; color: #3498db; margin-top: 4px;">Click to view list</div>
                </div>
            </div>

            <h2>🚨 Top Failure Categories</h2>
            <table>
                <thead><tr><th>Category</th><th>Description</th><th>Count</th></tr></thead>
                <tbody>
                    ${Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, count]) => `
                        <tr>
                            <td><b>${key}</b></td>
                            <td>${FAILURE_DEFINITIONS[key] || ''}</td>
                            <td>${count}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <!-- TRENDS TAB -->
        <div id="trends" class="tab-content">
            <h1>Performance Trends</h1>
            <div class="chart-section">
                <h3>Feedback Scores Over Time</h3>
                <p style="font-size: 0.9em; color: #7f8c8d; margin-bottom: 10px;">Separate views for AI-generated vs Human feedback</p>
                <div class="chart-container"><canvas id="scoreChart"></canvas></div>
            </div>
            <div class="chart-section">
                <h3>Message & Turn Statistics</h3>
                <div class="chart-container"><canvas id="statsChart"></canvas></div>
            </div>
            <div class="chart-section">
                <h3>Interaction Lengths</h3>
                <div class="chart-container"><canvas id="lengthChart"></canvas></div>
            </div>
             <h2>System Errors</h2>
            <table>
                <thead><tr><th>Error Message</th><th>Count</th></tr></thead>
                <tbody>
                    ${Object.entries(logStats.errors).map(([err, count]) => `
                        <tr><td class="error-text">${err}</td><td>${count}</td></tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <!-- SCENARIOS TAB (NOW SCENARIO ANALYSIS) -->
        <div id="scenarios" class="tab-content">
             <h1>Scenario Analysis</h1>
             <p>Analysis of each <strong>Scenario</strong> across different system versions and variants.</p>
             ${scenarioHtml}
        </div>

        </div>
    </div>

    <!-- Modal for Personas/Scenarios Lists -->
    <div id="listModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;">
        <div style="background: white; padding: 30px; border-radius: 12px; max-width: 600px; max-height: 80vh; overflow-y: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.3);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h2 id="modalTitle" style="margin: 0;"></h2>
                <button onclick="closeModal()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #7f8c8d;">&times;</button>
            </div>
            <div id="modalContent"></div>
        </div>
    </div>

    <script>
        function switchTab(tabId) {
            // Hide all tabs
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            
            // Show selected
            document.getElementById(tabId).classList.add('active');
            event.currentTarget.classList.add('active');
        }

        // Interactive modal functions - Using DB data
        function showPersonasList() {
            // Use DB personas if available, fallback to log data
            const dbPersonas = ${JSON.stringify((dbStats.personas || []).map(p => p.role))};
            const logPersonas = ${JSON.stringify(Array.from(logStats.users))};
            const personas = dbPersonas.length > 0 ? dbPersonas : logPersonas;
            
            document.getElementById('modalTitle').textContent = 'User Personas (' + personas.length + ')';
            document.getElementById('modalContent').innerHTML = '<ul style="list-style: none; padding: 0;">' +
                personas.map(p => '<li style="padding: 8px; border-bottom: 1px solid #eee;">' + p + '</li>').join('') +
                '</ul>';
            document.getElementById('listModal').style.display = 'flex';
        }

        function showScenariosList() {
            // Use DB scenarios if available, fallback to inferred scenarios from logs
            const dbScenarios = ${JSON.stringify((dbStats.scenarios || []).map(s => ({ name: s.name, description: s.description || '' })))};
            const logScenarios = ${JSON.stringify(Object.keys(scenarioGroups).map(name => ({ name, count: scenarioGroups[name].reduce((sum, v) => sum + v.data.total, 0) })))};
            
            const scenarios = dbScenarios.length > 0 ? dbScenarios : logScenarios;
            
            document.getElementById('modalTitle').textContent = 'Unique Scenarios (' + scenarios.length + ')';
            if (dbScenarios.length > 0) {
                // DB scenarios - show name and description
                document.getElementById('modalContent').innerHTML = '<ul style="list-style: none; padding: 0;">' +
                    scenarios.map(s => '<li style="padding: 12px; border-bottom: 1px solid #eee;"><strong>' + s.name + '</strong>' + 
                        (s.description ? '<div style="font-size: 0.85em; color: #7f8c8d; margin-top: 4px;">' + s.description + '</div>' : '') + 
                        '</li>').join('') +
                    '</ul>';
            } else {
                // Log scenarios - show name and run count
                document.getElementById('modalContent').innerHTML = '<ul style="list-style: none; padding: 0;">' +
                    scenarios.map(s => '<li style="padding: 8px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between;"><span>' + s.name + '</span><span style="color: #7f8c8d;">' + s.count + ' runs</span></li>').join('') +
                    '</ul>';
            }
            document.getElementById('listModal').style.display = 'flex';
        }

        function closeModal() {
            document.getElementById('listModal').style.display = 'none';
        }

        // Charts
        const commonOptions = { 
            responsive: true, 
            maintainAspectRatio: false,
            scales: {
                y: {
                    // removed beginAtZero to allow negative values if feedback is centered around 0
                    grace: '5%' 
                }
            }
        };
        
        // Feedback Score Chart - Separated AI vs Human
        new Chart(document.getElementById('scoreChart'), {
            type: 'line',
            data: {
                labels: ${JSON.stringify(aiLabels)},
                datasets: [
                    {
                        label: 'AI Feedback Score',
                        data: ${JSON.stringify(aiScoresChart)},
                        borderColor: '#3498db',
                        backgroundColor: 'rgba(52, 152, 219, 0.1)',
                        fill: true,
                        tension: 0.3,
                        spanGaps: true
                    },
                    {
                        label: 'Human Feedback Score',
                        data: ${JSON.stringify(humanScoresChart)},
                        borderColor: '#9b59b6',
                        backgroundColor: 'rgba(155, 89, 182, 0.1)',
                        fill: true,
                        tension: 0.3,
                        spanGaps: true
                    }
                ]
            },
            options: commonOptions
        });

        // Message & Turn Statistics Chart
        new Chart(document.getElementById('statsChart'), {
            type: 'line',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [
                    {
                        label: 'Avg Message Length',
                        data: ${JSON.stringify(msgLens)},
                        borderColor: '#e74c3c',
                        fill: false,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Avg Response Length',
                        data: ${JSON.stringify(respLens)},
                        borderColor: '#f39c12',
                        fill: false,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Interaction Count',
                        data: ${JSON.stringify(interactionCounts)},
                        borderColor: '#2ecc71',
                        fill: false,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: 'Character Count' }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: 'Turn Count' },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });

        // Interaction Lengths Chart
        new Chart(document.getElementById('lengthChart'), {
            type: 'line',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [
                    { label: 'User Msg Len', data: ${JSON.stringify(msgLens)}, borderColor: '#3498db', fill: false },
                    { label: 'Agent Resp Len', data: ${JSON.stringify(respLens)}, borderColor: '#9b59b6', fill: false }
                ]
            }, options: commonOptions
        });
    </script>
</body>
</html>`;
}

async function main() {
    console.log("Analyzing logs...");
    const logStats = await analyzeLogs();

    console.log("Analyzing database...");
    const dbStats = await analyzeDB();

    console.log("Processing time series...");
    const timeSeries = processTimeSeriesData(logStats, dbStats);

    console.log("Generating HTML report...");
    const report = generateHTML(logStats, dbStats, timeSeries);

    const outputDir = path.dirname(REPORT_FILE);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(REPORT_FILE, report);
    console.log(`Report generated at ${path.resolve(REPORT_FILE)}`);
}

main().catch(console.error);
