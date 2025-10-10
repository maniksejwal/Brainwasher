/**
 * @fileoverview GUI Application
 * USES SHARED API CLIENT - zero duplication with CLI!
 */

import config from './config.js';
import ApiClient from '../shared/apiClient.js';

// Create shared API client (same as CLI uses!)
const api = new ApiClient(config.ORCHESTRATOR_URL);

// State (REUSE from client/state.js pattern)
const state = {
    username: null,
    userId: null,
    currentCircleId: null,
    currentPatientUsername: null,
    allRoles: [],
    messages: [],
    eventSource: null
};

// ====== LOGIN (REUSE client/network.js::login pattern) ======
document.getElementById('login-btn').addEventListener('click', async () => {
    const username = document.getElementById('username').value.trim();
    if (!username) return;

    try {
        // Use shared API client (same as CLI!)
        const data = await api.login(username);
        
        // Update state (SAME as CLI)
        state.username = username;
        state.userId = data.userId;
        state.currentCircleId = data.activeCircleId;
        state.currentPatientUsername = data.patientUsername;
        state.allRoles = data.allRoles || [];

        // Show app
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('app-screen').classList.add('active');
        
        // Update UI
        document.getElementById('current-context').textContent = `@${data.patientUsername}`;
        document.getElementById('username-display').textContent = username;
        document.getElementById('role-badge').textContent = data.allRoles.join(', ') || 'patient';

        // Connect to events (REUSE SSE pattern)
        connectToEventSource();
        
        addSystemMessage(`Welcome ${data.isNewUser ? '' : 'back'}, ${username}!`);
    } catch (error) {
        alert('Login failed: ' + error.message);
    }
});

// ====== EVENT SOURCE (REUSE via shared API client) ======
function connectToEventSource() {
    // Browser has native EventSource - use helper to get URL
    state.eventSource = new EventSource(api.getEventSourceUrl(state.userId));

    state.eventSource.onmessage = (e) => {
        const data = JSON.parse(e.data);

        if (data.type === 'message') {
            displayMessage(data);
        } else if (data.type === 'escalation') {
            displayEscalation(data);
        } else if (data.type === 'context_switched') {
            state.currentCircleId = data.newCircleId;
            state.currentPatientUsername = data.patientUsername;
            document.getElementById('current-context').textContent = `@${data.patientUsername}`;
            document.getElementById('role-badge').textContent = data.newRole;
            addSystemMessage(`Switched to ${data.patientUsername}'s circle`);
        }
    };

    state.eventSource.onerror = () => {
        addSystemMessage('Connection lost. Reconnecting...');
    };
}

// ====== SEND MESSAGE (REUSE client/network.js pattern) ======
async function sendMessage(message) {
    if (!message.trim()) return;

    // Display immediately
    addUserMessage(message);

    try {
        // Use shared API client (same code as CLI!)
        if (message.startsWith('/')) {
            await api.sendCommand(state.userId, state.currentCircleId, message);
        } else {
            await api.sendMessage(state.userId, state.currentCircleId, message);
        }
    } catch (error) {
        addSystemMessage('Error sending message: ' + error.message);
    }
}

// Message input handler
document.getElementById('send-btn').addEventListener('click', () => {
    const input = document.getElementById('message-input');
    sendMessage(input.value);
    input.value = '';
});

document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage(e.target.value);
        e.target.value = '';
    }
});

// ====== UI HELPERS ======
function displayMessage(data) {
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

function addUserMessage(message) {
    const container = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message user';
    div.textContent = message;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function addSystemMessage(message) {
    const container = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message system';
    div.textContent = '⚙️ ' + message;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function displayEscalation(data) {
    addSystemMessage(`🚨 Escalation: ${data.details}`);
}

// ====== QUICK FEEDBACK ======
let feedbackModalVisible = false;

document.getElementById('message-input').addEventListener('keydown', (e) => {
    // Ctrl+F or Cmd+F for quick feedback
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        showFeedbackModal();
    }
});

function showFeedbackModal() {
    document.getElementById('feedback-modal').classList.add('active');
    feedbackModalVisible = true;
}

document.getElementById('cancel-feedback').addEventListener('click', () => {
    document.getElementById('feedback-modal').classList.remove('active');
    feedbackModalVisible = false;
});

document.querySelectorAll('.feedback-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        // Highlight selected
        document.querySelectorAll('.feedback-btn').forEach(b => b.style.outline = '');
        btn.style.outline = '2px solid var(--google-blue)';
    });
});

document.getElementById('submit-feedback').addEventListener('click', async () => {
    const selected = document.querySelector('.feedback-btn[style*="outline"]');
    if (!selected) {
        alert('Please select a rating');
        return;
    }

    const score = selected.dataset.score;
    const comment = document.getElementById('feedback-comment').value;

    await sendMessage(`/feedback ${score > 0 ? '+' : ''}${score} "${comment}"`);
    
    document.getElementById('feedback-modal').classList.remove('active');
    document.getElementById('feedback-comment').value = '';
    document.querySelectorAll('.feedback-btn').forEach(b => b.style.outline = '');
    
    addSystemMessage('Feedback submitted!');
});

