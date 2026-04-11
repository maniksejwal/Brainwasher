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

// ====== BUSINESS DATA LOADING ======

export async function loadBusinessData(api, userId) {
    // Load default business section (professional circles)
    loadBusinessSectionData(api, userId, 'professional-circles');
}

export async function loadBusinessSectionData(api, userId, sectionType) {
    switch (sectionType) {
        case 'professional-circles':
            await loadProfessionalCircles(api, userId);
            break;
        case 'documents':
            await loadBusinessDocuments(api, userId);
            break;
        case 'negotiations':
            await loadBusinessNegotiations(api, userId);
            break;
    }
}

async function loadProfessionalCircles(api, userId) {
    const targetList = document.getElementById('target-circles-list');
    const supportList = document.getElementById('support-circles-list');
    const expertList = document.getElementById('expert-circles-list');

    // Show loading state
    [targetList, supportList, expertList].forEach(list => {
        list.innerHTML = '<div class="loading">Loading circles...</div>';
    });

    try {
        const response = await api.get(`/api/professional-circles/user/${userId}`);
        const circles = response.data || [];

        // Group circles by user's role
        const roleGroups = {
            target: circles.filter(c => c.user_role === 'target'),
            support: circles.filter(c => c.user_role === 'support'),
            expert: circles.filter(c => c.user_role === 'expert')
        };

        // Render each role group
        renderCircleRole(targetList, roleGroups.target, 'target');
        renderCircleRole(supportList, roleGroups.support, 'support');
        renderCircleRole(expertList, roleGroups.expert, 'expert');

    } catch (error) {
        console.error('Error loading professional circles:', error);
        [targetList, supportList, expertList].forEach(list => {
            list.innerHTML = `<div class="empty-business-section">
                <h5>Unable to load circles</h5>
                <p>Please check your connection and try again.</p>
            </div>`;
        });
    }
}

function renderCircleRole(container, circles, role) {
    if (circles.length === 0) {
        container.innerHTML = `<div class="empty-business-section">
            <h5>No ${role} circles yet</h5>
            <p>You'll see circles where you have the ${role} role here.</p>
        </div>`;
        return;
    }

    container.innerHTML = '';
    circles.forEach(circle => {
        const div = document.createElement('div');
        div.className = 'circle-list-item';
        div.innerHTML = `
            <h6>${circle.circle_name}</h6>
            <p>${circle.purpose || 'Professional collaboration'}</p>
            <p style="font-size: 11px; color: var(--gray-500); margin-top: 4px;">
                ${circle.member_count || 3} members • ${circle.organization_context || 'Cross-org'}
            </p>
        `;
        div.addEventListener('click', () => {
            // Switch to circle context and go to chat
            window.api.post('/api/context/switch', { circleId: circle.id })
                .then(() => {
                    switchView('chat');
                    addSystemMessage(`Switched to ${circle.circle_name} circle context`);
                });
        });
        container.appendChild(div);
    });
}

async function loadBusinessDocuments(api, userId) {
    const myDocsList = document.getElementById('my-documents-list');
    const sharedDocsList = document.getElementById('shared-documents-list');
    const approvalsList = document.getElementById('pending-approvals-list');

    // Show loading state
    [myDocsList, sharedDocsList, approvalsList].forEach(list => {
        list.innerHTML = '<div class="loading">Loading documents...</div>';
    });

    try {
        const response = await api.get(`/api/documents/user/${userId}`);
        const documents = response.data || [];

        // Group documents by type
        const docGroups = {
            owned: documents.filter(d => d.created_by === userId),
            shared: documents.filter(d => d.created_by !== userId && d.access_level),
            pending: documents.filter(d => d.pending_approval && d.approver_id === userId)
        };

        renderDocuments(myDocsList, docGroups.owned, 'owned');
        renderDocuments(sharedDocsList, docGroups.shared, 'shared');
        renderDocuments(approvalsList, docGroups.pending, 'pending');

    } catch (error) {
        console.error('Error loading business documents:', error);
        [myDocsList, sharedDocsList, approvalsList].forEach(list => {
            list.innerHTML = `<div class="empty-business-section">
                <h5>Unable to load documents</h5>
                <p>Please check your connection and try again.</p>
            </div>`;
        });
    }
}

