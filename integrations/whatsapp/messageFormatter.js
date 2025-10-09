/**
 * @fileoverview Format messages for WhatsApp
 * WhatsApp has different formatting than CLI (no ANSI colors, emoji support, etc.)
 */

/**
 * Format agent response for WhatsApp
 */
export function formatForWhatsApp(message, metadata = {}) {
    const { from, patientUsername } = metadata;
    
    // Remove ANSI color codes if any
    let formatted = message.replace(/\u001b\[[0-9;]*m/g, '');
    
    // Add agent identifier (WhatsApp-friendly)
    let prefix = '';
    if (from === 'PersonalAgent') {
        prefix = '🤖 *Your Personal Agent*\n\n';
    } else if (from === 'CareAgent') {
        prefix = `👥 *Care Agent* (${patientUsername})\n\n`;
    } else if (from === 'doctor') {
        prefix = '👨‍⚕️ *Doctor*\n\n';
    } else if (from === 'system') {
        prefix = '⚙️ *System*\n\n';
    }

    formatted = prefix + formatted;

    // WhatsApp markdown formatting
    // *bold*, _italic_, ~strikethrough~
    
    // Limit length (WhatsApp has limits)
    if (formatted.length > 4000) {
        formatted = formatted.substring(0, 3900) + '\n\n_(Message truncated - too long for WhatsApp)_';
    }

    return formatted;
}

/**
 * Format command help for WhatsApp
 */
export function formatCommandHelp(commands) {
    let help = '*📋 Available Commands*\n\n';
    
    for (const [category, cmdList] of Object.entries(commands)) {
        help += `*${category}:*\n`;
        for (const cmd of cmdList) {
            help += `• ${cmd}\n`;
        }
        help += '\n';
    }

    return help;
}

/**
 * Format escalation for WhatsApp (doctors)
 */
export function formatEscalation(escalation) {
    return `🚨 *ESCALATION*\n\n` +
           `Patient: ${escalation.patient_username}\n` +
           `Type: ${escalation.type}\n` +
           `Details: ${escalation.details}\n` +
           `Time: ${new Date(escalation.timestamp).toLocaleString()}`;
}

export default { formatForWhatsApp, formatCommandHelp, formatEscalation };