// ====== VIEW SWITCHING ======
document.getElementById('circle-btn').addEventListener('click', () => {
    switchView('circle');
    loadCircleInfo();
});

document.getElementById('feedback-btn').addEventListener('click', () => {
    switchView('feedback');
    loadFeedbackData();
    loadConversationsData();
});

document.getElementById('view-selector').addEventListener('click', () => {
    switchView('chat');
});

function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${viewName}-view`).classList.add('active');
    
    const selector = document.getElementById('view-selector');
    selector.textContent = viewName.charAt(0).toUpperCase() + viewName.slice(1);
}

// ====== CIRCLE INFO ======
async function loadCircleInfo() {
    // Send /circle command
    await sendMessage('/circle');
    // Response will come via SSE and display in chat
}

// ====== FEEDBACK DATA (NEW - CLI doesn't have this!) ======
async function loadFeedbackData() {
    const feedbackList = document.getElementById('feedback-list');
    feedbackList.innerHTML = '<div class="loading">Loading feedback...</div>';

    try {
        // Use shared API client
        const feedback = await api.getFeedback(state.userId);

        if (feedback.length === 0) {
            feedbackList.innerHTML = '<p>No feedback yet. Use Ctrl+F to rate interactions!</p>';
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

// Tab switching within feedback view
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
        
        tab.classList.add('active');
        document.getElementById(tabName).classList.add('active');
        
        // Load data for specific tabs
        if (tabName === 'conversations') {
            loadConversationsData();
        } else if (tabName === 'logs') {
            loadServerLogs();
        }
    });
});

// ====== CONVERSATIONS DATA (NEW!) ======
async function loadConversationsData() {
    const conversationsList = document.getElementById('conversations-list');
    conversationsList.innerHTML = '<div class="loading">Loading conversations...</div>';

    try {
        // Use shared API client
        const conversations = await api.getConversations(state.userId);

        if (conversations.length === 0) {
            conversationsList.innerHTML = '<p>No conversations yet.</p>';
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
            
            // Click to expand
            div.addEventListener('click', () => {
                showConversationDetail(conv);
            });
            
            conversationsList.appendChild(div);
        });
    } catch (error) {
        conversationsList.innerHTML = '<p>Error loading conversations</p>';
    }
}

function showConversationDetail(conversation) {
    const detail = document.createElement('div');
    detail.className = 'conversation-detail';
    detail.style.position = 'fixed';
    detail.style.top = '50px';
    detail.style.left = '50%';
    detail.style.transform = 'translateX(-50%)';
    detail.style.width = '80%';
    detail.style.maxHeight = '80vh';
    detail.style.overflow = 'auto';
    detail.style.background = 'white';
    detail.style.border = '1px solid #ddd';
    detail.style.borderRadius = '8px';
    detail.style.padding = '20px';
    detail.style.boxShadow = '0 4px 20px rgba(0,0,0,0.1)';
    detail.style.zIndex = '1000';
    
    let html = `
        <button id="close-detail" style="float:right;">✖</button>
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

// ====== SIMULATION (NEW - CLI doesn't have this!) ======
document.getElementById('run-simulation').addEventListener('click', async () => {
    const resultsDiv = document.getElementById('simulation-results');
    resultsDiv.innerHTML = '<div class="loading">Running simulation...</div>';

    try {
        // Use shared API client
        const results = await api.runSimulation(5);
        resultsDiv.innerHTML = `<p>✅ Completed ${results.runs} simulations</p>`;
    } catch (error) {
        resultsDiv.innerHTML = `<p>❌ Error: ${error.message}</p>`;
    }
});

// ====== ANALYSIS (NEW - CLI doesn't have this!) ======
document.getElementById('generate-analysis').addEventListener('click', async () => {
    const resultsDiv = document.getElementById('analysis-results');
    resultsDiv.innerHTML = '<div class="loading">Generating analysis...</div>';

    try {
        // Use shared API client
        const analysis = await api.generateAnalysis();
        resultsDiv.innerHTML = `
            <h4>Performance Analysis</h4>
            <p>Average Score: ${analysis.avgScore}</p>
            <p>Total Interactions: ${analysis.total}</p>
        `;
    } catch (error) {
        resultsDiv.innerHTML = `<p>❌ Error: ${error.message}</p>`;
    }
});

// ====== SERVER LOGS ======
async function loadServerLogs() {
    const logsContainer = document.getElementById('logs-container');
    logsContainer.innerHTML = '<div class="loading">Loading logs...</div>';

    try {
        const data = await api.getLogs(100);
        
        if (data.logs.length === 0) {
            logsContainer.innerHTML = '<p>No logs yet.</p>';
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
        
        // Auto-scroll to bottom
        logsContainer.scrollTop = logsContainer.scrollHeight;
    } catch (error) {
        logsContainer.innerHTML = '<p>Error loading logs</p>';
    }
}

document.getElementById('refresh-logs').addEventListener('click', () => {
    loadServerLogs();
});

