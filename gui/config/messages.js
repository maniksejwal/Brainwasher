/**
 * @fileoverview GUI Message Templates
 * Centralized location for all user-facing messages
 */

export const MESSAGES = {
    // Welcome messages
    WELCOME_NEW: (username) => `Welcome, ${username}! Your personal care circle has been created.`,
    WELCOME_BACK: (username) => `Welcome back, ${username}!`,
    HELP_HINT: '💡 Click the ❓ button in the top right for help and available commands.',
    QUICK_START: 'Quick start: Try "/circle" to see your circle, or just chat naturally!',
    
    // System messages
    CONNECTION_LOST: 'Connection lost. Reconnecting...',
    CONTEXT_SWITCHED: (patientUsername, newRole) => `Switched to ${patientUsername}'s circle (you are: ${newRole})`,
    ESCALATION: (details) => `🚨 Escalation: ${details}`,
    FEEDBACK_SUBMITTED: 'Feedback submitted!',
    
    // Errors
    LOGIN_FAILED: (error) => `Login failed: ${error}`,
    SEND_ERROR: (error) => `Error sending message: ${error}`,
    
    // Loading states
    LOADING_FEEDBACK: 'Loading feedback...',
    LOADING_CONVERSATIONS: 'Loading conversations...',
    LOADING_CIRCLE: 'Loading circle...',
    LOADING_LOGS: 'Loading logs...',
    LOADING_SIMULATION: 'Running simulation...',
    LOADING_ANALYSIS: 'Generating analysis...',
    
    // Empty states
    NO_FEEDBACK: 'No feedback yet. Use Ctrl+F to rate interactions!',
    NO_CONVERSATIONS: 'No conversations yet.',
    NO_LOGS: 'No logs yet.',
    
    // Circle view
    CIRCLE_INSTRUCTIONS: `
        <p>Your care circle members will appear here.</p>
        <button id="add-member-btn" class="primary" style="margin: 16px 0;">Add Member</button>
        <p style="color: #666; font-size: 14px;">
            Or use commands: <code>/care username as relationship</code> or <code>/doc username [as specialty]</code>
        </p>
        <p style="color: #666; font-size: 14px;">
            Examples: <code>/care mom as mother</code>, <code>/doc dr_smith</code>, <code>/doc dr_jones as Cardiology</code>
        </p>
        <p style="color: #666; font-size: 13px; margin-top: 16px;">
            💡 <strong>Consent levels:</strong> Control what information circle members can see.<br>
            • <strong>none</strong> - No access to your information<br>
            • <strong>limited</strong> - Basic updates only<br>
            • <strong>full</strong> - Complete access to all information
        </p>
    `,
    
    // Placeholders
    INPUT_PLACEHOLDER: 'Type a message or /command (❓ for help)',
    FEEDBACK_COMMENT_PLACEHOLDER: 'Optional comment...',
    USERNAME_PLACEHOLDER: 'Enter username',
    
    // Commands list
    COMMANDS: {
        CARE: '/care',
        DOC: '/doc',
        CIRCLE: '/circle',
        SWITCH: '/switch',
        MYCIRCLES: '/mycircles',
        PATIENTS: '/patients',
        SPEC: '/spec',
        LOG: '/log',
        ORDER: '/order',
        AGENT: '/agent',
        FEEDBACK: '/feedback',
        CONSENT: '/consent'
    },
    
    // Feedback options
    FEEDBACK_OPTIONS: {
        SCORES: [
            { value: '1', label: '👍 Good', description: 'Helpful, accurate, appropriate' },
            { value: '0', label: '👌 Neutral', description: 'Acceptable but could be better' },
            { value: '-1', label: '👎 Bad', description: 'Unhelpful, inaccurate, or inappropriate' }
        ],
        EXAMPLES: [
            '/feedback +1 "Great response!"',
            '/feedback 0 "Could be more specific"',
            '/feedback -1 "Missed important detail"'
        ]
    }
};