function renderDocuments(container, documents, type) {
    if (documents.length === 0) {
        const messages = {
            owned: 'No documents created yet',
            shared: 'No documents shared with you',
            pending: 'No pending approvals'
        };
        container.innerHTML = `<div class="empty-business-section">
            <h5>${messages[type]}</h5>
            <p>Documents will appear here as you collaborate.</p>
        </div>`;
        return;
    }

    container.innerHTML = '';
    documents.forEach(doc => {
        const div = document.createElement('div');
        div.className = 'document-list-item';
        div.innerHTML = `
            <h6>${doc.title}</h6>
            <p>${doc.summary || 'Document collaboration'}</p>
            <p style="font-size: 11px; color: var(--gray-500); margin-top: 4px;">
                Updated ${new Date(doc.updated_at).toLocaleDateString()}
                ${doc.pending_approval ? ' • Needs approval' : ''}
            </p>
        `;
        div.addEventListener('click', () => {
            // Open document in chat interface with /doc command
            const input = document.getElementById('user-input');
            input.value = `/doc view ${doc.id}`;
            switchView('chat');
        });
        container.appendChild(div);
    });
}

async function loadBusinessNegotiations(api, userId) {
    const myNegotiationsList = document.getElementById('my-negotiations-list');
    const outcomesList = document.getElementById('negotiation-outcomes-list');

    // Show loading state
    [myNegotiationsList, outcomesList].forEach(list => {
        list.innerHTML = '<div class="loading">Loading negotiations...</div>';
    });

    try {
        const response = await api.get(`/api/negotiations/user/${userId}`);
        const negotiations = response.data || [];

        // Group negotiations
        const negGroups = {
            active: negotiations.filter(n => n.status === 'active'),
            completed: negotiations.filter(n => n.status === 'completed')
        };

        renderNegotiations(myNegotiationsList, negGroups.active, 'active');
        renderNegotiations(outcomesList, negGroups.completed, 'completed');

    } catch (error) {
        console.error('Error loading negotiations:', error);
        [myNegotiationsList, outcomesList].forEach(list => {
            list.innerHTML = `<div class="empty-business-section">
                <h5>Unable to load negotiations</h5>
                <p>Please check your connection and try again.</p>
            </div>`;
        });
    }
}

function renderNegotiations(container, negotiations, type) {
    if (negotiations.length === 0) {
        const messages = {
            active: 'No active negotiations',
            completed: 'No recent outcomes'
        };
        container.innerHTML = `<div class="empty-business-section">
            <h5>${messages[type]}</h5>
            <p>Negotiations will appear here as you engage in business discussions.</p>
        </div>`;
        return;
    }

    container.innerHTML = '';
    negotiations.forEach(neg => {
        const div = document.createElement('div');
        div.className = 'negotiation-list-item';
        div.innerHTML = `
            <h6>${neg.topic || 'Business Negotiation'}</h6>
            <p>${neg.description || 'Multi-party negotiation'}</p>
            <p style="font-size: 11px; color: var(--gray-500); margin-top: 4px;">
                ${type === 'active' ? 'In progress' : `Completed ${new Date(neg.completed_at).toLocaleDateString()}`}
            </p>
        `;
            div.addEventListener('click', () => {
            // Open negotiation in chat interface
            const input = document.getElementById('user-input');
            input.value = `/negotiate join ${neg.session_id}`;
            switchView('chat');
        });
        container.appendChild(div);
    });
}

// ====== BUSINESS MODAL HANDLERS ======

