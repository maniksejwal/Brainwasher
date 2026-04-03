/**
 * @fileoverview Context-Aware Companion Router
 * Routes messages with intelligent context sharing between medical and business domains
 * Supports role-based behavior switching (e.g., clinician in medical vs business context)
 */

import { handleMessage as handleMedicalMessage } from './messageHandler.js';
import { handleCommand as handleMedicalCommand } from './commandHandler.js';
import { handleBusinessNegotiation } from './business/negotiationHandler.js';
import { handleNegotiateCommand } from './business/commands/negotiateCommand.js';
import { handleCRMCommand } from './business/commands/crmCommands.js';
import { handleLegalCommand } from './business/commands/legalCommands.js';
import { handleProposeCommand } from './business/commands/proposeCommand.js';
import { handleAcceptCommand } from './business/commands/acceptCommand.js';
import { handleERPCommand } from './business/commands/erpCommands.js';
import { DocumentAgent } from '../agents/business/documentAgent.js';
import { FormsAgent } from '../agents/business/formsAgent.js';
import sessionManager from '../sessions/sessionManager.js';
import { events } from '../orchestrator.js';
import { getDb } from '../db/connection.js';

// Business command prefixes
const BUSINESS_COMMANDS = [
    '/negotiate', '/propose', '/counter', '/accept', '/reject',
    '/crm', '/legal', '/inventory', '/order', '/invoice', 
    '/doc', '/form', '/meeting', '/discover', '/research', '/org'
];

// Medical command prefixes (existing)
const MEDICAL_COMMANDS = [
    '/care', '/doc', '/switch', '/consent', '/log', '/spec',
    '/agent', '/circle', '/yes', '/no', '/score', '/report', '/feedback'
];

// Context-aware commands (work across domains)
const CONTEXT_AWARE_COMMANDS = [
    '/schedule', '/contacts', '/preferences', '/profile', '/context', '/roles'
];

/**
 * User profiles for context-aware behavior
 */
class UserProfile {
    constructor(userId) {
        this.userId = userId;
        this.medicalProfile = {
            role: null, // 'patient', 'caregiver', 'clinician'
            activeCircles: [],
            behaviorMode: 'empathetic'
        };
        this.businessProfile = {
            roles: [], // Multiple organizational roles
            organizations: [],
            behaviorMode: 'strategic'
        };
        this.contextSharingPrefs = {
            allowCrossDomain: true,
            medicalToBusiness: 'filtered',
            businessToMedical: 'filtered',
            sensitivityLevel: 'medium'
        };
    }

    async loadFromDatabase() {
        const db = await getDb();
        
        // Load organizational roles
        const orgRoles = await db.all(`
            SELECT h.role, h.authority_level, h.department, h.title,
                   o.name as org_name, o.type as org_type,
                   rd.permissions, rd.approval_authority
            FROM org_hierarchies h
            JOIN organizations o ON h.org_id = o.id
            LEFT JOIN role_definitions rd ON h.role = rd.id
            WHERE h.user_id = ? AND h.end_date IS NULL
        `, [this.userId]);

        this.businessProfile.roles = orgRoles;
    }

    getCurrentContext(message, activeSession = null) {
        if (activeSession?.type === 'business') return 'business';
        
        // Analyze message for context clues
        if (this.isMedicalContext(message)) return 'medical';
        if (this.isBusinessContext(message)) return 'business';
        
        return 'general'; // Let companion decide
    }

    isMedicalContext(message) {
        const medicalKeywords = ['patient', 'symptoms', 'diagnosis', 'treatment', 'medication', 'doctor', 'clinic'];
        const lowerMessage = message.toLowerCase();
        return medicalKeywords.some(keyword => lowerMessage.includes(keyword));
    }

    isBusinessContext(message) {
        const businessKeywords = ['negotiate', 'contract', 'deal', 'price', 'proposal', 'meeting', 'client', 'revenue'];
        const lowerMessage = message.toLowerCase();
        return businessKeywords.some(keyword => lowerMessage.includes(keyword));
    }

