/**
 * @fileoverview Data Loaders for GUI Pages
 * 
 * This file contains functions that LOAD DATA for different pages/views in the GUI.
 * "Views" here means PAGE VIEWS (Chat, Circle, Feedback, etc.), NOT SQL database views.
 * 
 * Each function:
 * - Fetches data from server API
 * - Renders it into HTML
 * - Updates the DOM
 */

import { MESSAGES } from '../config/messages.js';
import { addSystemMessage } from './messages.js';

// Import findUserById function
async function findUserById(userId) {
    try {
        const response = await fetch(`/api/user/${userId}`);
        const data = await response.json();
        return data.user;
    } catch (error) {
        console.error('Error fetching user:', error);
        return { username: 'Unknown', user_id: userId };
    }
}

export function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${viewName}-view`).classList.add('active');
    
    const selector = document.getElementById('view-selector');
    selector.textContent = viewName.charAt(0).toUpperCase() + viewName.slice(1);
}

export async function loadCircleInfo(api, userId) {
    const circleContainer = document.getElementById('circle-members');
    circleContainer.innerHTML = '<div class="loading">' + MESSAGES.LOADING_CIRCLE + '</div>';
    
    try {
        const data = await api.getCircleMembers(userId);
        
        if (!data.members || data.members.length === 0) {
            circleContainer.innerHTML = MESSAGES.CIRCLE_INSTRUCTIONS;
            return;
        }
        
        // Display members with circle context
        const currentUser = await findUserById(userId);
        const isOwnCircle = data.circle_id === userId;
        
        let html = `<h4>${isOwnCircle ? 'Your Care Circle' : `${currentUser.username}'s View of ${data.patient_username}'s Circle`}</h4>`;
        html += `<p style="color: #666; font-size: 13px; margin-bottom: 16px;">`;
        if (isOwnCircle) {
            html += `👤 This is your own care circle`;
        } else {
            html += `👥 You are viewing <strong>${data.patient_username}'s</strong> care circle as <strong>${currentUser.username}</strong>`;
        }
        html += `</p>`;
        html += '<div style="margin: 16px 0;">';
        
        data.members.forEach(member => {
            const roleColor = member.role === 'patient' ? '#4285F4' : 
                             member.role === 'doctor' ? '#0F9D58' : '#F4B400';
            
            const consentLevels = ['none', 'limited', 'full'];
            const currentConsent = member.consent_level || 'none';
            
            // Don't show consent controls for self
            let consentControls = '';
            if (member.user_id !== userId) {
                consentControls = `
                    <div style="margin-top: 8px;">
                        <select class="consent-select" data-username="${member.username}" style="padding: 4px 8px; font-size: 12px; border: 1px solid #ddd; border-radius: 4px;">
                            ${consentLevels.map(level => 
                                `<option value="${level}" ${level === currentConsent ? 'selected' : ''}>${level}</option>`
                            ).join('')}
                        </select>
                    </div>
                `;
            }
            
            html += `
                <div style="padding: 12px; margin: 8px 0; border-left: 4px solid ${roleColor}; background: #f5f5f5; border-radius: 4px;">
                    <div style="font-weight: 600;">${member.username}</div>
                    <div style="font-size: 13px; color: #666;">
                        Role: ${member.role}
                        ${member.relationship_type ? ` • ${member.relationship_type}` : ''}
                    </div>
                    ${consentControls}
                </div>
            `;
        });
        
        html += '</div>';
        html += '<button id="add-member-btn" class="primary" style="margin: 16px 0;">Add Member</button>';
        html += '<p style="color: #666; font-size: 14px;">Or use: <code>/care username as relationship</code> or <code>/doc username [as specialty]</code></p>';
        
        circleContainer.innerHTML = html;
        
        // Add event listeners for consent changes
        document.querySelectorAll('.consent-select').forEach(select => {
            select.addEventListener('change', async (e) => {
                const username = e.target.dataset.username;
                const newLevel = e.target.value;
                const command = `/consent ${username} ${newLevel}`;
                
                try {
                    // Send the command using the current circle context
                    const currentCircleId = window.currentCircleId || userId;
                    await api.sendCommand(userId, currentCircleId, command);
                    
                    // Success feedback
                    e.target.style.borderColor = '#0F9D58';
                    setTimeout(() => {
                        e.target.style.borderColor = '#ddd';
                    }, 2000);
                } catch (error) {
                    console.error('Failed to update consent:', error);
                    // Revert on error
                    e.target.value = e.target.dataset.previousValue || 'none';
                    e.target.style.borderColor = '#EA4335';
                    setTimeout(() => {
                        e.target.style.borderColor = '#ddd';
                    }, 2000);
                }
            });
            
            // Store previous value for revert on error
            select.addEventListener('focus', (e) => {
                e.target.dataset.previousValue = e.target.value;
            });
        });
    } catch (error) {
        circleContainer.innerHTML = '<p>Error loading circle: ' + error.message + '</p>' + MESSAGES.CIRCLE_INSTRUCTIONS;
    }
}