// Make functions globally available for HTML onclick handlers
window.openProfessionalCircleModal = function() {
    document.getElementById('create-professional-circle-modal').style.display = 'block';
};

window.closeProfessionalCircleModal = function() {
    document.getElementById('create-professional-circle-modal').style.display = 'none';
    // Reset forms
    document.querySelectorAll('#create-professional-circle-modal [id$="-form"]').forEach(form => {
        form.style.display = 'none';
    });
};

// Professional member form handlers
function setupProfessionalCircleModal() {
    const modal = document.getElementById('create-professional-circle-modal');
    if (!modal) return;

    // Role button handlers
    document.getElementById('add-target-btn')?.addEventListener('click', () => {
        showProfessionalForm('target');
    });
    
    document.getElementById('add-support-btn')?.addEventListener('click', () => {
        showProfessionalForm('support');
    });
    
    document.getElementById('add-expert-btn')?.addEventListener('click', () => {
        showProfessionalForm('expert');
    });

    // Submit handler
    document.getElementById('submit-add-professional-member')?.addEventListener('click', async () => {
        await submitProfessionalMember();
    });

    // Cancel handler
    document.getElementById('cancel-add-professional-member')?.addEventListener('click', () => {
        window.closeProfessionalCircleModal();
    });

    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            window.closeProfessionalCircleModal();
        }
    });
}

function showProfessionalForm(roleType) {
    // Hide all forms
    document.querySelectorAll('#create-professional-circle-modal [id$="-form"]').forEach(form => {
        form.style.display = 'none';
    });
    
    // Show selected form
    document.getElementById(`${roleType}-form`).style.display = 'block';
    
    // Focus on username field
    document.getElementById(`${roleType}-username`)?.focus();
}

async function submitProfessionalMember() {
    let memberData = null;
    let roleType = null;

    // Find which form is visible
    const forms = ['target', 'support', 'expert'];
    for (const type of forms) {
        const form = document.getElementById(`${type}-form`);
        if (form && form.style.display !== 'none') {
            roleType = type;
            const username = document.getElementById(`${type}-username`).value;
            const role = document.getElementById(`${type}-${type === 'target' ? 'title' : type === 'support' ? 'role' : 'specialty'}`).value;
            
            if (!username) {
                showNotification('Please enter a username', 'error');
                return;
            }
            
            memberData = { username, role, type: roleType };
            break;
        }
    }

    if (!memberData) {
        showNotification('Please select a role and fill in the details', 'error');
        return;
    }

    try {
        // Use chat command syntax like medical circles
        const command = `/${memberData.type} ${memberData.username}${memberData.role ? ' as ' + memberData.role : ''}`;
        
        // TODO: Send via chat system like medical circles
        console.log('Professional member command:', command);
        
        showNotification(`${roleType.charAt(0).toUpperCase() + roleType.slice(1)} "${memberData.username}" added to professional circle! 🎯`, 'success');
        
        window.closeProfessionalCircleModal();
        
        // Refresh professional circles view
        loadProfessionalCircles(window.api, window.state?.userId);
        
    } catch (error) {
        console.error('Error adding professional member:', error);
        showNotification('Failed to add member. Please try again.', 'error');
    }
}