    getSharedContext(fromDomain, toDomain) {
        if (!this.contextSharingPrefs.allowCrossDomain) return null;
        
        const context = {};
        
        if (this.contextSharingPrefs.medicalToBusiness === 'filtered') {
            if (fromDomain === 'medical' && toDomain === 'business') {
                context.availability = 'limited due to medical commitments';
                context.priorities = 'health-focused decision making';
            } else if (fromDomain === 'business' && toDomain === 'medical') {
                context.timeConstraints = 'active business negotiations';
                context.stressFactors = 'high-stakes business decisions';
            }
        }
        
        return context;
    }
}

// Cache user profiles
const userProfiles = new Map();

async function getUserProfile(userId) {
    if (!userProfiles.has(userId)) {
        const profile = new UserProfile(userId);
        await profile.loadFromDatabase();
        userProfiles.set(userId, profile);
    }
    return userProfiles.get(userId);
}

/**
 * Main context-aware router - determines context and enables intelligent routing
 */
export async function routeMessage(userId, circleId, message) {
    const userProfile = await getUserProfile(userId);
    const isCommand = message.startsWith('/');

    // Check for active business sessions
    const businessSessions = await sessionManager.getUserSessions(userId);
    const activeBusinessSession = businessSessions.length > 0 ? businessSessions[0] : null;

    // Determine current context
    const currentContext = userProfile.getCurrentContext(message, activeBusinessSession);

    if (!isCommand) {
        return await handleNaturalLanguageMessage(userId, circleId, message, userProfile, currentContext, activeBusinessSession);
    }

    // Handle commands
    return await handleCommandMessage(userId, circleId, message, userProfile, currentContext);
}

/**
 * Handle natural language messages with context awareness
 */
async function handleNaturalLanguageMessage(userId, circleId, message, userProfile, context, businessSession) {
    if (businessSession) {
        // In active business session - route to business handler with shared context
        const sharedContext = userProfile.getSharedContext('medical', 'business');
        await handleBusinessNegotiation(userId, message, {
            sessionId: businessSession.id,
            role: businessSession.metadata.roles[userId],
            crossDomainContext: sharedContext
        });
        return;
    }

    if (context === 'business') {
        // Business context but no active session
        const sharedContext = userProfile.getSharedContext('medical', 'business');
        await handleBusinessMessage(userId, circleId, message, sharedContext);
    } else if (context === 'medical') {
        // Medical context - route to medical handler with shared context
        const sharedContext = userProfile.getSharedContext('business', 'medical');
        await handleMedicalMessage(userId, circleId, message);
    } else {
        // General context - companion decides best approach
        await handleGeneralMessage(userId, circleId, message, userProfile);
    }
}

/**
 * Handle command messages with context-aware routing
 */
async function handleCommandMessage(userId, circleId, message, userProfile, context) {
    const parts = message.split(' ');
    const command = parts[0].toLowerCase();

    const sendMessage = (targetUserId, msg) => {
        events.emit('broadcast', {
            targetUsers: [targetUserId],
            reply: msg,
            from: 'companion',
            circleId
        });
    };

    try {
        // Context-aware commands (work across domains)
        if (CONTEXT_AWARE_COMMANDS.some(cmd => command.startsWith(cmd))) {
            await handleContextAwareCommand(userId, parts, sendMessage, userProfile);
            return;
        }

        // Business commands
        if (BUSINESS_COMMANDS.some(cmd => command.startsWith(cmd))) {
            const sharedContext = userProfile.getSharedContext('medical', 'business');
            await routeBusinessCommand(userId, circleId, message, parts, command, sharedContext);
            return;
        }

        // Medical commands
        if (MEDICAL_COMMANDS.some(cmd => command.startsWith(cmd))) {
            const sharedContext = userProfile.getSharedContext('business', 'medical');
            await handleMedicalCommand(userId, circleId, message);
            return;
        }

        // Unknown command
        sendMessage(userId, "I understand you're trying to do something. Could you be more specific about whether this is related to health, business, or something else?");

    } catch (error) {
        console.error('[ContextAwareRouter] Command error:', error);
        sendMessage(userId, '❌ Sorry, I encountered an error processing that request.');
    }
}

