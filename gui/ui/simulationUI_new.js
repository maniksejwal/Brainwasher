/**
 * FRESH, SIMPLE Simulation UI
 * Shows simulations exactly like CLI
 */

export function initSimulationUI(api, state) {
    const runButton = document.getElementById('run-simulation');
    const scenarioSelect = document.getElementById('scenario-select');
    const turnsSelect = document.getElementById('turns-select');
    const resultsDiv = document.getElementById('simulation-results');
    
    if (!runButton || !scenarioSelect || !turnsSelect || !resultsDiv) {
        console.error('[SimUI] Required elements not found');
        return;
    }
    
    // Load scenarios
    loadScenarios(api);
    
    // Run simulation
    runButton.addEventListener('click', async () => {
        const scenario = scenarioSelect.value;
        const turns = turnsSelect.value;
        
        if (!scenario) {
            resultsDiv.innerHTML = '<div style="color: red;">Please select a scenario</div>';
            return;
        }
        
        // Clear previous results and reset conversation tracking
        resultsDiv.innerHTML = '';
        conversationMessages.length = 0; // Clear array
        
        const startDiv = document.createElement('div');
        startDiv.style.cssText = 'padding: 16px; background: var(--blue-50); border-radius: 4px;';
        startDiv.innerHTML = '🔬 Starting simulation...';
        resultsDiv.appendChild(startDiv);
        
        runButton.disabled = true;
        
        try {
            const result = await api.runSimulation(scenario, turns);
            runButton.disabled = false;
            
            // Completion message will come via SSE - don't add it here
            
        } catch (error) {
            runButton.disabled = false;
            resultsDiv.innerHTML += `<div style="color: red; padding: 16px; margin-top: 8px;">❌ Error: ${error.message}</div>`;
        }
    });
}