// Setup business event listeners
export function setupBusinessEventListeners() {
    // Import and setup document workspace
    import('./documentWorkspace.js').then(({ setupDocumentWorkspace }) => {
        setupDocumentWorkspace();
    });
    
    // Document creation button
    const newDocBtn = document.getElementById('new-document-btn');
    const createFirstDocBtn = document.querySelector('.create-first-doc');
    
    if (newDocBtn) {
        newDocBtn.addEventListener('click', () => openDocumentModal());
    }
    if (createFirstDocBtn) {
        createFirstDocBtn.addEventListener('click', () => openDocumentModal());
    }
    
    // Document filter buttons
    const filterBtns = document.querySelectorAll('.filter-btn[data-filter]');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            const filter = e.target.dataset.filter;
            loadDocuments(filter);
        });
    });
    
    // Only set up listeners if the business elements exist
    const addProfessionalMemberBtn = document.getElementById('add-professional-member-btn');
    const circleForm = document.getElementById('professional-circle-form');
    const circleModal = document.getElementById('create-professional-circle-modal');
    
    if (addProfessionalMemberBtn) {
        // Professional member addition button
        addProfessionalMemberBtn.addEventListener('click', () => {
            window.openProfessionalCircleModal();
        });
    }

    if (circleForm) {
        // Professional circle form submission
        // ARCHITECTURAL NOTE: Using CLI commands for consistency with care circles
        // Care circles use: GUI Modal → CLI Command (/care, /doctor) → Command Handler
        // Professional circles now use: GUI Modal → CLI Command (/create-circle, /target) → Command Handler
        circleForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const circleData = {
                name: document.getElementById('circle-name').value,
                purpose: document.getElementById('circle-purpose').value,
                organizationContext: document.getElementById('organization-context').value,
                members: {
                    target: document.getElementById('target-member').value,
                    support: document.getElementById('support-member').value,
                    expert: document.getElementById('expert-member').value
                }
            };

            try {
                // Use CLI commands instead of API calls for consistency
                
                // Step 1: Create the circle via CLI command
                const createCommand = `/create-circle professional ${circleData.name.replace(/\s+/g, '_')}`;
                await window.sendMessage(createCommand);
                
                // Wait a moment for circle creation to complete
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Step 2: Add members via CLI commands (if provided)
                if (circleData.members.target) {
                    const addTargetCommand = `/target ${circleData.members.target} as project_lead`;
                    await window.sendMessage(addTargetCommand);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                if (circleData.members.support) {
                    const addSupportCommand = `/support ${circleData.members.support} as coordinator`;
                    await window.sendMessage(addSupportCommand);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                if (circleData.members.expert) {
                    const addExpertCommand = `/expert ${circleData.members.expert} as technical_expert`;
                    await window.sendMessage(addExpertCommand);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                window.closeProfessionalCircleModal();
                addSystemMessage(`Professional circle "${circleData.name}" created successfully! 🎉`);
                
                // Refresh the professional circles view
                setTimeout(() => {
                    loadProfessionalCircles(window.api, window.state?.userId);
                }, 2000);
                
            } catch (error) {
                console.error('Error creating professional circle via CLI:', error);
                addSystemMessage('Failed to create professional circle. Please check that all usernames are valid.', 'error');
            }
        });
    }

    if (circleModal) {
        // Close modal on background click
        circleModal.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                window.closeProfessionalCircleModal();
            }
        });
    }
    
    // Load initial documents
    loadDocuments('all');
    
    // Setup professional circle modal
    setupProfessionalCircleModal();
}

// ====== DOCUMENT MODAL FUNCTIONS ======

// Make modal functions globally available
window.openDocumentModal = function(docId = null) {
    const modal = document.getElementById('document-editor-modal');
    const titleInput = document.getElementById('doc-title-input');
    const editor = document.getElementById('doc-modal-editor');
    const preview = document.getElementById('doc-modal-preview');
    const modalTitle = document.getElementById('doc-modal-title');
    
    if (docId) {
        // Editing existing document
        modalTitle.textContent = '✏️ Edit Document';
        // TODO: Load document content
        titleInput.value = 'Sample Document';
        editor.value = '# Sample Document\n\nThis is a sample document for editing...';
    } else {
        // Creating new document
        modalTitle.textContent = '📄 Create Document';
        titleInput.value = '';
        editor.value = '# New Document\n\nStart writing your content here...\n\n## Section 1\nYour content goes here.';
    }
    
    // Initialize live preview
    updateDocumentPreview();
    
    // Setup speech for this editor
    import('./speechManager.js').then(({ DocumentSpeechManager }) => {
        new DocumentSpeechManager(editor);
    });
    
    modal.style.display = 'block';
    titleInput.focus();
};

