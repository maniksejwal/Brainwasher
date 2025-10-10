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

export function displayEscalation(data) {
    addSystemMessage(MESSAGES.ESCALATION(data.details));
}