async function loadScenarios(api) {
    const select = document.getElementById('scenario-select');
    try {
        const data = await api.getScenarios();
        select.innerHTML = '';
        
        // Add truly random as first and default option
        const randomOption = document.createElement('option');
        randomOption.value = 'random';
        randomOption.textContent = '🎲 Random (Default)';
        randomOption.selected = true;
        select.appendChild(randomOption);
        
        // Add all scenarios including random_single
        Object.keys(data.scenarios).forEach(key => {
            const scenario = data.scenarios[key];
            const option = document.createElement('option');
            option.value = key;
            option.textContent = scenario.name;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('[SimUI] Failed to load scenarios:', error);
        select.innerHTML = '<option value="random_single">🎲 Random (Fallback)</option>';
    }
}

// Per-message feedback buttons are added inline - no global feedback form needed

// Track conversation messages for feedback
const conversationMessages = [];

// Handle SSE simulation messages
export function displaySimulationMessage(data) {
    console.log('[SimUI] Received SSE data:', data);
    
    const resultsDiv = document.getElementById('simulation-results');
    if (!resultsDiv) {
        console.error('[SimUI] simulation-results div not found!');
        return;
    }
    
    // Remove "starting" message only once
    if (conversationMessages.length === 0) {
        const starting = resultsDiv.querySelector('[style*="blue-50"]');
        if (starting) starting.remove();
    }
    
    console.log('[SimUI] Checking data.details:', data.details);
    console.log('[SimUI] Type:', data.details?.type);
    
    if (data.details?.type === 'simulation_conversation') {
        console.log('[SimUI] Displaying conversation message');
        const conv = data.details;
        
        // Store message for feedback
        conversationMessages.push(conv);
        
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = 'padding: 12px; margin: 8px 0; background: var(--gray-50); border-radius: 8px; border-left: 3px solid var(--blue-500);';
        
        let html = `
            <div style="font-size: 11px; color: var(--gray-600); margin-bottom: 8px; font-weight: 500;">Turn ${conv.turn}/${conv.maxTurns}</div>
            <div style="margin-bottom: 8px;">
                <strong style="color: var(--gray-700);">User:</strong> ${conv.userMessage}
            </div>
            <div style="margin-bottom: 8px;">
                <strong style="color: var(--blue-700);">Agent:</strong> ${conv.agentResponse}
            </div>
        `;
        
        if (conv.action?.type && conv.action.type !== 'NONE') {
            html += `<div style="font-size: 12px; color: var(--orange-600); margin-top: 4px;">⚡ ${conv.action.type}</div>`;
        }
        
        if (conv.feedback) {
            const fb = conv.feedback;
            const scoreColor = fb.overallScore > 0 ? 'var(--green-600)' : fb.overallScore < 0 ? 'var(--red-600)' : 'var(--gray-600)';
            
            html += `
                <div style="margin-top: 12px; padding: 8px; background: white; border-radius: 4px; font-size: 12px; border: 1px solid var(--gray-200);">
                    <div style="font-weight: 500; margin-bottom: 6px;">🤖 AI Feedback:</div>
                    <div style="color: ${scoreColor}; font-weight: 500;">Overall Score: ${fb.overallScore}</div>
                    ${fb.empathyScore !== undefined ? `<div style="margin-top: 2px;">Empathy: ${fb.empathyScore}</div>` : ''}
                    ${fb.escalationScore !== undefined ? `<div style="margin-top: 2px;">Escalation: ${fb.escalationScore}</div>` : ''}
                    ${fb.consentScore !== undefined ? `<div style="margin-top: 2px;">Consent: ${fb.consentScore}</div>` : ''}
                    ${fb.issuesFound > 0 ? `
                        <div style="margin-top: 6px; color: var(--red-600);">
                            <strong>Issues (${fb.issuesFound}):</strong>
                            ${fb.issues.map(issue => `<div style="margin-top: 2px;">• ${issue.category}: ${issue.description}</div>`).join('')}
                        </div>
                    ` : '<div style="margin-top: 6px; color: var(--green-600);">✓ No issues detected</div>'}
                    ${fb.improvementSuggestions ? `
                        <div style="margin-top: 6px; color: var(--blue-600);">
                            <strong>Suggestions:</strong> ${fb.improvementSuggestions}
                        </div>
                    ` : ''}
                </div>
            `;
        }
        
        // Add per-message feedback button
        html += `
            <div style="margin-top: 8px; padding: 8px; background: var(--blue-50); border-radius: 4px;">
                <button class="give-feedback-btn" data-turn="${conv.turn}" style="padding: 4px 12px; background: var(--blue-500); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">
                    💬 Give Feedback on Turn ${conv.turn}
                </button>
                <div class="feedback-form-${conv.turn}" style="display: none; margin-top: 8px;">
                    <select class="turn-score" style="padding: 4px; margin-right: 4px; border: 1px solid var(--gray-300); border-radius: 4px;">
                        <option value="1">👍 Good</option>
                        <option value="0">😐 OK</option>
                        <option value="-1">👎 Bad</option>
                    </select>
                    <input type="text" class="turn-comment" placeholder="What was wrong/right?" style="padding: 4px 8px; flex: 1; border: 1px solid var(--gray-300); border-radius: 4px; width: 60%;">
                    <button class="submit-turn-feedback" data-turn="${conv.turn}" style="padding: 4px 12px; background: var(--green-500); color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 4px;">
                        Send
                    </button>
                </div>
            </div>
        `;
        
        messageDiv.innerHTML = html;
        resultsDiv.appendChild(messageDiv);
        
        // Attach event listeners for this message's feedback
        const feedbackBtn = messageDiv.querySelector('.give-feedback-btn');
        const feedbackForm = messageDiv.querySelector(`.feedback-form-${conv.turn}`);
        const submitBtn = messageDiv.querySelector('.submit-turn-feedback');
        
        feedbackBtn.addEventListener('click', () => {
            feedbackForm.style.display = 'block';
            feedbackBtn.style.display = 'none';
        });
        
        submitBtn.addEventListener('click', async () => {
            const score = parseInt(messageDiv.querySelector('.turn-score').value);
            const comment = messageDiv.querySelector('.turn-comment').value;
            
            try {
                // Get api and state from window
                await window.api.provideFeedback(
                    window.state.userId,
                    `sim_turn_${conv.turn}_${Date.now()}`,
                    score,
                    `[Turn ${conv.turn}] ${comment || 'No comment'}`
                );
                
                feedbackForm.innerHTML = '<div style="color: var(--green-600); font-size: 11px;">✅ Feedback saved!</div>';
            } catch (error) {
                feedbackForm.innerHTML = '<div style="color: var(--red-600); font-size: 11px;">❌ Failed to save</div>';
            }
        });
        
        // Scroll to bottom
        resultsDiv.scrollTop = resultsDiv.scrollHeight;
    } else if (data.details?.complete) {
        // Simulation complete - messages stay visible, just add completion notice
        console.log('[SimUI] Simulation complete');
        const completeDiv = document.createElement('div');
        completeDiv.style.cssText = 'padding: 12px; background: var(--green-50); border-radius: 4px; margin-top: 16px; border-left: 3px solid var(--green-500);';
        completeDiv.innerHTML = '<div style="font-weight: 500; color: var(--green-700);">✅ Simulation complete! Review messages above and provide feedback on specific turns.</div>';
        resultsDiv.appendChild(completeDiv);
        resultsDiv.scrollTop = resultsDiv.scrollHeight;
    } else {
        // Other progress messages - log but don't display to avoid clutter
        console.log('[SimUI] Progress:', data.description);
    }
}
