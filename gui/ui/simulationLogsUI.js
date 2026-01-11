/**
 * @fileoverview gui/ui/simulationLogsUI.js
 * Logic for the "Conversation Logs" tab in the Simulation Report.
 */

import { MESSAGES } from '../config/messages.js';

export function initSimulationLogsUI(api) {
    const tabButton = document.querySelector('button[data-tab="reports"]'); // Assuming we hook into Reports or a new Logs tab
    // Ideally we want a specific sub-tab or main tab for this.
    // For now, let's assume we render this inside the "reports" container or a new "simulation-logs" container.
}

export async function loadConversationLogs(api) {
    const container = document.getElementById('simulation-logs-container');
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading simulation history...</div>';

    try {
        // Fetch simulations (assuming endpoint exists, or we use a direct DB query via API)
        // If /api/simulations doesn't exist, we might need to use /api/logs with a filter
        const response = await fetch('/api/simulations/history');
        let sessions = [];

        if (response.ok) {
            const data = await response.json();
            sessions = data.sessions || [];
        } else {
            // Fallback or mock for now if endpoint isn't ready
            sessions = [];
            container.innerHTML = '<div class="error">Failed to load history. Endpoint /api/simulations/history not found.</div>';
            return;
        }

        if (sessions.length === 0) {
            container.innerHTML = '<div class="empty-state">No simulation logs found. Run a simulation to see logs here.</div>';
            return;
        }

        renderSessionList(container, sessions);

    } catch (error) {
        container.innerHTML = `<div class="error">Error loading logs: ${error.message}</div>`;
    }
}

function renderSessionList(container, sessions) {
    const listHtml = sessions.map(session => `
        <div class="session-item" data-id="${session.id}" style="border: 1px solid #eee; padding: 10px; margin-bottom: 8px; border-radius: 4px; cursor: pointer;">
            <div style="display:flex; justify-content:space-between;">
                <strong>Scenario: ${session.scenario || 'Unknown'}</strong>
                <span>${new Date(session.timestamp).toLocaleString()}</span>
            </div>
            <div style="font-size: 12px; color: #666;">
                Score: ${session.score !== undefined ? session.score.toFixed(2) : 'N/A'} | Turns: ${session.turns}
            </div>
            <div class="session-details" id="details-${session.id}" style="display:none; margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px;">
                Loading details...
            </div>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="sessions-list">
            <h3>Simulation History</h3>
            ${listHtml}
        </div>
    `;

    // Add click handlers
    container.querySelectorAll('.session-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Toggle details
            const details = item.querySelector('.session-details');
            const isVisible = details.style.display === 'block';

            // Hide all others
            container.querySelectorAll('.session-details').forEach(d => d.style.display = 'none');

            if (!isVisible) {
                details.style.display = 'block';
                loadSessionDetails(item.dataset.id, details);
            }
        });
    });
}

async function loadSessionDetails(sessionId, container) {
    try {
        const response = await fetch(`/api/simulations/${sessionId}/logs`);
        if (response.ok) {
            const data = await response.json();
            const logs = data.logs || [];

            container.innerHTML = logs.map(log => `
                <div class="log-entry" style="font-family: monospace; font-size: 11px; margin-bottom: 8px; padding: 8px; background: ${log.role === 'user' ? '#eef' : (log.role === 'assistant' ? '#fee' : '#f5f5f5')}; border-left: 3px solid ${log.role === 'user' ? '#4285f4' : (log.role === 'assistant' ? '#ea4335' : '#9aa0a6')}; border-radius: 4px;">
                    <div style="margin-bottom: 4px; color: #555; font-weight: 600;">
                        ${log.speaker} <span style="color: #999;">➡</span> ${log.target}
                    </div>
                    <div style="white-space: pre-wrap;">${log.content}</div>
                </div>
            `).join('');
        } else {
            container.innerHTML = 'Failed to load details.';
        }
    } catch (e) {
        container.innerHTML = 'Error loading details.';
    }
}
