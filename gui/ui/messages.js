/**
 * @fileoverview UI message display functions
 */

import { MESSAGES } from '../config/messages.js';

export function displayMessage(data) {
    const container = document.getElementById('messages');
    if (window && window.localStorage && window.localStorage.getItem('DEBUG_GUI')) {
        console.log('[GUI] SSE message:', data);
    }
    const div = document.createElement('div');
    div.className = 'message agent';
    
    const header = document.createElement('div');
    header.className = 'message-header';
    header.textContent = data.from || 'Agent';
    
    const content = document.createElement('div');
    content.textContent = data.reply || data.message;
    
    div.appendChild(header);
    div.appendChild(content);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

export function addUserMessage(message) {
    const container = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message user';
    div.textContent = message;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

export function addSystemMessage(message) {
    const container = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message system';
    div.textContent = '⚙️ ' + message;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

export function displayAnalysisProgress(data) {
    const container = document.getElementById('messages');
    
    // Remove any existing progress indicator
    const existingProgress = document.getElementById('analysis-progress');
    if (existingProgress) {
        existingProgress.remove();
    }
    
    if (data.complete) {
        // Analysis complete - remove progress indicator
        return;
    }
    
    // Create progress indicator
    const progressDiv = document.createElement('div');
    progressDiv.id = 'analysis-progress';
    progressDiv.className = 'message system analysis-progress';
    
    const stepText = data.step ? `Step ${data.step}/5` : '';
    const dots = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'.split('');
    const currentDot = dots[Math.floor(Date.now() / 100) % dots.length];
    
    progressDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">${currentDot}</span>
            <div>
                <div style="font-weight: 500; color: var(--google-blue);">${data.description}</div>
                <div style="font-size: 12px; color: var(--gray-700);">${data.details}</div>
                ${stepText ? `<div style="font-size: 11px; color: var(--gray-700); margin-top: 2px;">${stepText}</div>` : ''}
            </div>
        </div>
    `;
    
    container.appendChild(progressDiv);
    container.scrollTop = container.scrollHeight;
}

export function displayEscalation(data) {
    addSystemMessage(MESSAGES.ESCALATION(data.details));
}

export function displaySimulationProgress(data) {
    // Handle simulation conversation messages
    if (data.details?.type === 'simulation_conversation') {
        const conv = data.details;
        const container = document.getElementById('messages');
        
        // Build feedback display
        let feedbackHtml = '';
        if (conv.feedback) {
            const fb = conv.feedback;
            const scoreColor = fb.overallScore > 0 ? 'var(--green-600)' : fb.overallScore < 0 ? 'var(--red-600)' : 'var(--gray-600)';
            
            feedbackHtml = `
                <div style="margin-top: 8px; padding: 8px; background: var(--gray-100); border-radius: 4px; font-size: 12px;">
                    <div style="font-weight: 500; margin-bottom: 4px;">🤖 AI Feedback:</div>
                    <div style="color: ${scoreColor};">Overall Score: ${fb.overallScore}</div>
                    ${fb.empathyScore !== undefined ? `<div>Empathy: ${fb.empathyScore}</div>` : ''}
                    ${fb.escalationScore !== undefined ? `<div>Escalation: ${fb.escalationScore}</div>` : ''}
                    ${fb.consentScore !== undefined ? `<div>Consent: ${fb.consentScore}</div>` : ''}
                    ${fb.issuesFound > 0 ? `
                        <div style="margin-top: 4px; color: var(--red-600);">
                            <strong>Issues (${fb.issuesFound}):</strong>
                            ${fb.issues.map(issue => `<div>• ${issue.category}: ${issue.description}</div>`).join('')}
                        </div>
                    ` : ''}
                    ${fb.improvementSuggestions ? `
                        <div style="margin-top: 4px; color: var(--blue-600);">
                            <strong>Suggestions:</strong> ${fb.improvementSuggestions}
                        </div>
                    ` : ''}
                </div>
            `;
        }
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'simulation-message';
        messageDiv.innerHTML = `
            <div style="padding: 12px; margin: 8px 0; background: var(--gray-50); border-radius: 8px;">
                <div style="font-size: 11px; color: var(--gray-600); margin-bottom: 8px;">Turn ${conv.turn}/${conv.maxTurns}</div>
                <div style="margin-bottom: 8px;">
                    <strong>User:</strong> ${conv.userMessage}
                </div>
                <div>
                    <strong>Agent:</strong> ${conv.agentResponse}
                </div>
                ${conv.action?.type !== 'NONE' ? `<div style="margin-top: 4px; font-size: 12px; color: var(--orange-600);">⚡ ${conv.action.type}</div>` : ''}
                ${feedbackHtml}
            </div>
        `;
        container.appendChild(messageDiv);
        container.scrollTop = container.scrollHeight;
        return;
    }
    
    // Regular progress indicators
    const container = document.getElementById('messages');
    const existingProgress = document.getElementById('simulation-progress');
    if (existingProgress) existingProgress.remove();
    
    if (data.complete) {
        addSystemMessage(`🎉 Simulation complete!`);
        return;
    }
    
    const progressDiv = document.createElement('div');
    progressDiv.id = 'simulation-progress';
    progressDiv.className = 'message system simulation-progress';
    progressDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
            <span>🔬</span>
            <div>
                <div style="font-weight: 500; color: var(--google-blue);">${data.description}</div>
                <div style="font-size: 12px; color: var(--gray-700);">${data.details}</div>
            </div>
        </div>
    `;
    
    container.appendChild(progressDiv);
    container.scrollTop = container.scrollHeight;
}