/**
 * Route business commands with shared context
 */
async function routeBusinessCommand(userId, circleId, message, parts, command, sharedContext) {
    const sendMessage = (targetUserId, msg) => {
        events.emit('broadcast', {
            targetUsers: [targetUserId],
            reply: msg,
            from: 'companion',
            circleId
        });
    };

    if (command === '/negotiate') {
        await handleNegotiateCommand(userId, parts, sendMessage);
    } else if (command === '/crm') {
        await handleCRMCommand(userId, parts, sendMessage);
    } else if (command === '/legal') {
        await handleLegalCommand(userId, parts, sendMessage);
    } else if (command === '/doc') {
        await handleDocumentCommand(userId, parts, sendMessage);
    } else if (command === '/form') {
        await handleFormCommand(userId, parts, sendMessage);
    } else if (command === '/meeting') {
        await handleMeetingCommand(userId, parts, sendMessage);
    } else if (command === '/discover' || command === '/research') {
        await handleDiscoveryCommand(userId, parts, sendMessage);
    } else {
        // Other business commands not yet implemented
        sendMessage(userId, `Business command "${command}" recognized but not yet implemented.`);
    }
}

/**
 * Handle organizational commands
 */
async function handleOrgCommand(userId, parts, sendMessage) {
    const subcommand = parts[1]?.toLowerCase();

    if (subcommand === 'roles') {
        const userProfile = await getUserProfile(userId);
        
        if (userProfile.businessProfile.roles.length === 0) {
            sendMessage(userId, 'You have no organizational roles. Use the test CLI to add roles: `node tests/test_organizational_roles.js`');
            return;
        }

        let response = '**Your Organizational Roles:**\n\n';
        userProfile.businessProfile.roles.forEach(role => {
            response += `🏢 **${role.org_name}** (${role.org_type})\n`;
            response += `   👤 ${role.title || role.role} in ${role.department}\n`;
            response += `   📊 Authority Level: ${role.authority_level} | Approval Limit: $${role.approval_authority || 0}\n`;
            if (role.permissions) {
                const permissions = JSON.parse(role.permissions);
                response += `   🔑 Permissions: ${permissions.join(', ')}\n`;
            }
            response += '\n';
        });

        sendMessage(userId, response);
    } else {
        sendMessage(userId, 'Organizational commands:\n- `/org roles` - View your roles and permissions');
    }
}

/**
 * Handle context-aware commands that work across domains
 */
async function handleContextAwareCommand(userId, parts, sendMessage, userProfile) {
    const command = parts[0].toLowerCase();

    if (command === '/context') {
        const medical = userProfile.medicalProfile.role || 'None';
        const business = userProfile.businessProfile.roles.length > 0 ? 
            userProfile.businessProfile.roles.map(r => `${r.role} at ${r.org_name}`).join(', ') : 'None';
        
        const context = `**Your Context-Aware Companion:**
Medical Profile: ${medical}
Business Profile: ${business}
Context Sharing: ${userProfile.contextSharingPrefs.allowCrossDomain ? 'Enabled' : 'Disabled'}
Sensitivity Level: ${userProfile.contextSharingPrefs.sensitivityLevel}

Use \`/preferences sharing [none|filtered|full]\` to modify sharing settings.`;
        sendMessage(userId, context);
    } else if (command === '/roles') {
        await handleOrgCommand(userId, ['/org', 'roles'], sendMessage);
    }
}

async function handleBusinessMessage(userId, circleId, message, sharedContext) {
    const response = `I understand you're asking about business matters. ${sharedContext ? 'Based on your medical commitments, ' : ''}would you like to start a negotiation, check your CRM, or explore something else?`;
    
    events.emit('broadcast', {
        targetUsers: [userId],
        reply: response,
        from: 'companion',
        circleId
    });
}

async function handleGeneralMessage(userId, circleId, message, userProfile) {
    // Companion decides best approach with access to both contexts
    const sharedContext = {
        businessInsights: userProfile.getSharedContext('business', 'medical'),
        generalMode: true
    };
    
    await handleMedicalMessage(userId, circleId, message);
}