window.closeDocumentModal = function() {
    document.getElementById('document-editor-modal').style.display = 'none';
};

// Additional document functions at the end of the file...

// Setup document modal functionality
function setupDocumentModal() {
    const editor = document.getElementById('doc-modal-editor');
    const preview = document.getElementById('doc-modal-preview');
    const previewToggle = document.getElementById('doc-preview-toggle');
    const saveBtn = document.getElementById('doc-save-btn');
    const saveCloseBtn = document.getElementById('doc-save-and-close');
    
    let isPreviewVisible = true;
    
    if (editor && preview) {
        editor.addEventListener('input', updateDocumentPreview);
    }
    
    if (previewToggle) {
        previewToggle.addEventListener('click', () => {
            if (isPreviewVisible) {
                preview.style.display = 'none';
                previewToggle.textContent = '👁️ Show Preview';
                isPreviewVisible = false;
            } else {
                preview.style.display = 'block';
                previewToggle.textContent = '👁️ Hide Preview';
                isPreviewVisible = true;
            }
        });
    }
    
    if (saveBtn) {
        saveBtn.addEventListener('click', saveDocument);
    }
    
    if (saveCloseBtn) {
        saveCloseBtn.addEventListener('click', async () => {
            await saveDocument();
            window.closeDocumentModal();
        });
    }
}

function updateDocumentPreview() {
    const editor = document.getElementById('doc-modal-editor');
    const preview = document.getElementById('doc-modal-preview');
    
    if (!editor || !preview) return;
    
    const markdown = editor.value;
    preview.innerHTML = markdownToHtml(markdown);
}

function markdownToHtml(markdown) {
    if (!markdown.trim()) {
        return `<div class="preview-placeholder">
            <h2>📝 Live Preview</h2>
            <p>Start typing to see your content rendered here...</p>
        </div>`;
    }
    
    let html = markdown
        // Headers
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        // Bold
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // Code
        .replace(/`(.*?)`/g, '<code>$1</code>')
        // Lists
        .replace(/^\- (.*$)/gim, '<li>$1</li>')
        // Paragraphs
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');
        
    // Wrap in paragraphs and handle lists
    html = '<p>' + html + '</p>';
    html = html.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');
    html = html.replace(/<\/p><p>/g, '</p>\n<p>');
    
    return html;
}

async function saveDocument() {
    const titleInput = document.getElementById('doc-title-input');
    const editor = document.getElementById('doc-modal-editor');
    
    const title = titleInput.value.trim() || 'Untitled Document';
    const content = editor.value;
    
    try {
        // TODO: Replace with actual DocumentAgent API call
        console.log('Saving document:', { title, content });
        
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 500));
        
        showNotification(`Document "${title}" saved successfully! 💾`, 'success');
        
        // Refresh document list
        loadDocuments(document.querySelector('.filter-btn.active')?.dataset.filter || 'all');
        
    } catch (error) {
        console.error('Save error:', error);
        showNotification('Failed to save document 😞', 'error');
    }
}

