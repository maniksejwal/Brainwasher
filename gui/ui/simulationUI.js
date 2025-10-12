/**
 * @fileoverview gui/ui/simulationUI.js
 * Handles simulation tab UI rendering and interactions
 */

import { MESSAGES } from '../config/messages.js';

/**
 * Render scenarios dropdown from server data
 */
export function renderScenariosDropdown(scenarios) {
    const select = document.getElementById('scenario-select');
    if (!select) return;
    
    // Group by category
    const categories = {
        basic: { name: '📚 Basic Scenarios', scenarios: [] },
        deception: { name: '🤐 Deception & Hiding Info', scenarios: [] },
        privacy: { name: '🔒 Privacy & Consent', scenarios: [] },
        conflict: { name: '⚠️ Conflicts & Disagreements', scenarios: [] },
        escalation: { name: '🚨 Crisis & Escalation', scenarios: [] },
        longitudinal: { name: '📅 Multi-Session', scenarios: [] },
        complex: { name: '🎭 Complex Multi-User', scenarios: [] },
        stress_test: { name: '⚡ Stress Tests', scenarios: [] }
    };
    
    // Organize scenarios
    Object.entries(scenarios).forEach(([key, scenario]) => {
        if (categories[scenario.category]) {
            categories[scenario.category].scenarios.push({ key, ...scenario });
        }
    });
    
    // Build HTML
    let html = '<option value="random_single">🎲 Random Scenario</option>';
    
    Object.entries(categories).forEach(([catKey, category]) => {
        if (category.scenarios.length > 0) {
            html += `<optgroup label="${category.name}">`;
            category.scenarios.forEach(scenario => {
                const complexity = '⭐'.repeat(scenario.complexity);
                html += `<option value="${scenario.key}">${scenario.name} ${complexity}</option>`;
            });
            html += '</optgroup>';
        }
    });
    
    select.innerHTML = html;
}

/**
 * Show simulation starting state
 */
export function showSimulationStarting(scenarioName, turns, isRandom = false) {
    const resultsDiv = document.getElementById('simulation-results');
    if (!resultsDiv) return;
    
    const turnsText = isRandom ? `${turns} turns (randomly selected)` : `${turns} turns`;
    
    resultsDiv.innerHTML = `
        <div class="simulation-progress" style="padding: 16px; background: var(--gray-50); border-radius: 8px; border-left: 4px solid var(--google-blue);">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 18px;">🔬</span>
                <div>
                    <div style="font-weight: 500; color: var(--google-blue);">Starting simulation...</div>
                    <div style="font-size: 12px; color: var(--gray-700);">
                        Scenario: ${scenarioName}<br>
                        Conversation Length: ${turnsText}
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Show simulation complete summary
 */
export function showSimulationComplete(results) {
    const resultsDiv = document.getElementById('simulation-results');
    const summaryDiv = document.getElementById('simulation-summary');
    const statsDiv = document.getElementById('simulation-stats');
    
    if (!resultsDiv || !summaryDiv || !statsDiv) return;
    
    // Clear progress
    resultsDiv.innerHTML = '';
    
    // Build stats
    const scenarioInfo = results.scenarioName || results.personaName || results.persona || 'Unknown';
    
    statsDiv.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px;">
            <div style="padding: 12px; background: white; border-radius: 4px; border: 1px solid var(--gray-200);">
                <div style="font-size: 11px; color: var(--gray-600); text-transform: uppercase;">Scenario</div>
                <div style="font-weight: 500; margin-top: 4px; font-size: 13px;">${scenarioInfo}</div>
            </div>
            <div style="padding: 12px; background: white; border-radius: 4px; border: 1px solid var(--gray-200);">
                <div style="font-size: 11px; color: var(--gray-600); text-transform: uppercase;">Exchanges</div>
                <div style="font-weight: 500; margin-top: 4px;">${results.turns || 0} turns</div>
            </div>
        </div>
        ${results.complexity ? `
        <div style="padding: 8px 12px; background: white; border-radius: 4px; border: 1px solid var(--gray-200); margin-bottom: 8px; font-size: 13px;">
            <span style="color: var(--gray-600);">Complexity:</span> ${'⭐'.repeat(results.complexity)} (${results.complexity}/5)
        </div>
        ` : ''}
        <div style="padding: 12px; background: var(--green-50); border-radius: 4px; border-left: 4px solid var(--green-500);">
            <div style="color: var(--green-700); font-weight: 500;">✅ Simulation complete!</div>
            <div style="font-size: 12px; color: var(--green-600); margin-top: 4px;">
                Check the <strong>My Feedback</strong> tab to see automatic analysis of response quality, 
                escalation handling, consent enforcement, and empathy scores.
            </div>
        </div>
    `;
    
    summaryDiv.style.display = 'block';
}

/**
 * Show simulation error
 */
export function showSimulationError(error) {
    const resultsDiv = document.getElementById('simulation-results');
    if (!resultsDiv) return;
    
    resultsDiv.innerHTML = `
        <div style="padding: 16px; background: var(--red-50); border-radius: 8px; border-left: 4px solid var(--red-500);">
            <div style="font-weight: 500; color: var(--red-700);">❌ Simulation Error</div>
            <div style="font-size: 13px; color: var(--red-600); margin-top: 4px;">${error.message || error}</div>
        </div>
    `;
}

/**
 * Get selected scenario info
 */
export function getSelectedScenarioInfo() {
    const scenarioSelect = document.getElementById('scenario-select');
    const turnsSelect = document.getElementById('turns-select');
    
    if (!scenarioSelect || !turnsSelect) {
        return null;
    }
    
    const scenarioKey = scenarioSelect.value;
    const scenarioName = scenarioSelect.options[scenarioSelect.selectedIndex].text;
    const turnsValue = turnsSelect.value;
    
    // Handle random turns
    let turns;
    if (turnsValue === 'random') {
        // Random between 3, 5, 10, 15, 20 for variety
        const options = [3, 5, 10, 15, 20];
        turns = options[Math.floor(Math.random() * options.length)];
    } else {
        turns = parseInt(turnsValue);
    }
    
    return { scenarioKey, scenarioName, turns, isRandom: turnsValue === 'random' };
}