/**
 * Handle document collaboration commands
 */
async function handleDocumentCommand(userId, parts, sendMessage) {
    const subcommand = parts[1]?.toLowerCase();
    const docAgent = new DocumentAgent(userId, {});

    try {
        if (subcommand === 'create') {
            const title = parts.slice(2).join(' ') || 'Untitled Document';
            const docId = await docAgent.createDocument(title);
            sendMessage(userId, `📄 Created document "${title}" (ID: ${docId.substring(0, 8)})\nUse CLI tool for editing: \`node cli/document_manager.js\``);
            
        } else if (subcommand === 'list') {
            const db = await getDb();
            const docs = await db.all(`
                SELECT d.id, d.title, d.status, d.version, d.updated_at
                FROM org_documents d
                JOIN doc_collaborators dc ON d.id = dc.doc_id
                WHERE dc.user_id = ?
                ORDER BY d.updated_at DESC LIMIT 10
            `, [userId]);
            
            if (docs.length === 0) {
                sendMessage(userId, '📄 No documents found');
                return;
            }
            
            let response = '**Your Recent Documents:**\n\n';
            docs.forEach(doc => {
                const statusEmoji = doc.status === 'approved' ? '✅' : doc.status === 'in_review' ? '⏳' : '📝';
                response += `${statusEmoji} **${doc.title}** (${doc.id.substring(0, 8)}) - v${doc.version}\n`;
                response += `   Status: ${doc.status} | Updated: ${new Date(doc.updated_at).toLocaleDateString()}\n\n`;
            });
            
            sendMessage(userId, response);
            
        } else if (subcommand === 'view' && parts[2]) {
            const docId = parts[2];
            const db = await getDb();
            const doc = await db.get('SELECT * FROM org_documents WHERE id LIKE ?', [`${docId}%`]);
            
            if (!doc) {
                sendMessage(userId, '❌ Document not found');
                return;
            }
            
            let response = `**📄 ${doc.title}**\n`;
            response += `Status: ${doc.status} | Version: ${doc.version}\n`;
            response += `Updated: ${new Date(doc.updated_at).toLocaleString()}\n\n`;
            response += '```markdown\n';
            response += doc.content.substring(0, 1000);
            if (doc.content.length > 1000) response += '\n...[truncated]';
            response += '\n```\n\n';
            response += `Use CLI for full editing: \`node cli/document_manager.js\``;
            
            sendMessage(userId, response);
            
        } else {
            sendMessage(userId, `**Document Commands:**
- \`/doc create [title]\` - Create new document
- \`/doc list\` - List your documents  
- \`/doc view <id>\` - View document content

For full editing capabilities, use: \`node cli/document_manager.js\``);
        }
        
    } catch (error) {
        console.error('[DocumentCommand] Error:', error);
        sendMessage(userId, `❌ Document error: ${error.message}`);
    }
}

/**
 * Handle form commands (/form)
 */