function showNotification(message, type) {
    // Simple notification system
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        background: ${type === 'success' ? 'var(--green-50)' : 'var(--red-50)'};
        border: 1px solid ${type === 'success' ? 'var(--green-500)' : 'var(--red-500)'};
        color: ${type === 'success' ? 'var(--green-700)' : 'var(--red-700)'};
        border-radius: 6px;
        z-index: 2000;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Load documents based on filter
async function loadDocuments(filter = 'all') {
    const listContainer = document.getElementById('documents-list');
    if (!listContainer) return;
    
    listContainer.innerHTML = '<div class="loading">Loading documents...</div>';
    
    try {
        // TODO: Replace with actual API call
        // const response = await window.api.get(`/api/documents/user/${window.state.userId}?filter=${filter}`);
        
        // Mock data for now
        const mockDocuments = [
            {
                id: 'doc1',
                title: 'Project Proposal v2.1',
                author: 'alice',
                status: 'pending',
                updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
                version: '2.1',
                type: filter === 'shared' ? 'shared' : 'mine'
            },
            {
                id: 'doc2', 
                title: 'Meeting Notes - Sprint Planning',
                author: 'bob',
                status: 'approved',
                updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
                version: '1.0',
                type: filter === 'mine' ? 'mine' : 'shared'
            },
            {
                id: 'doc3',
                title: 'API Documentation Draft',
                author: window.state?.username || 'you',
                status: 'draft',
                updated_at: new Date(Date.now() - 4 * 60 * 60 * 1000),
                version: '1.3',
                type: 'mine'
            }
        ].filter(doc => {
            if (filter === 'all') return true;
            if (filter === 'mine') return doc.author === (window.state?.username || 'you');
            if (filter === 'shared') return doc.author !== (window.state?.username || 'you');
            if (filter === 'pending') return doc.status === 'pending';
            return true;
        });
        
        renderDocumentList(mockDocuments, filter);
        
    } catch (error) {
        console.error('Error loading documents:', error);
        listContainer.innerHTML = '<div class="error">Failed to load documents</div>';
    }
}

function renderDocumentList(documents, filter) {
    const listContainer = document.getElementById('documents-list');
    if (!listContainer) return;
    
    if (documents.length === 0) {
        listContainer.innerHTML = `<div class="empty-docs">
            <h5>📄 No ${filter} documents</h5>
            <p>No documents found for the current filter.</p>
            <button class="create-first-doc primary" onclick="openDocumentModal()">Create New Document</button>
        </div>`;
        return;
    }
    
    listContainer.innerHTML = '';
    documents.forEach(doc => {
        const item = document.createElement('div');
        item.className = 'document-list-item interactive';
        item.innerHTML = `
            <div class="doc-item-header">
                <h6>${doc.title}</h6>
                        <div class="doc-item-actions">
                            <button class="mini-btn" onclick="editDocument('${doc.id}')" title="Edit">✏️</button>
                            <button class="mini-btn" onclick="shareDocument('${doc.id}')" title="Share">🔗</button>
                            <button class="mini-btn" onclick="collaborateDocument('${doc.id}')" title="Collaborate with Circle">👥</button>
                            ${doc.status === 'pending' ? '<button class="mini-btn" onclick="approveDocument(\'' + doc.id + '\')" title="Approve">✅</button>' : ''}
                        </div>
            </div>
            <div class="doc-item-meta">
                <span class="doc-author">@${doc.author}</span>
                <span class="doc-version">v${doc.version}</span>
                <span class="doc-status ${doc.status}">${doc.status}</span>
                ${doc.type === 'shared' ? '<span class="doc-shared">👥 Shared</span>' : ''}
            </div>
            <div class="doc-item-date">${formatRelativeTime(doc.updated_at)}</div>
        `;
        
        // Click to open document
        item.addEventListener('click', (e) => {
            if (!e.target.classList.contains('mini-btn')) {
                openDocument(doc);
            }
        });
        
        listContainer.appendChild(item);
    });
}

// Document actions
window.editDocument = function(docId) {
    console.log('Edit document:', docId);
    window.openDocumentModal(docId);
};

window.shareDocument = function(docId) {
    console.log('Share document:', docId);
    showNotification('Share functionality coming soon! 🔗', 'info');
};

window.collaborateDocument = function(docId) {
    console.log('Collaborate on document:', docId);
    // Open collaboration modal
    showCollaborationModal(docId);
};

function showCollaborationModal(docId) {
    // Create modal dynamically
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>🤝 Collaborate on Document</h3>
            <p>Choose your circle members to collaborate with:</p>
            
            <div id="collaboration-circles" style="margin: 16px 0;">
                <div class="circle-option">
                    <input type="radio" id="care-circle" name="circle-type" value="care">
                    <label for="care-circle">👩‍⚕️ My Care Circle (3 members)</label>
                </div>
                <div class="circle-option" style="margin-top: 8px;">
                    <input type="radio" id="professional-circle" name="circle-type" value="professional">
                    <label for="professional-circle">🏢 My Professional Circle (2 members)</label>
                </div>
            </div>
            
            <div id="collaboration-actions" style="background: var(--blue-50); padding: 12px; border-radius: 6px; margin: 16px 0;">
                <h5>🤖 Available Collaboration Actions:</h5>
                <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                    <button class="mini-btn" onclick="requestFeedback('${docId}')">💬 Request Feedback</button>
                    <button class="mini-btn" onclick="requestApproval('${docId}')">✅ Request Approval</button>
                    <button class="mini-btn" onclick="requestEdits('${docId}')">✏️ Request Edits</button>
                    <button class="mini-btn" onclick="shareForReview('${docId}')">👀 Share for Review</button>
                </div>
                <p style="font-size: 12px; color: var(--gray-600); margin-top: 8px;">
                    💡 Companions will autonomously help with document collaboration
                </p>
            </div>
            
            <div class="modal-actions">
                <button class="secondary" onclick="closeCollaborationModal(this)">Cancel</button>
                <button class="primary" onclick="startCollaboration('${docId}', this)">Start Collaboration</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

window.closeCollaborationModal = function(button) {
    button.closest('.modal').remove();
};

window.startCollaboration = function(docId, button) {
    const modal = button.closest('.modal');
    const selectedCircle = modal.querySelector('input[name="circle-type"]:checked');
    
    if (!selectedCircle) {
        showNotification('Please select a circle to collaborate with', 'error');
        return;
    }
    
    const circleType = selectedCircle.value;
    showNotification(`🤝 Started collaboration with ${circleType} circle on document!`, 'success');
    
    // TODO: Integrate with existing DocumentAgent collaboration
    console.log(`Collaborating on document ${docId} with ${circleType} circle`);
    
    modal.remove();
};

// Individual collaboration actions
window.requestFeedback = function(docId) {
    showNotification('📝 Feedback request sent to circle members!', 'success');
    console.log('Requesting feedback on document:', docId);
};

window.requestApproval = async function(docId) {
    try {
        const command = `/doc share ${docId} approval_needed`;
        await window.sendMessage(command);
        showNotification('✅ Approval request sent via CLI!', 'success');
    } catch (error) {
        console.error('Error requesting approval:', error);
        showNotification('Failed to request approval', 'error');
    }
};

window.requestEdits = async function(docId) {
    try {
        const command = `/doc discuss ${docId} "Please review and suggest edits"`;
        await window.sendMessage(command);
        showNotification('✏️ Edit request sent via CLI!', 'success');
    } catch (error) {
        console.error('Error requesting edits:', error);
        showNotification('Failed to request edits', 'error');
    }
};

window.shareForReview = async function(docId) {
    try {
        const command = `/doc share ${docId} circle_members`;
        await window.sendMessage(command);
        showNotification('👀 Document shared for review via CLI!', 'success');
    } catch (error) {
        console.error('Error sharing document:', error);
        showNotification('Failed to share document', 'error');
    }
};

window.approveDocument = async function(docId) {
    try {
        const command = `/doc approve ${docId}`;
        await window.sendMessage(command);
        showNotification('Document approved via CLI! ✅', 'success');
        // Refresh the document list
        setTimeout(() => {
            loadDocuments(document.querySelector('.filter-btn.active')?.dataset.filter || 'all');
        }, 1000);
    } catch (error) {
        console.error('Error approving document:', error);
        showNotification('Failed to approve document', 'error');
    }
};

window.openDocument = function(doc) {
    console.log('Open document:', doc);
    window.openDocumentModal(doc.id);
};

function formatRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays} days ago`;
}

// Initialize document modal when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    setupDocumentModal();
});
