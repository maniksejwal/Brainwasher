/**
 * @fileoverview UI message display functions
 */

import { MESSAGES } from '../config/messages.js';

export function displayMessage(data) {
    const container = document.getElementById('messages');
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
    const container = document.getElementById('messages');
    
    // Remove any existing simulation progress indicator
    const existingProgress = document.getElementById('simulation-progress');
    if (existingProgress) {
        existingProgress.remove();
    }
    
    if (data.complete) {
        // Simulation complete - remove progress indicator and show completion
        addSystemMessage(`🎉 Simulation complete! Persona: ${data.details || 'Test completed'}`);
        return;
    }
    
    // Create progress indicator
    const progressDiv = document.createElement('div');
    progressDiv.id = 'simulation-progress';
    progressDiv.className = 'message system simulation-progress';
    
    const stepText = data.step ? `Step ${data.step}/5` : '';
    const dots = '🔬🧪⚗️🔬🧪⚗️'.split('');
    const currentDot = dots[Math.floor(Date.now() / 200) % dots.length];
    
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

