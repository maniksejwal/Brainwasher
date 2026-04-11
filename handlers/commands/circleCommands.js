/**
 * @fileoverview Circle management commands
 * Handles listing circles, creating circles, and document commands
 */

import { ProfessionalCircleManager } from '../../agents/social/SpecializedCircleManagers.js';
import { getUserCircles, getDb } from '../../db/index.js';

/**
 * Handle /circles command - List all circles (care + professional)
 */
export async function handleShowAllCircles(userId, circleId, sendMessageToUser) {
    try {
        // Get all care circles
        const careCircles = await getUserCircles(userId);
        
        // Get professional circles
        const manager = new ProfessionalCircleManager(userId);
        const professionalCircles = careCircles.filter(c => c.circle_type === 'professional');
        const medicalCircles = careCircles.filter(c => c.circle_type !== 'professional');

        let reply = `**Your Circles:**\n\n`;

        // Medical/Care Circles
        if (medicalCircles.length > 0) {
            reply += `**🏥 Care Circles (${medicalCircles.length}):**\n`;
            for (const circle of medicalCircles) {
                const members = await getCircleMembers(circle.circle_id);
                reply += `• ${circle.circle_name || 'Personal Care'} (${members.length} members)\n`;
            }
            reply += `\n`;
        }

        // Professional Circles
        if (professionalCircles.length > 0) {
            reply += `**💼 Professional Circles (${professionalCircles.length}):**\n`;
            for (const circle of professionalCircles) {
                const members = await getCircleMembers(circle.circle_id);
                reply += `• ${circle.circle_name || 'Professional'} (${members.length} members)\n`;
            }
        } else {
            reply += `**💼 Professional Circles (0):**\n`;
            reply += `• No professional circles yet. Use /create-circle professional <name> to create one.\n`;
        }

        sendMessageToUser(userId, reply);

    } catch (error) {
        console.error('Error listing circles:', error);
        sendMessageToUser(userId, 'Error retrieving your circles.');
    }
}

/**
 * Handle /create-circle command - Create named circles
 */
export async function handleCreateCircleCommand(userId, circleId, parts, sendMessageToUser) {
    if (parts.length < 3) {
        sendMessageToUser(userId, "Usage: /create-circle <type> <name>\nTypes: professional\nExample: /create-circle professional project_alpha");
        return;
    }

    const circleType = parts[1].toLowerCase();
    const circleName = parts.slice(2).join('_').toLowerCase();

    if (circleType !== 'professional') {
        sendMessageToUser(userId, "Currently only 'professional' circle type is supported.\nUsage: /create-circle professional <name>");
        return;
    }

    try {
        const manager = new ProfessionalCircleManager(userId);
        
        // Check if circle with this name already exists
        const existingCircles = await manager.getUserCircles(userId);
        const existingCircle = existingCircles.find(c => 
            c.circle_type === 'professional' && 
            (c.circle_name === circleName || c.circle_name === `professional_${circleName}`)
        );

        if (existingCircle) {
            sendMessageToUser(userId, `Professional circle '${circleName}' already exists.`);
            return;
        }

        // Create new professional circle
        const newCircle = await manager.createCircle({
            name: `professional_${circleName}`,
            type: 'professional',
            scope: 'intra_org',
            ownerId: userId
        });

        sendMessageToUser(userId, `✅ Created professional circle '${circleName}'.\nUse /target, /support, /expert commands to add members.`);

    } catch (error) {
        console.error('Error creating professional circle:', error);
        sendMessageToUser(userId, `Failed to create professional circle: ${error.message}`);
    }
}

/**
 * Handle /doc commands - Document management
 */
export async function handleDocumentCommand(userId, circleId, parts, sendMessageToUser) {
    if (parts.length < 2) {
        sendMessageToUser(userId, `    **Document Commands:**
/doc create <title>       - Create new document
/doc list                - List your documents  
/doc share <id> <user>   - Share document with user
/doc approve <id>        - Approve document
/doc edit <id>           - Edit document with AI companion help
/doc discuss <id> [question] - Discuss document with AI companion`);
        return;
    }

    const subCommand = parts[1].toLowerCase();

    switch (subCommand) {
        case 'create':
            if (parts.length < 3) {
                sendMessageToUser(userId, 'Usage: /doc create <title>\nExample: /doc create "Project Requirements"');
                return;
            }
            const title = parts.slice(2).join(' ').replace(/"/g, '');
            sendMessageToUser(userId, `📄 Document "${title}" created successfully.\n(Note: Full document system integration pending)`);
            break;

        case 'list':
            sendMessageToUser(userId, `📋 **Your Documents:**
• Project Requirements (Draft) - ID: 101
• API Specification (Review) - ID: 102  
• Contract Terms (Approved) - ID: 103
(Note: Full document system integration pending)`);
            break;

        case 'share':
            if (parts.length < 4) {
                sendMessageToUser(userId, 'Usage: /doc share <doc_id> <username>\nExample: /doc share 101 alice_smith');
                return;
            }
            const docId = parts[2];
            const targetUser = parts[3];
            sendMessageToUser(userId, `📤 Document ${docId} shared with ${targetUser}.\n(Note: Full document system integration pending)`);
            break;

        case 'approve':
            if (parts.length < 3) {
                sendMessageToUser(userId, 'Usage: /doc approve <doc_id>\nExample: /doc approve 101');
                return;
            }
            const approveDocId = parts[2];
            sendMessageToUser(userId, `✅ Document ${approveDocId} approved.\n(Note: Full document system integration pending)`);
            break;

        case 'edit':
            if (parts.length < 3) {
                sendMessageToUser(userId, 'Usage: /doc edit <doc_id>\nExample: /doc edit 101');
                return;
            }
            const editDocId = parts[2];
            sendMessageToUser(userId, `📝 Editing document ${editDocId}...\n✨ **Companion Available**: Ask me questions about the document!\nTry: "What's the main risk in this contract?" or "Help me improve the conclusion"\n(Note: Full document system integration pending)`);
            break;

        case 'discuss':
            if (parts.length < 3) {
                sendMessageToUser(userId, 'Usage: /doc discuss <doc_id> [question]\nExample: /doc discuss 101 "What are the key points?"');
                return;
            }
            const discussDocId = parts[2];
            const question = parts.slice(3).join(' ');
            if (question) {
                sendMessageToUser(userId, `🤖 **Companion Analysis of Document ${discussDocId}:**\n"${question}"\n\n💡 Based on the document, here are the key insights:\n• [Companion would analyze document context here]\n• [Provide relevant suggestions]\n• [Answer specific questions]\n\n(Note: Full AI analysis integration pending)`);
            } else {
                sendMessageToUser(userId, `💬 **Document Discussion Mode** for Doc ${discussDocId}\nAsk me anything about this document:\n• "Summarize the main points"\n• "What risks should I consider?"\n• "Help me rewrite section 3"\n• "Is this legally sound?"`);
            }
            break;

        default:
            sendMessageToUser(userId, `Unknown document command: ${subCommand}
Available: create, list, share, approve`);
    }
}

/**
 * Helper function to get circle members
 */
async function getCircleMembers(circleId) {
    const db = await getDb();
    return await db.all(`
        SELECT u.username, ccm.role, ccm.relationship_type
        FROM care_circle_members ccm
        JOIN users u ON ccm.user_id = u.user_id
        WHERE ccm.circle_id = ?
    `, [circleId]);
}