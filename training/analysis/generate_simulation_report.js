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

    await db.close();

    return { feedback, detailedFeedback, flags };
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

function processTimeSeriesData(logStats, dbStats) {
    const timeSeries = [];

    for (const [convId, logData] of logStats.conversations) {
        const feedbackEntry = dbStats.feedback.find(f => f.conversation_id === convId);

        timeSeries.push({
            timestamp: logData.timestamp,
            date: new Date(logData.timestamp).toLocaleString(),
            avgMsgLen: logData.msgLens.length ? logData.msgLens.reduce((a, b) => a + b, 0) / logData.msgLens.length : 0,
            avgRespLen: logData.respLens.length ? logData.respLens.reduce((a, b) => a + b, 0) / logData.respLens.length : 0,
            score: feedbackEntry ? feedbackEntry.score : null,
            errors: logData.errors.length,
            promptVersion: logData.promptVersion,
            modelUsed: logData.modelUsed
        });
    }

    timeSeries.sort((a, b) => a.timestamp - b.timestamp);
    return timeSeries;
}

function generateHTML(logStats, dbStats, timeSeries) {
    const avgScore = dbStats.feedback.length ? (dbStats.feedback.reduce((a, b) => a + b.score, 0) / dbStats.feedback.length).toFixed(2) : "N/A";

    // --- Chart Data Preparation ---
    const labels = timeSeries.map(t => t.date);
    const scores = timeSeries.map(t => t.score);
    const msgLens = timeSeries.map(t => t.avgMsgLen);
    const respLens = timeSeries.map(t => t.avgRespLen);

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


    // --- Scenario Grouping (A/B Tests) ---
    const scenarioGroups = {}; // { "Scenario Name": [ { version, data } ] }
    Object.entries(logStats.granular).forEach(([version, data]) => {
        // Extract base name: remove prefix and timestamp
        // e.g. "simulation_v176226_caregiver_support" -> "caregiver support"
        const match = version.match(/(?:simulation|world)_v\d+_(.+)/);
        const baseName = match ? match[1].replace(/_/g, ' ') : version;

        if (!scenarioGroups[baseName]) scenarioGroups[baseName] = [];
        scenarioGroups[baseName].push({ version, data });
    });

    // --- Generate Scenario HTML with Tabs & Comparison ---
    let scenarioHtml = Object.entries(scenarioGroups).sort((a, b) => b[0].localeCompare(a[0])).map(([baseName, variants]) => {
        // Sort variants by timestamp (newest first) or name?
        // Let's sort by version string for consistency
        variants.sort((a, b) => b.version.localeCompare(a.version));

        // Comparison Table (Only if multiple variants)
        let comparisonTable = '';
        if (variants.length > 1) {
            comparisonTable = `
            <div class="comparison-card">
                <h4>⚖️ Variant Comparison: ${baseName.toUpperCase()}</h4>
                <table>
                    <thead><tr><th>Variant / Version</th><th>Count</th><th>Avg Turns</th><th>Fail Rate</th><th>Avg Score</th></tr></thead>
                    <tbody>
                        ${variants.map(v => {
                const failRate = (((v.data.failures.startup + v.data.failures.error) / v.data.total) * 100).toFixed(1);
                // Get score from timeSeries
                const scores = timeSeries.filter(t => t.promptVersion === v.version && t.score !== null).map(t => t.score);
                const avgS = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : "N/A";
                return `<tr><td>${v.version}</td><td>${v.data.total}</td><td>${v.data.avgInteractions}</td><td>${failRate}%</td><td>${avgS}</td></tr>`;
            }).join('')}
                    </tbody>
                </table>
            </div>`;
        }

        // Individual Cards (Collapsible)
        const variantCards = variants.map(v => {
            const data = v.data;
            const failTotal = data.failures.startup + data.failures.error;
            const failRate = ((failTotal / data.total) * 100).toFixed(1);

            // Date Formatting
            const tsMatch = v.version.match(/_v(\d+)_/);
            let dateStr = "Unknown Date";
            if (tsMatch) {
                const ts = parseInt(tsMatch[1]);
                if (!isNaN(ts)) dateStr = new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            }

            // Feedback Injection
            // Filter detailed feedback for conversations in this bucket
            const bucketFeedback = dbStats.detailedFeedback.filter(f => data.conversationIds.includes(f.conversation_id));
            const feedbackCounts = {};
            bucketFeedback.forEach(f => {
                // Use description or category as key
                const k = f.description || f.category;
                feedbackCounts[k] = (feedbackCounts[k] || 0) + 1;
            });
            const topFeedback = Object.entries(feedbackCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([msg, count]) => `<li>${msg} (${count})</li>`)
                .join('');
            const feedbackSection = topFeedback ?
                `<div style="margin-top:15px; background:#fff3cd; padding:10px; border-radius:4px;">
                    <strong style="color:#856404; display:block; margin-bottom:5px;">⚠️ Top Feedback:</strong>
                    <ul style="margin:0; padding-left:20px; font-size:0.9em;">${topFeedback}</ul>
                </div>` : '';


            return `
             <details class="scenario-details">
                <summary>
                    <div>
                        <span class="summary-title">${v.version}</span>
                        <div style="font-size:0.8em; color:#95a5a6;">${dateStr}</div>
                    </div>
                    <span class="summary-stats">
                        ${data.total} convs | ${data.avgInteractions} turns | <span style="color: ${failRate > 10 ? '#e74c3c' : '#2ecc71'}">${failRate}% fail</span>
                    </span>
                </summary>
                <div class="scenario-card-content">
                    <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 20px;">
                        <div class="stat-card" style="padding: 10px;">
                            <div class="stat-label" style="font-size: 0.75em;">Total Conversations</div>
                            <div class="stat-value" style="font-size: 1.5em; margin-top: 5px;">${data.total}</div>
                        </div>
                        <div class="stat-card" style="padding: 10px;">
                            <div class="stat-label" style="font-size: 0.75em;">Avg Turns</div>
                            <div class="stat-value" style="font-size: 1.5em; margin-top: 5px;">${data.avgInteractions}</div>
                        </div>
                         <div class="stat-card" style="padding: 10px;">
                            <div class="stat-label" style="font-size: 0.75em;">Success Rate</div>
                            <div class="stat-value" style="font-size: 1.5em; margin-top: 5px;">${(100 - failRate).toFixed(1)}%</div>
                        </div>
                    </div>
                    
                    ${feedbackSection}

                    <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-top: 20px;">
                        <div style="flex: 1; min-width: 300px;">
                            <h4 style="margin-top: 0;">👥 Cast Composition</h4>
                            <table class="nested-table">
                                <thead><tr><th>Cast Roles</th><th>Count</th><th>%</th></tr></thead>
                                <tbody>
                                    ${Object.entries(data.casts).sort((a, b) => b[1] - a[1]).map(([cast, count]) => `
                                        <tr><td>${cast}</td><td>${count}</td><td>${((count / data.total) * 100).toFixed(1)}%</td></tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        <div style="flex: 1; min-width: 300px;">
                            <h4 style="margin-top: 0;">❌ Failure Analysis</h4>
                            <table class="nested-table">
                                <thead><tr><th>Type</th><th>Count</th><th>%</th></tr></thead>
                                <tbody>
                                    <tr>
                                        <td><b>Agent Startup Failure (0 turns)</b></td>
                                        <td style="color: ${data.failures.startup > 0 ? '#e74c3c' : 'inherit'};"><b>${data.failures.startup}</b></td>
                                        <td>${((data.failures.startup / data.total) * 100).toFixed(1)}%</td>
                                    </tr>
                                    <tr>
                                        <td><b>System Error</b></td>
                                        <td style="color: ${data.failures.error > 0 ? '#e74c3c' : 'inherit'};"><b>${data.failures.error}</b></td>
                                        <td>${((data.failures.error / data.total) * 100).toFixed(1)}%</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
             </details>`;
        }).join('');

        return `<div class="scenario-group">
            <h3 class="group-title">${baseName} <span style="font-size:0.6em; color:#7f8c8d; font-weight:normal;">(${variants.length} variants)</span></h3>
            ${comparisonTable}
            ${variantCards}
        </div>`;
    }).join('');

    // --- Version Grouping (Inverse of Scenarios) ---
    // Group by the "v<Timestamp>" string
    const versionGroups = {}; // { "v12345": [ { scenarioName, data } ] }
    Object.entries(logStats.granular).forEach(([fullVersionString, data]) => {
        // Extract timestamp version
        const match = fullVersionString.match(/_v(\d+)_/);
        const versionId = match ? `v${match[1]}` : 'v(unknown)';

        // Extract scenario name for the card title
        const matchName = fullVersionString.match(/(?:simulation|world)_v\d+_(.+)/);
        const scenarioName = matchName ? matchName[1].replace(/_/g, ' ') : fullVersionString;

        if (!versionGroups[versionId]) versionGroups[versionId] = [];
        versionGroups[versionId].push({ scenarioName, data });
    });

    // --- Generate Version Matrix HTML ---
    let versionMatrixHtml = Object.entries(versionGroups).sort((a, b) => b[0].localeCompare(a[0])).map(([versionId, scenarios]) => {
        // Overall Stats for this Version
        const totalConvs = scenarios.reduce((sum, s) => sum + s.data.total, 0);
        const totalFailures = scenarios.reduce((sum, s) => sum + s.data.failures.startup + s.data.failures.error, 0);
        const globalFailRate = ((totalFailures / totalConvs) * 100).toFixed(1);

        // Date & Model Info
        let dateStr = "Unknown Date";
        const tsMatch = versionId.match(/v(\d+)/);
        if (tsMatch) {
            const ts = parseInt(tsMatch[1]);
            if (!isNaN(ts)) dateStr = new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }

        // Find common models in this version
        const modelsInVersion = new Set();
        scenarios.forEach(s => {
            s.data.conversationIds.forEach(cid => {
                const c = logStats.conversations.get(cid);
                if (c && c.modelUsed) modelsInVersion.add(c.modelUsed);
            });
        });
        const modelStr = Array.from(modelsInVersion).join(', ') || 'Unknown Model';

        return `<div class="scenario-group">
            <h3 class="group-title">
                ${versionId} 
                <span style="font-size:0.6em; color:#7f8c8d; font-weight:normal; margin-left: 10px;">
                    ${dateStr} | Models: ${modelStr} | (${scenarios.length} scenarios)
                </span>
            </h3>
            
            <div class="comparison-card">
                 <h4>🧪 Scenario Performance Matrix for ${versionId}</h4>
                 <div style="font-size:0.85em; color:#7f8c8d; margin-bottom:10px;">Global Fail Rate: <span style="color: ${globalFailRate > 10 ? '#e74c3c' : '#2ecc71'}">${globalFailRate}%</span></div>
                 <table>
                    <thead><tr><th>Scenario</th><th>Conversations</th><th>Avg Turns</th><th>Fail Rate</th></tr></thead>
                    <tbody>
                        ${scenarios.map(s => {
            const failRate = (((s.data.failures.startup + s.data.failures.error) / s.data.total) * 100).toFixed(1);
            return `<tr><td>${s.scenarioName}</td><td>${s.data.total}</td><td>${s.data.avgInteractions}</td><td>${failRate}%</td></tr>`;
        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    }).join('');

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
        <div class="sidebar-header">Brainwasher Sim</div>
        <div class="nav-item active" onclick="switchTab('dashboard')">📊 Dashboard</div>
        <div class="nav-item" onclick="switchTab('trends')">📈 Trends & Charts</div>
        <div class="nav-item" onclick="switchTab('scenarios')">⚖️ Version Comparison</div>
        <div class="nav-item" onclick="switchTab('versions')">🧪 Scenario Analysis</div>
        
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
                    <div class="stat-label">Avg Feedback Score</div>
                    <div class="stat-value">${avgScore}</div>
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
                <h3>Average Feedback Score</h3>
                <div class="chart-container"><canvas id="scoreChart"></canvas></div>
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

        <!-- SCENARIOS TAB (NOW VERSION COMPARISON) -->
        <div id="scenarios" class="tab-content">
             <h1>Version Comparison (A/B Testing)</h1>
             <p>Side-by-side comparison of different <strong>Prompt Versions</strong> for the same Scenario.</p>
             ${scenarioHtml}
        </div>

        <!-- VERSIONS TAB (NOW SCENARIO ANALYSIS) -->
        <div id="versions" class="tab-content">
             <h1>Scenario Analysis Matrix</h1>
             <p>Analysis of how a specific <strong>System Version</strong> performed across different Scenarios.</p>
             ${versionMatrixHtml}
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

        // Charts
        const commonOptions = { 
            responsive: true, 
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grace: '5%' // Add some breathing room at the top
                }
            }
        };
        
        new Chart(document.getElementById('scoreChart'), {
            type: 'line',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [{
                    label: 'Score', data: ${JSON.stringify(scores)}, 
                    borderColor: '#2ecc71', backgroundColor: 'rgba(46, 204, 113, 0.1)', fill: true, tension: 0.3,
                    spanGaps: true
                }]
            }, options: commonOptions
        });

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
