
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

function groupFlags(flags) {
    const groups = {};

    flags.forEach(flag => {
        let reason = flag.reason.toLowerCase();
        let groupName = flag.flag_type + ": Other";

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
            groupName = `\${flag.flag_type}: \${flag.reason.substring(0, 50)}...`;
        }

        groups[groupName] = (groups[groupName] || 0) + 1;
    });

    return groups;
}

function extractScenarioName(data) {
    if (!data) return "Unknown";

    const pVersion = data.promptVersion || "";
    const convId = data.conversationId || data.conversation_id || "";
    const participants = data.participants || new Set();

    const worldScenarioKeys = [
        'patient_caregiver_swap',
        'family_network_care',
        'sandwich_generation',
        'blended_family_care',
        'complex_family_medical_crisis'
    ];

    const scenarioKey = worldScenarioKeys.find(key =>
        pVersion.includes(key) || convId.includes(key)
    );

    if (scenarioKey) {
        return scenarioKey.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }

    if (pVersion.includes('world') || convId.includes('world')) {
        const idMatch = convId.match(/world_v\d+_(.+)/);
        if (idMatch) return idMatch[1].replace(/_/g, ' ');

        const participantsArr = Array.from(participants);
        if (participantsArr.includes('mom_helen') || participantsArr.includes('sarah')) return "Complex Family Medical Crisis";
        if (participantsArr.includes('stepmom')) return "Blended Family Care Dynamics";
        if (participantsArr.includes('grandma')) return "Family Network Care";

        return "World Scenario";
    }

    const pvMatch = pVersion.match(/(?:simulation|world)_v\d+_(.+)/);
    if (pvMatch) return pvMatch[1].replace(/_/g, ' ');

    const participantsArr = Array.from(participants);
    const mainUser = participantsArr.find(p => p !== 'agent' && p !== 'model' && p !== 'unknown');
    if (mainUser) return mainUser.replace(/_\d+$/, '').replace(/_/g, ' ');

    return pVersion || "Unknown";
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_PATH = path.join(__dirname, '../templates/simulation_report_template.html');
const STYLES_PATH = path.join(__dirname, '../templates/report_styles.css');
const SCRIPTS_PATH = path.join(__dirname, '../templates/report_scripts.js');

export class ReportRenderer {
    render(analyzerResult, timeSeriesData) {
        const { logStats, dbStats, definedPersonasMap, scenarios } = analyzerResult;
        const { timeSeries, aiTimeSeries, humanTimeSeries } = timeSeriesData;

        // Calculate separate averages
        const aiScores = aiTimeSeries.filter(t => t.score !== null).map(t => t.score);
        const humanScores = humanTimeSeries.filter(t => t.score !== null).map(t => t.score);
        const avgAiScore = aiScores.length ? (aiScores.reduce((a, b) => a + b, 0) / aiScores.length).toFixed(2) : "N/A";
        const avgHumanScore = humanScores.length ? (humanScores.reduce((a, b) => a + b, 0) / humanScores.length).toFixed(2) : "N/A";

        // Groupings
        const issueCounts = {};
        dbStats.detailedFeedback.forEach(f => {
            issueCounts[f.category] = (issueCounts[f.category] || 0) + 1;
        });

        const failureRows = Object.entries(issueCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([key, count]) => `
                <tr>
                    <td><b>${key}</b></td>
                    <td>${FAILURE_DEFINITIONS[key] || ''}</td>
                    <td>${count}</td>
                </tr>
            `).join('');

        // Model Stats
        const modelStatsHtml = Object.entries(logStats.models).map(([model, data]) => {
            const modelScores = timeSeries.filter(t => t.modelUsed === model && t.score !== null).map(t => t.score);
            const mAvgScore = modelScores.length ? (modelScores.reduce((a, b) => a + b, 0) / modelScores.length).toFixed(2) : "N/A";
            return `<tr><td><b>${model}</b> (${data.count} runs)</td><td>${mAvgScore}</td></tr>`;
        }).join('');

        // System Errors
        const errorRows = Object.entries(logStats.errors).map(([err, count]) => `
            <tr><td class="error-text">${err}</td><td>${count}</td></tr>
        `).join('');

        // Scenario Grouping
        const scenarioGroups = this._groupScenarios(logStats, timeSeries);
        const scenarioHtml = this._renderScenarioHtml(scenarioGroups, timeSeries);

        // Timestamps
        const lastUpdatedSimStr = dbStats.meta.lastUpdatedSim ? new Date(dbStats.meta.lastUpdatedSim).toLocaleString() : 'Never';
        const lastUpdatedProdStr = dbStats.meta.lastUpdatedProd ? new Date(dbStats.meta.lastUpdatedProd).toLocaleString() : 'Never';

        // Counts
        let totalDefinedPersonas = 0;
        Object.values(definedPersonasMap).forEach(keys => totalDefinedPersonas += keys.length);
        const personaCount = totalDefinedPersonas;
        const scenarioCount = Object.keys(scenarios).length;

        // Read Template and Assets
        let template = '';
        let styles = '';
        let scripts = '';
        try {
            template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
            styles = fs.readFileSync(STYLES_PATH, 'utf-8');
            scripts = fs.readFileSync(SCRIPTS_PATH, 'utf-8');
        } catch (err) {
            console.error('[ReportRenderer] Error reading template/assets:', err.message);
            return '<h1>Error reading report template or assets</h1>';
        }

        // Inject Data
        // Inject Data
        return template
            .replace('STYLES', styles)
            .replace('{{SCRIPTS}}', scripts)
            .replace('{{SIMULATED_RUNS}}', logStats.conversations.size)
            .replace('{{INTERACTIONS_COUNT}}', logStats.interactions)
            .replace('{{AVG_AI_SCORE}}', avgAiScore)
            .replace('{{AI_SCORE_SAMPLES}}', aiScores.length)
            .replace('{{LAST_UPDATED_SIM}}', lastUpdatedSimStr)
            .replace('{{AVG_HUMAN_SCORE}}', avgHumanScore)
            .replace('{{HUMAN_SCORE_SAMPLES}}', humanScores.length)
            .replace('{{LAST_UPDATED_PROD}}', lastUpdatedProdStr)
            .replace(/{{PERSONA_COUNT}}/g, personaCount) // Global replacement for multiple occurrences
            .replace('{{SCENARIO_COUNT}}', scenarioCount)
            .replace('{{CRITICAL_FLAGS}}', dbStats.flags.length)
            .replace('{{MODEL_STATS_ROWS}}', modelStatsHtml)
            .replace('{{FAILURE_CATEGORY_ROWS}}', failureRows)
            .replace('{{SYSTEM_ERROR_ROWS}}', errorRows)
            .replace('{{SCENARIO_HTML}}', scenarioHtml)
            .replace('"__TIME_SERIES_DATA__"', JSON.stringify(timeSeriesData.timeSeries))
            .replace('"__AI_TIME_SERIES__"', JSON.stringify(timeSeriesData.aiTimeSeries))
            .replace('"__HUMAN_TIME_SERIES__"', JSON.stringify(timeSeriesData.humanTimeSeries))
            .replace('"__DEFINED_PERSONAS_MAP__"', JSON.stringify(definedPersonasMap))
            .replace('"__PERSONA_COUNT__"', personaCount) // Use regular replacement for count (becomes number or string)
    }

    _groupScenarios(logStats, timeSeries) {
        const scenarioGroups = {};

        Object.entries(logStats.granular).forEach(([version, data]) => {
            let scenarioName = "Unknown Scenario";
            if (data.conversationIds.length > 0) {
                const firstConvId = data.conversationIds[0];
                const convData = logStats.conversations.get(firstConvId);
                if (convData) {
                    scenarioName = extractScenarioName(convData);
                }
            }

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

        Object.values(scenarioGroups).forEach(versions => {
            versions.sort((a, b) => b.timestamp - a.timestamp);
        });

        return scenarioGroups;
    }

    _renderScenarioHtml(scenarioGroups, timeSeries) {
        return Object.entries(scenarioGroups).sort((a, b) => a[0].localeCompare(b[0])).map(([scenarioName, versions]) => {
            const totalConvs = versions.reduce((sum, v) => sum + v.data.total, 0);
            const totalFailures = versions.reduce((sum, v) => sum + v.data.failures.startup + v.data.failures.error, 0);
            const scenarioFailRate = ((totalFailures / totalConvs) * 100).toFixed(1);

            const versionRows = versions.map(v => {
                const failTotal = v.data.failures.startup + v.data.failures.error;
                const failRate = ((failTotal / v.data.total) * 100).toFixed(1);
                const dateStr = new Date(v.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

                const scores = timeSeries.filter(t => t.promptVersion === v.version && t.score !== null).map(t => t.score);
                const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : "N/A";

                return `
                    <tr style="background: #f9f9f9;">
                        <td style="padding-left: 30px; font-family: monospace; font-size: 0.85em;">\${v.version}</td>
                        <td>\${dateStr}</td>
                        <td>\${v.data.total}</td>
                        <td>\${v.data.avgInteractions}</td>
                        <td style="color: \${failRate > 10 ? '#e74c3c' : '#2ecc71'}">\${failRate}%</td>
                        <td>\${avgScore}</td>
                    </tr>
                `;
            }).join('');

            return `
                <div class="scenario-group" style="margin-bottom: 30px;">
                    <h3 class="group-title" style="background: #ecf0f1; padding: 15px; border-radius: 6px; margin-bottom: 10px;">
                        \${scenarioName} 
                        <span style="font-size:0.6em; color:#7f8c8d; font-weight:normal; margin-left: 10px;">
                            (\${versions.length} versions | \${totalConvs} total runs | \${scenarioFailRate}% fail rate)
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
                            \${versionRows}
                        </tbody>
                    </table>
                </div>
            `;
        }).join('');
    }
}
