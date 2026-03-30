/**
 * @fileoverview UI data loading functions
 * - Fetches data from server API
 * - Renders it into HTML
 * - Updates the DOM
 */

import { MESSAGES } from '../config/messages.js';
import { addSystemMessage } from './messages.js';
import config from '../config.js';

// Import findUserById function
async function findUserById(userId) {
    try {
        const response = await fetch(config.apiUrl(`/api/user/${userId}`));
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
        const isOwnCircle = data.circleId === userId;
        
        // Find current user's role in this circle
        const currentUserMember = data.members.find(m => m.user_id === userId);
        const currentUserRole = currentUserMember ? currentUserMember.role : 'member';
        const currentUserRelationship = currentUserMember ? currentUserMember.relationship_type : '';
        
        let html = `<h4>${isOwnCircle ? 'Your Care Circle' : `${currentUser.username}'s View of ${data.patientUsername}'s Circle`}</h4>`;
        html += `<p style="color: #666; font-size: 13px; margin-bottom: 16px;">`;
        if (isOwnCircle) {
            html += `👤 This is your own care circle`;
        } else {
            const roleText = currentUserRelationship ? `${currentUserRole} (${currentUserRelationship})` : currentUserRole;
            html += `👥 You are viewing <strong>${data.patientUsername}'s</strong> care circle as <strong>${roleText}</strong>`;
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

export async function loadMyCirclesData(api, userId) {
    const circlesContainer = document.getElementById('mycircles-list');
    circlesContainer.innerHTML = '<div class="loading">Loading your circles...</div>';

    try {
        // Directly call the backend to get circles data
        const response = await fetch(config.apiUrl(`/api/mycircles/${userId}`));
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.circles || data.circles.length === 0) {
            circlesContainer.innerHTML = `
                <p>🔄 <strong>All Your Care Circles</strong></p>
                <p style="color: #666; font-size: 14px; margin: 16px 0;">
                    You are not currently a member of any care circles.
                </p>
                <div style="background: #f5f5f5; padding: 12px; border-radius: 4px; margin: 16px 0;">
                    <p style="margin: 0; font-size: 13px; color: #666;">
                        💡 <strong>Getting Started:</strong> Ask someone to add you to their care circle using <code>/care username as relationship</code> or <code>/doc username</code>.
                    </p>
                </div>
            `;
            return;
        }

        let html = `<p>🔄 <strong>All Your Care Circles (${data.circles.length})</strong></p>`;
        html += '<div style="margin: 16px 0;">';
        
        data.circles.forEach((circle, index) => {
            const roleEmoji = circle.role === 'patient' ? '👤' : 
                            circle.role === 'doctor' ? '🩺' : '👥';
            
            html += `
                <div style="padding: 12px; margin: 8px 0; border-left: 4px solid ${circle.role === 'patient' ? '#4285F4' : circle.role === 'doctor' ? '#0F9D58' : '#F4B400'}; background: #f5f5f5; border-radius: 4px;">
                    <div style="font-weight: 600;">${roleEmoji} ${circle.patient_username}'s Circle</div>
                    <div style="font-size: 13px; color: #666; margin-top: 4px;">
                        Your role: ${circle.role}
                        ${circle.relationship_type && circle.relationship_type !== 'null' ? ` (${circle.relationship_type})` : ''}
                    </div>
                    <div style="font-size: 12px; color: #999; margin-top: 4px;">
                        Circle ID: ${circle.circle_id}
                    </div>
                    <button onclick="switchToCircle('${circle.patient_username}')" class="secondary" style="margin-top: 8px; font-size: 12px; padding: 4px 8px;">
                        Switch to this circle
                    </button>
                </div>
            `;
        });
        
        html += '</div>';
        html += '<p style="color: #666; font-size: 14px;">💡 Use /switch &lt;patient&gt; to join a specific circle</p>';
        
        circlesContainer.innerHTML = html;
        
        // Add global function for circle switching
        window.switchToCircle = (patientUsername) => {
            const command = `/switch ${patientUsername}`;
            // Find the message input and send the command
            const messageInput = document.getElementById('message-input');
            const sendBtn = document.getElementById('send-btn');
            if (messageInput && sendBtn) {
                messageInput.value = command;
                sendBtn.click();
                
                // Auto-refresh circle view after switch (wait for command to process)
                setTimeout(() => {
                    // Switch to circle view
                    switchView('circle');
                    // Trigger a custom event to refresh the circle view
                    window.dispatchEvent(new CustomEvent('refreshCircleView'));
                }, 1500); // Wait 1.5 seconds for command to process
            }
        };
        
    } catch (error) {
        circlesContainer.innerHTML = `
            <p>Error loading circles: ${error.message}</p>
            <p style="color: #666; font-size: 14px;">
                You can still use <code>/mycircles</code> in the chat.
            </p>
        `;
    }
}

export async function loadPatientsData(api, userId) {
    const patientsContainer = document.getElementById('patients-list');
    patientsContainer.innerHTML = '<div class="loading">Loading your patients...</div>';

    try {
        // Directly call the backend to get doctor's patients
        const response = await fetch(config.apiUrl(`/api/patients/${userId}`));
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.patients || data.patients.length === 0) {
            patientsContainer.innerHTML = `
                <p>🩺 <strong>Your Patients</strong></p>
                <p style="color: #666; font-size: 14px; margin: 16px 0;">
                    You are not currently serving as a doctor in any care circles.
                </p>
                <div style="background: #f5f5f5; padding: 12px; border-radius: 4px; margin: 16px 0;">
                    <p style="margin: 0; font-size: 13px; color: #666;">
                        💡 <strong>For doctors:</strong> Patients must add you to their care circles using <code>/doc username [as specialty]</code>.
                    </p>
                </div>
            `;
            return;
        }

        let html = `<p>🩺 <strong>Your Patients (${data.patients.length})</strong></p>`;
        html += '<div style="margin: 16px 0;">';
        
        data.patients.forEach((patient, index) => {
            html += `
                <div style="padding: 12px; margin: 8px 0; border-left: 4px solid #0F9D58; background: #f5f5f5; border-radius: 4px;">
                    <div style="font-weight: 600;">👤 ${patient.patient_username}</div>
                    <div style="font-size: 13px; color: #666; margin-top: 4px;">
                        Your specialty: ${patient.relationship_type || 'General Physician'}
                    </div>
                    <div style="font-size: 12px; color: #999; margin-top: 4px;">
                        Circle ID: ${patient.circle_id}
                    </div>
                    <button onclick="switchToPatient('${patient.patient_username}')" class="primary" style="margin-top: 8px; font-size: 12px; padding: 4px 8px;">
                        Switch to ${patient.patient_username}'s circle
                    </button>
                </div>
            `;
        });
        
        html += '</div>';
        html += '<p style="color: #666; font-size: 14px;">💡 Use /switch &lt;patient&gt; to join their circle and provide care</p>';
        
        patientsContainer.innerHTML = html;
        
        // Add global function for patient switching
        window.switchToPatient = (patientUsername) => {
            const command = `/switch ${patientUsername}`;
            // Find the message input and send the command
            const messageInput = document.getElementById('message-input');
            const sendBtn = document.getElementById('send-btn');
            if (messageInput && sendBtn) {
                messageInput.value = command;
                sendBtn.click();
                
                // Auto-refresh circle view after switch (wait for command to process)
                setTimeout(() => {
                    // Switch to circle view
                    switchView('circle');
                    // Trigger a custom event to refresh the circle view
                    window.dispatchEvent(new CustomEvent('refreshCircleView'));
                }, 1500); // Wait 1.5 seconds for command to process
            }
        };
        
    } catch (error) {
        patientsContainer.innerHTML = `
            <p>Error loading patients: ${error.message}</p>
            <p style="color: #666; font-size: 14px;">
                You can still use <code>/patients</code> in the chat.
            </p>
        `;
    }
}

// Keep the existing functions
export async function loadFeedbackData(api, userId) {
    const feedbackList = document.getElementById('feedback-list');
    feedbackList.innerHTML = '<div class="loading">' + MESSAGES.LOADING_FEEDBACK + '</div>';

    try {
        const feedback = await api.getFeedback(userId);

        if (feedback.length === 0) {
            feedbackList.innerHTML = `
                <div style="padding: 16px; background: var(--gray-50); border-radius: 8px;">
                    <p>No feedback yet.</p>
                    <p style="font-size: 13px; color: var(--gray-600); margin-top: 8px;">
                        Run simulations and provide feedback to see it here.
                    </p>
                </div>
            `;
            return;
        }

        // Categorize feedback
        const simulation = feedback.filter(f => 
            f.conversation_id.includes('sim') || f.comment?.includes('[Turn') || f.comment?.includes('[Overall]')
        );
        const real = feedback.filter(f => 
            !f.conversation_id.includes('sim') && !f.comment?.includes('[Turn') && !f.comment?.includes('[Overall]')
        );

        feedbackList.innerHTML = `
            <div style="margin-bottom: 16px;">
                <h4 style="margin: 0 0 8px 0;">📊 Feedback Summary</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div style="padding: 12px; background: var(--blue-50); border-radius: 4px;">
                        <div style="font-size: 11px; color: var(--gray-600);">Simulation Feedback</div>
                        <div style="font-size: 20px; font-weight: 500;">${simulation.length}</div>
                    </div>
                    <div style="padding: 12px; background: var(--green-50); border-radius: 4px;">
                        <div style="font-size: 11px; color: var(--gray-600);">Real User Feedback</div>
                        <div style="font-size: 20px; font-weight: 500;">${real.length}</div>
                    </div>
                </div>
            </div>
        `;

        // Display all feedback (most recent first)
        const allFeedbackDiv = document.createElement('div');
        
        feedback.forEach(item => {
            const isSimulation = item.conversation_id.includes('sim') || item.comment?.includes('[Turn');
            const div = document.createElement('div');
            div.className = 'feedback-item';
            div.style.cssText = 'margin-bottom: 12px; padding: 12px; background: white; border-radius: 4px; border: 1px solid var(--gray-200);';
            
            const scoreEmoji = item.score > 0 ? '👍' : item.score < 0 ? '👎' : '😐';
            const scoreColor = item.score > 0 ? 'var(--green-600)' : item.score < 0 ? 'var(--red-600)' : 'var(--gray-600)';
            const typeLabel = isSimulation ? '🤖 Simulation' : '👤 Real';
            
            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div>
                        <span style="font-size: 18px;">${scoreEmoji}</span>
                        <span style="color: ${scoreColor}; font-weight: 500; margin-left: 8px;">Score: ${item.score}</span>
                        <span style="margin-left: 12px; font-size: 11px; color: var(--gray-600);">${typeLabel}</span>
                    </div>
                    <span style="font-size: 11px; color: var(--gray-600);">${new Date(item.timestamp).toLocaleString()}</span>
                </div>
                ${item.comment ? `<div style="color: var(--gray-700); font-size: 13px;">${item.comment}</div>` : ''}
                <div style="font-size: 11px; color: var(--gray-500); margin-top: 4px;">Conversation: ${item.conversation_id}</div>
            `;
            
            allFeedbackDiv.appendChild(div);
        });
        
        feedbackList.appendChild(allFeedbackDiv);
        
    } catch (error) {
        feedbackList.innerHTML = '<p>Error loading feedback</p>';
        console.error('[Feedback] Load error:', error);
    }
}

function showConversationDetails(conversation) {
    const conversationsList = document.getElementById('conversations-list');
    conversationsList.innerHTML = `
        <button id="back-to-conversations" class="secondary" style="margin-bottom: 16px;">← Back to List</button>
        <div style="padding: 16px; background: var(--gray-50); border-radius: 8px;">
            <h3>Conversation #${conversation.conversation_id}</h3>
            <p><strong>Messages:</strong> ${conversation.messages.length}</p>
            <p><strong>Started:</strong> ${new Date(conversation.start_time).toLocaleString()}</p>
            <p><strong>Ended:</strong> ${new Date(conversation.end_time).toLocaleString()}</p>
        </div>
        <div style="margin-top: 16px;">
            ${conversation.messages.map(msg => `
                <div class="message-log" style="padding: 12px; margin: 8px 0; background: white; border-left: 3px solid var(--google-blue); border-radius: 4px;">
                    <div style="font-size: 12px; color: var(--gray-600);">${new Date(msg.timestamp).toLocaleString()}</div>
                    <div style="margin-top: 4px;"><strong>User:</strong> ${msg.message}</div>
                    <div style="margin-top: 4px;"><strong>Agent:</strong> ${msg.agent_response}</div>
                    ${msg.orchestrator_action?.type !== 'NONE' ? `<div style="margin-top: 4px; color: var(--yellow); font-size: 12px;">⚡ Action: ${msg.orchestrator_action.type}</div>` : ''}
                </div>
            `).join('')}
        </div>
    `;
    
    document.getElementById('back-to-conversations').addEventListener('click', () => {
        loadConversationsData(window.api, window.state.userId);
    });
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
        conversations.forEach(conversation => {
            const div = document.createElement('div');
            div.className = 'conversation-item';
            div.innerHTML = `
                <h4>Conversation #${conversation.conversation_id}</h4>
                <p>Messages: ${conversation.messages.length}</p>
                <p>Started: ${new Date(conversation.start_time).toLocaleString()}</p>
            `;
            div.addEventListener('click', () => {
                showConversationDetails(conversation);
            });
            conversationsList.appendChild(div);
        });
    } catch (error) {
        conversationsList.innerHTML = '<p>Error loading conversations</p>';
    }
}

export async function loadServerLogs(api) {
    const logsList = document.getElementById('logs-container');
    logsList.innerHTML = '<div class="loading">Loading server logs...</div>';

    try {
        const response = await fetch(config.apiUrl('/api/logs?limit=100'));
        const data = await response.json();
        
        if (!data.logs || data.logs.length === 0) {
            logsList.innerHTML = '<p>No logs yet.</p>';
            return;
        }

        logsList.innerHTML = '';
        data.logs.reverse().forEach(log => {
            const div = document.createElement('div');
            div.className = 'log-item';
            div.innerHTML = `
                <div class="log-timestamp">${new Date(log.timestamp).toLocaleString()}</div>
                <div class="log-message ${log.level}">${log.message}</div>
            `;
            logsList.appendChild(div);
        });
    } catch (error) {
        logsList.innerHTML = '<p>Error loading logs: ' + error.message + '</p>';
    }
}