export async function loadFeedbackData(api, userId) {
    const feedbackList = document.getElementById('feedback-list');
    feedbackList.innerHTML = '<div class="loading">' + MESSAGES.LOADING_FEEDBACK + '</div>';

    try {
        const feedback = await api.getFeedback(userId);

        if (feedback.length === 0) {
            feedbackList.innerHTML = '<p>' + MESSAGES.NO_FEEDBACK + '</p>';
            return;
        }

        feedbackList.innerHTML = '';
        feedback.forEach(item => {
            const div = document.createElement('div');
            div.className = 'feedback-item';
            
            const scoreClass = item.score > 0 ? 'positive' : item.score < 0 ? 'negative' : 'neutral';
            const scoreText = item.score > 0 ? '+1' : item.score < 0 ? '-1' : '0';
            
            div.innerHTML = `
                <span class="feedback-score ${scoreClass}">${scoreText}</span>
                <span>${new Date(item.timestamp).toLocaleString()}</span>
                ${item.comment ? `<p style="margin-top:8px">${item.comment}</p>` : ''}
            `;
            
            feedbackList.appendChild(div);
        });
    } catch (error) {
        feedbackList.innerHTML = '<p>Error loading feedback</p>';
    }
}

export async function loadConversationsData(api, userId) {
    const conversationsList = document.getElementById('conversations-list');
    conversationsList.innerHTML = '<div class="loading">' + MESSAGES.LOADING_CONVERSATIONS + '</div>';

    try {
        const conversations = await api.getConversations(userId);

        if (conversations.length === 0) {
            conversationsList.innerHTML = '<p>' + MESSAGES.NO_CONVERSATIONS + '</p>';
            return;
        }

        conversationsList.innerHTML = '';
        conversations.forEach(conv => {
            const div = document.createElement('div');
            div.className = 'conversation-item';
            
            const startDate = new Date(conv.start_time).toLocaleString();
            const messageCount = conv.messages.length;
            
            div.innerHTML = `
                <div class="conversation-header">
                    <strong>${startDate}</strong>
                    <span class="badge">${messageCount} messages</span>
                </div>
                <div class="conversation-preview">
                    ${conv.messages[0]?.message?.substring(0, 80) || 'No preview'}...
                </div>
            `;
            
            div.addEventListener('click', () => showConversationDetail(conv));
            conversationsList.appendChild(div);
        });
    } catch (error) {
        conversationsList.innerHTML = '<p>Error loading conversations</p>';
    }
}

function showConversationDetail(conversation) {
    const detail = document.createElement('div');
    detail.className = 'conversation-detail';
    detail.style.cssText = `
        position: fixed; top: 50px; left: 50%; transform: translateX(-50%);
        width: 80%; max-height: 80vh; overflow: auto;
        background: white; border: 1px solid #ddd; border-radius: 8px;
        padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); z-index: 1000;
    `;
    
    let html = `
        <button id="close-detail" style="float:right; background:none; border:none; font-size:20px; cursor:pointer;">✖</button>
        <h3>Conversation Detail</h3>
        <p><strong>Started:</strong> ${new Date(conversation.start_time).toLocaleString()}</p>
        <hr>
    `;
    
    conversation.messages.forEach(msg => {
        html += `
            <div style="margin: 20px 0; padding: 10px; border-left: 3px solid #4285F4;">
                <div style="color: #666; font-size: 12px;">${new Date(msg.timestamp).toLocaleString()}</div>
                <div style="margin: 8px 0;"><strong>User:</strong> ${msg.message}</div>
                <div style="margin: 8px 0;"><strong>Agent:</strong> ${msg.agent_response || '<em>No response</em>'}</div>
                <div style="color: #999; font-size: 11px;">Latency: ${msg.latency_ms}ms</div>
            </div>
        `;
    });
    
    detail.innerHTML = html;
    document.body.appendChild(detail);
    
    document.getElementById('close-detail').addEventListener('click', () => {
        document.body.removeChild(detail);
    });
}

export async function loadServerLogs(api) {
    const logsContainer = document.getElementById('logs-container');
    logsContainer.innerHTML = '<div class="loading">' + MESSAGES.LOADING_LOGS + '</div>';

    try {
        const data = await api.getLogs(100);
        
        if (data.logs.length === 0) {
            logsContainer.innerHTML = '<p>' + MESSAGES.NO_LOGS + '</p>';
            return;
        }

        logsContainer.innerHTML = '';
        data.logs.forEach(log => {
            const div = document.createElement('div');
            div.style.marginBottom = '4px';
            div.style.padding = '4px';
            div.style.borderLeft = log.level === 'error' ? '3px solid #f44336' : '3px solid #4285F4';
            
            const time = new Date(log.timestamp).toLocaleTimeString();
            div.innerHTML = `<span style="color: #666;">[${time}]</span> ${log.message}`;
            
            logsContainer.appendChild(div);
        });
        
        logsContainer.scrollTop = logsContainer.scrollHeight;
    } catch (error) {
        logsContainer.innerHTML = '<p>Error loading logs</p>';
    }
}