async function handleFormCommand(userId, parts, sendMessage) {
    const formsAgent = new FormsAgent(userId, null);
    const subcommand = parts[1]?.toLowerCase();

    try {
        if (subcommand === 'create') {
            const templateType = parts[2]?.toLowerCase();
            
            if (['contact', 'feedback', 'application', 'video_application', 'incident_report', 'customer_testimonial', 'training_feedback'].includes(templateType)) {
                const formId = await formsAgent.createTemplate(templateType);
                sendMessage(userId, `📋 Created ${templateType.replace('_', ' ')} form (ID: ${formId.substring(0, 8)})\nUse CLI for full management: \`node cli/forms_manager.js\``);
            } else {
                sendMessage(userId, `📋 **Form Templates Available:**

**Standard Templates:**
- \`/form create contact\` - Contact information form
- \`/form create feedback\` - User feedback form  
- \`/form create application\` - Job application with signature

**Multimedia Templates:**
- \`/form create video_application\` - Video application with introduction
- \`/form create incident_report\` - Incident report with evidence
- \`/form create customer_testimonial\` - Video/audio testimonials
- \`/form create training_feedback\` - Training feedback with recordings

For custom forms, use: \`node cli/forms_manager.js\``);
            }
            
        } else if (subcommand === 'list') {
            const forms = await formsAgent.getUserForms();
            
            if (forms.length === 0) {
                sendMessage(userId, '📋 No forms found. Create one with `/form create [template]`');
                return;
            }
            
            let response = '📋 **Your Forms:**\n\n';
            forms.slice(0, 5).forEach(form => {
                response += `**${form.title}** (${form.id.substring(0, 8)})\n`;
                response += `Status: ${form.status} | Responses: ${form.response_count}\n`;
                response += `Created: ${new Date(form.created_at).toLocaleDateString()}\n\n`;
            });
            
            if (forms.length > 5) {
                response += `...and ${forms.length - 5} more forms.\n\n`;
            }
            
            response += `Use CLI for full management: \`node cli/forms_manager.js\``;
            sendMessage(userId, response);
            
        } else if (subcommand === 'view') {
            const formId = parts[2];
            if (!formId) {
                sendMessage(userId, '❌ Please provide form ID: `/form view <id>`');
                return;
            }
            
            const form = await formsAgent.getForm(formId);
            const analytics = await formsAgent.getFormAnalytics(formId);
            
            let response = `📋 **${form.title}**\n\n`;
            response += `Description: ${form.description}\n`;
            response += `Status: ${form.status}\n`;
            response += `Fields: ${form.fields.length}\n`;
            response += `Responses: ${analytics.totalCompletions}\n`;
            response += `Completion Rate: ${analytics.completionRate}\n\n`;
            
            response += `**Fields:**\n`;
            form.fields.slice(0, 3).forEach((field, index) => {
                response += `${index + 1}. ${field.field_label} (${field.field_type})${field.required ? ' *' : ''}\n`;
            });
            
            if (form.fields.length > 3) {
                response += `...and ${form.fields.length - 3} more fields.\n\n`;
            } else {
                response += '\n';
            }
            
            response += `Use CLI for detailed view: \`node cli/forms_manager.js\``;
            sendMessage(userId, response);
            
        } else if (subcommand === 'responses') {
            const formId = parts[2];
            if (!formId) {
                sendMessage(userId, '❌ Please provide form ID: `/form responses <id>`');
                return;
            }
            
            const responses = await formsAgent.getFormResponses(formId);
            
            if (responses.length === 0) {
                sendMessage(userId, '📊 No responses yet for this form.');
                return;
            }
            
            let response = `📊 **Form Responses (${responses.length})**\n\n`;
            responses.slice(0, 3).forEach((resp, index) => {
                response += `**Response ${index + 1}** (${resp.id.substring(0, 8)})\n`;
                response += `Submitted: ${new Date(resp.submitted_at).toLocaleDateString()}\n`;
                response += `Status: ${resp.status}\n`;
                
                const responseCount = Object.keys(resp.response_data).length;
                response += `Fields completed: ${responseCount}\n\n`;
            });
            
            if (responses.length > 3) {
                response += `...and ${responses.length - 3} more responses.\n\n`;
            }
            
            response += `Use CLI for detailed analysis: \`node cli/forms_manager.js\``;
            sendMessage(userId, response);
            
        } else {
            sendMessage(userId, `📋 **Form Commands:**
- \`/form create [template]\` - Create form from template
- \`/form list\` - List your forms
- \`/form view <id>\` - View form details
- \`/form responses <id>\` - View form responses

**Templates:** contact, feedback, application, video_application, incident_report, customer_testimonial, training_feedback

For full form management: \`node cli/forms_manager.js\``);
        }
        
    } catch (error) {
        console.error('[FormCommand] Error:', error);
        sendMessage(userId, `❌ Form error: ${error.message}`);
    }
}

async function handleMeetingCommand(userId, parts, sendMessage) {
    sendMessage(userId, '🎥 Meeting analysis system coming soon. This will transcribe and extract action items from meetings.');
}

async function handleDiscoveryCommand(userId, parts, sendMessage) {
    sendMessage(userId, '🔍 Information discovery system coming soon. This will research competitive intelligence and market data.');
}

export default { routeMessage };