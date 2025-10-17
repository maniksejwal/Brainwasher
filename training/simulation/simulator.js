/**
 * @fileoverview training/simulator.js
 * Simulation driver for generating synthetic training data.
 * Uses separate test database to avoid contaminating production data.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import config from '../../config.js';
import { getPersona } from './personas.js';
import { logger as trainingLogger, metrics as metricsCollector } from '../core/index.js';
import { SimulationFeedback } from './simulation_feedback.js';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs/promises';

// Safety: Use separate database for simulations
const SIMULATION_DB_PATH = './care_circle_simulation.db';

class SyntheticUser {
    constructor(userId, role, personaKey, personaData) {
        this.userId = userId;
        this.role = role;
        this.personaKey = personaKey;
        this.persona = personaData;
        this.conversationHistory = [];
        this.goals = [...(personaData.sample_goals || [])];
        this.currentGoalIndex = 0;
        
        // Initialize LLM client
        if (config.CHAT_GPT_KEY) {
            this.openai = new OpenAI({ apiKey: config.CHAT_GPT_KEY });
            this.useOpenAI = true;
        } else if (config.API_KEYS && config.API_KEYS.length > 0) {
            this.genAI = new GoogleGenerativeAI(config.API_KEYS[0]);
            this.useOpenAI = false;
        } else {
            throw new Error('No AI API keys configured');
        }
    }

    /**
     * Generate a realistic message based on persona and context
     */
    async generateMessage(context = {}) {
        const {
            lastAgentMessage = '',
            currentGoal = this.goals[this.currentGoalIndex],
            conversationTurn = this.conversationHistory.length,
            multiUserContext = null
        } = context;

        // Build prompt for synthetic user
        const prompt = this._buildMessagePrompt(lastAgentMessage, currentGoal, conversationTurn, multiUserContext);

        try {
            let message;
            
            if (this.useOpenAI) {
                const response = await this.openai.chat.completions.create({
                    model: 'gpt-4',
                    messages: [
                        { role: 'system', content: this.persona.prompt_template },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.8,
                    max_tokens: 150
                });
                message = response.choices[0].message.content.trim();
            } else {
                const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const result = await model.generateContent(
                    this.persona.prompt_template + '\n\n' + prompt
                );
                message = result.response.text().trim();
            }

            this.conversationHistory.push({
                role: 'user',
                content: message,
                timestamp: Date.now()
            });

            return message;
        } catch (error) {
            console.error(`[SyntheticUser] Error generating message:`, error.message);
            return null;
        }
    }

    /**
     * Build prompt for message generation
     */
    _buildMessagePrompt(lastAgentMessage, goal, turn, multiUserContext) {
        let prompt = `This is conversation turn ${turn + 1}.\n`;
        
        if (goal) {
            prompt += `Your current goal: ${goal}\n`;
        }

        // Add multi-user context if available
        if (multiUserContext) {
            const { otherUsers, patientUser, caregiverUsers, doctorUsers } = multiUserContext;
            prompt += `\nMulti-user conversation context:\n`;
            
            if (patientUser && this.role !== 'patient') {
                prompt += `- Patient: ${patientUser.persona.name}\n`;
            }
            if (caregiverUsers.length > 0 && this.role !== 'caregiver') {
                prompt += `- Caregivers: ${caregiverUsers.map(u => u.persona.name).join(', ')}\n`;
            }
            if (doctorUsers.length > 0 && this.role !== 'doctor') {
                prompt += `- Doctors: ${doctorUsers.map(u => u.persona.name).join(', ')}\n`;
            }
            
            prompt += `\nYou are speaking as a ${this.role}. Consider your role and relationship to others in the conversation.\n`;
        }
        
        if (lastAgentMessage) {
            prompt += `\nThe care agent just said:\n"${lastAgentMessage}"\n`;
            prompt += `\nRespond naturally as your character would. Keep your response brief (1-3 sentences).`;
        } else {
            if (multiUserContext) {
                prompt += `\nInitiate a conversation with your care agent. Consider your role as ${this.role} and express relevant concerns or updates. Keep it brief (1-2 sentences).`;
            } else {
                prompt += `\nInitiate a conversation with your care agent. Express a health concern or update. Keep it brief (1-2 sentences).`;
            }
        }

        return prompt;
    }

    /**
     * Record agent's response
     */
    recordAgentResponse(response) {
        this.conversationHistory.push({
            role: 'agent',
            content: response,
            timestamp: Date.now()
        });
    }

    /**
     * Move to next goal
     */
    advanceGoal() {
        if (this.currentGoalIndex < this.goals.length - 1) {
            this.currentGoalIndex++;
            return true;
        }
        return false;
    }
}

class SimulationDriver {
    constructor(options = {}) {
        this.dbPath = SIMULATION_DB_PATH;
        this.db = null;
        this.syntheticUsers = [];
        this.conversationId = `sim_${Date.now()}`;
        this.maxTurns = options.maxTurns || 10;
        this.logResults = options.logResults !== false;
        this.autoFeedback = options.autoFeedback !== false; // Enable by default
        this.feedbackCollector = null; // Will be initialized after DB is ready
    }

    /**
     * Initialize simulation database (separate from production)
     */
    async initializeDatabase() {
        console.log(`[Simulator] Initializing test database: ${this.dbPath}`);
        
        // Safety check: Never use production database
        if (this.dbPath.includes('care_circle.db') && !this.dbPath.includes('simulation')) {
            throw new Error('SAFETY: Attempted to use production database for simulation!');
        }

        this.db = await open({
            filename: this.dbPath,
            driver: sqlite3.Database
        });

        // Initialize minimal schema for simulation DB
        await this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS users ( 
                user_id TEXT PRIMARY KEY, 
                username TEXT UNIQUE NOT NULL, 
                role TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000) 
            );
            CREATE TABLE IF NOT EXISTS care_circles ( 
                circle_id TEXT PRIMARY KEY, 
                primary_patient_id TEXT NOT NULL, 
                created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000), 
                FOREIGN KEY (primary_patient_id) REFERENCES users(user_id) 
            );
            CREATE TABLE IF NOT EXISTS circle_members ( 
                member_id INTEGER PRIMARY KEY AUTOINCREMENT, 
                circle_id TEXT NOT NULL, 
                user_id TEXT NOT NULL, 
                role TEXT NOT NULL, 
                relationship_type TEXT, 
                consent_level TEXT DEFAULT 'FULL', 
                UNIQUE(circle_id, user_id), 
                FOREIGN KEY (circle_id) REFERENCES care_circles(circle_id), 
                FOREIGN KEY (user_id) REFERENCES users(user_id) 
            );
            CREATE TABLE IF NOT EXISTS detailed_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT,
                message_id INTEGER,
                user_id TEXT,
                circle_id TEXT,
                category TEXT,
                description TEXT,
                context TEXT,
                timestamp INTEGER,
                source TEXT DEFAULT 'simulation'
            );
        `);

        console.log('[Simulator] Test database initialized');
        
        // Initialize feedback collector with simulation database
        this.feedbackCollector = new SimulationFeedback(this.conversationId, this.db);
    }

    /**
     * Create synthetic users
     */
    async createSyntheticUsers(userConfigs) {
        console.log(`[Simulator] Creating ${userConfigs.length} synthetic users...`);

        for (const config of userConfigs) {
            const { userId, role, personaKey } = config;
            const personaData = getPersona(role, personaKey);
            
            const syntheticUser = new SyntheticUser(userId, role, personaKey, personaData);
            this.syntheticUsers.push(syntheticUser);

            // Create user in database
            await this.db.run(
                `INSERT OR REPLACE INTO users (user_id, username, role) VALUES (?, ?, ?)`,
                [userId, `sim_${userId}`, role]
            );

            console.log(`  ✓ Created ${role}: ${userId} (${personaData.name})`);
        }
    }

    /**
     * Create a care circle for simulation
     */
    async createCareCircle(patientId, caregiverIds = []) {
        const circleId = patientId; // Circle ID = patient ID
        
        await this.db.run(
            `INSERT OR REPLACE INTO care_circles (circle_id, primary_patient_id) VALUES (?, ?)`,
            [circleId, patientId]
        );

        // Add patient to circle
        await this.db.run(
            `INSERT OR REPLACE INTO circle_members (circle_id, user_id, role, consent_level) 
             VALUES (?, ?, 'patient', 'FULL')`,
            [circleId, patientId]
        );

        // Add caregivers
        for (const caregiverId of caregiverIds) {
            await this.db.run(
                `INSERT OR REPLACE INTO circle_members (circle_id, user_id, role, consent_level)
                 VALUES (?, ?, 'caregiver', 'FULL')`,
                [circleId, caregiverId]
            );
        }

        console.log(`[Simulator] Created care circle: ${circleId}`);
        return circleId;
    }

    /**
     * Simulate agent response (simplified - calls actual system or mocks)
     */
    async simulateAgentResponse(userId, message, multiUserContext = null) {
        // For now, use a simple mock response
        // In a full implementation, this would call the actual handleMessage function
        // but with the simulation database injected
        
        let mockResponses;
        
        if (multiUserContext) {
            // Multi-user specific responses
            const { activeUser, allUsers } = multiUserContext;
            
            if (activeUser.role === 'patient') {
                mockResponses = [
                    "I understand your concern. How can I help you today?",
                    "Thank you for sharing that with me. Let's work together on this.",
                    "That sounds important. Can you tell me more about what you're experiencing?",
                    "I'm here to support you. What would be most helpful right now?",
                    "I appreciate you reaching out. Let's address this step by step."
                ];
            } else if (activeUser.role === 'caregiver') {
                mockResponses = [
                    "Thank you for the update. How is the patient doing today?",
                    "I appreciate you keeping me informed. What support do you need?",
                    "That's helpful information. How can I assist with the care plan?",
                    "Thank you for your dedication. What challenges are you facing?",
                    "I understand your concern. Let's work together to support the patient."
                ];
            } else if (activeUser.role === 'doctor') {
                mockResponses = [
                    "Thank you for the clinical update. What are your recommendations?",
                    "I appreciate the medical perspective. How can I support the care plan?",
                    "That's important clinical information. What follow-up is needed?",
                    "Thank you for the update. How is the patient responding to treatment?",
                    "I understand the medical situation. What can I help coordinate?"
                ];
            } else {
                mockResponses = [
                    "Thank you for your input. How can I assist?",
                    "I appreciate the information. What would be most helpful?",
                    "Thank you for sharing that. Let's work together on this.",
                    "I understand. How can I support you?",
                    "Thank you for the update. What's the next step?"
                ];
            }
        } else {
            // Single user responses
            mockResponses = [
                "I understand. How are you feeling today?",
                "Thank you for sharing that. Can you tell me more?",
                "That sounds concerning. Have you experienced this before?",
                "I appreciate you letting me know. Let's monitor this together.",
                "That's good to hear. Keep up the great work!",
                "I'm here to support you. Is there anything else I should know?"
            ];
        }

        const response = mockResponses[Math.floor(Math.random() * mockResponses.length)];
        
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
        
        return {
            agent_response: response,
            orchestrator_action: { type: 'NONE' },
            state_vector: {}
        };
    }

    /**
     * Run a simulated conversation (single user)
     */
    async runConversation(user, turns = null, emitProgress = null) {
        const maxTurns = turns || this.maxTurns;
        console.log(`\n[Simulator] Starting conversation with ${user.userId} (${maxTurns} turns max)`);
        console.log(`  Role: ${user.role}, Persona: ${user.persona.name}`);
        console.log('');

        for (let turn = 0; turn < maxTurns; turn++) {
            console.log(`  Turn ${turn + 1}/${maxTurns}:`);

            // Emit turn progress
            if (emitProgress) {
                emitProgress(4, `Turn ${turn + 1}/${maxTurns}`, `Generating conversation with ${user.persona.name}`);
            }

            // Generate user message
            const lastAgentMsg = user.conversationHistory.length > 0
                ? user.conversationHistory[user.conversationHistory.length - 1].content
                : '';
            
            const userMessage = await user.generateMessage({
                lastAgentMessage: lastAgentMsg,
                conversationTurn: turn
            });

            if (!userMessage) {
                console.log('    Failed to generate user message. Ending conversation.');
                break;
            }

            console.log(`    ${user.role.charAt(0).toUpperCase() + user.role.slice(1)}: ${userMessage}`);

            // Simulate agent processing
            const startTime = Date.now();
            const agentResult = await this.simulateAgentResponse(user.userId, userMessage);
            const latency = Date.now() - startTime;

            console.log(`    Agent: ${agentResult.agent_response}`);

            // Record agent response
            user.recordAgentResponse(agentResult.agent_response);

            // Automatic feedback from simulation
            let feedbackData = null;
            if (this.autoFeedback) {
                const feedback = await this.feedbackCollector.provideFeedback(
                    `${this.conversationId}_${user.userId}_${turn}`,
                    user.userId,
                    user.userId, // circleId = userId for patient's own circle
                    null, // messageId - would need to query DB
                    userMessage,
                    agentResult.agent_response,
                    agentResult.orchestrator_action,
                    userMessage
                );

                feedbackData = {
                    issuesFound: feedback.issuesFound,
                    issues: feedback.issues,
                    empathyScore: feedback.empathyScore,
                    escalationScore: feedback.escalationScore,
                    consentScore: feedback.consentScore,
                    overallScore: feedback.overallScore,
                    improvementSuggestions: feedback.improvementSuggestions
                };

                if (feedback.issuesFound > 0) {
                    console.log(`    🔍 Auto-detected ${feedback.issuesFound} issue(s):`);
                    feedback.issues.forEach(issue => {
                        console.log(`       ${issue.category}: ${issue.description}`);
                    });
                }
            }

            // Emit conversation message with feedback to GUI
            if (emitProgress) {
                emitProgress(4, `Turn ${turn + 1}/${maxTurns}`, '', {
                    type: 'simulation_conversation',
                    turn: turn + 1,
                    maxTurns,
                    userMessage,
                    agentResponse: agentResult.agent_response,
                    action: agentResult.orchestrator_action,
                    feedback: feedbackData,
                    userRole: user.role,
                    userId: user.userId
                });
            }

            // Log interaction
            if (this.logResults) {
                await trainingLogger.logInteraction({
                    conversationId: `${this.conversationId}_${user.userId}`,
                    userId: user.userId,
                    message: userMessage,
                    agentResponse: agentResult.agent_response,
                    orchestratorAction: agentResult.orchestrator_action,
                    stateVector: agentResult.state_vector,
                    promptVersion: 'simulation_v1.0',
                    latencyMs: latency,
                    simulation: true,
                    persona: user.personaKey,
                    role: user.role
                });

                await metricsCollector.recordMessageLength(
                    user.userId,
                    userMessage.length,
                    agentResult.agent_response.length
                );
            }

            // Small delay between turns
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`\n  Conversation complete (${user.conversationHistory.length / 2} exchanges)\n`);
    }

    /**
     * Run multi-user conversation simulation
     */
    async runMultiUserConversation(users, turns = null, emitProgress = null) {
        const maxTurns = turns || this.maxTurns;
        const patientUser = users.find(u => u.role === 'patient');
        const caregiverUsers = users.filter(u => u.role === 'caregiver');
        const doctorUsers = users.filter(u => u.role === 'doctor');
        
        console.log(`\n[Simulator] Starting multi-user conversation (${maxTurns} turns max)`);
        console.log(`  Patient: ${patientUser?.persona.name || 'None'}`);
        console.log(`  Caregivers: ${caregiverUsers.map(u => u.persona.name).join(', ') || 'None'}`);
        console.log(`  Doctors: ${doctorUsers.map(u => u.persona.name).join(', ') || 'None'}`);
        console.log('');

        // Create care circle if multiple users
        if (users.length > 1) {
            const patientId = patientUser?.userId || users[0].userId;
            const caregiverIds = caregiverUsers.map(u => u.userId);
            const doctorIds = doctorUsers.map(u => u.userId);
            await this.createCareCircle(patientId, [...caregiverIds, ...doctorIds]);
        }

        for (let turn = 0; turn < maxTurns; turn++) {
            console.log(`  Turn ${turn + 1}/${maxTurns}:`);

            // Rotate through users or let patient initiate most conversations
            let activeUser;
            if (turn === 0 || turn % 3 === 0) {
                // Patient starts and every 3rd turn
                activeUser = patientUser || users[0];
            } else if (turn % 3 === 1 && caregiverUsers.length > 0) {
                // Caregiver speaks
                activeUser = caregiverUsers[Math.floor(Math.random() * caregiverUsers.length)];
            } else if (doctorUsers.length > 0) {
                // Doctor speaks
                activeUser = doctorUsers[Math.floor(Math.random() * doctorUsers.length)];
            } else {
                // Fallback to any user
                activeUser = users[Math.floor(Math.random() * users.length)];
            }

            // Emit turn progress
            if (emitProgress) {
                emitProgress(4, `Turn ${turn + 1}/${maxTurns}`, `${activeUser.role} speaking: ${activeUser.persona.name}`);
            }

            // Generate user message with multi-user context
            const lastAgentMsg = activeUser.conversationHistory.length > 0
                ? activeUser.conversationHistory[activeUser.conversationHistory.length - 1].content
                : '';
            
            const userMessage = await activeUser.generateMessage({
                lastAgentMessage: lastAgentMsg,
                conversationTurn: turn,
                multiUserContext: {
                    otherUsers: users.filter(u => u.userId !== activeUser.userId),
                    patientUser,
                    caregiverUsers,
                    doctorUsers
                }
            });

            if (!userMessage) {
                console.log(`    Failed to generate message from ${activeUser.role}. Ending conversation.`);
                break;
            }

            console.log(`    ${activeUser.role.charAt(0).toUpperCase() + activeUser.role.slice(1)} (${activeUser.persona.name}): ${userMessage}`);

            // Simulate agent processing with multi-user context
            const startTime = Date.now();
            const agentResult = await this.simulateAgentResponse(activeUser.userId, userMessage, {
                activeUser,
                allUsers: users,
                patientUser,
                caregiverUsers,
                doctorUsers
            });
            const latency = Date.now() - startTime;

            console.log(`    Agent: ${agentResult.agent_response}`);

            // Record agent response for all users (they all see it)
            users.forEach(user => user.recordAgentResponse(agentResult.agent_response));

            // Automatic feedback from simulation
            let feedbackData = null;
            if (this.autoFeedback) {
                const feedback = await this.feedbackCollector.provideFeedback(
                    `${this.conversationId}_${activeUser.userId}_${turn}`,
                    activeUser.userId,
                    patientUser?.userId || activeUser.userId, // circleId = patient's ID
                    null, // messageId - would need to query DB
                    userMessage,
                    agentResult.agent_response,
                    agentResult.orchestrator_action,
                    userMessage
                );

                feedbackData = {
                    issuesFound: feedback.issuesFound,
                    issues: feedback.issues,
                    empathyScore: feedback.empathyScore,
                    escalationScore: feedback.escalationScore,
                    consentScore: feedback.consentScore,
                    overallScore: feedback.overallScore,
                    improvementSuggestions: feedback.improvementSuggestions
                };

                if (feedback.issuesFound > 0) {
                    console.log(`    🔍 Auto-detected ${feedback.issuesFound} issue(s):`);
                    feedback.issues.forEach(issue => {
                        console.log(`       ${issue.category}: ${issue.description}`);
                    });
                }
            }

            // Emit conversation message with feedback to GUI
            if (emitProgress) {
                emitProgress(4, `Turn ${turn + 1}/${maxTurns}`, '', {
                    type: 'simulation_conversation',
                    turn: turn + 1,
                    maxTurns,
                    userMessage,
                    agentResponse: agentResult.agent_response,
                    action: agentResult.orchestrator_action,
                    feedback: feedbackData,
                    userRole: activeUser.role,
                    userId: activeUser.userId,
                    multiUser: true,
                    allUsers: users.map(u => ({ role: u.role, persona: u.persona.name }))
                });
            }

            // Log interaction
            if (this.logResults) {
                await trainingLogger.logInteraction({
                    conversationId: `${this.conversationId}_multi`,
                    userId: activeUser.userId,
                    message: userMessage,
                    agentResponse: agentResult.agent_response,
                    orchestratorAction: agentResult.orchestrator_action,
                    stateVector: agentResult.state_vector,
                    promptVersion: 'simulation_v1.0',
                    latencyMs: latency,
                    simulation: true,
                    persona: activeUser.personaKey,
                    role: activeUser.role,
                    multiUser: true,
                    allUsers: users.map(u => ({ userId: u.userId, role: u.role, persona: u.personaKey }))
                });

                await metricsCollector.recordMessageLength(
                    activeUser.userId,
                    userMessage.length,
                    agentResult.agent_response.length
                );
            }

            // Small delay between turns
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const totalExchanges = users.reduce((sum, user) => sum + user.conversationHistory.length, 0) / 2;
        console.log(`\n  Multi-user conversation complete (${totalExchanges} total exchanges)\n`);
    }

    /**
     * Run full simulation scenario
     */
    async runScenario(scenarioConfig) {
        console.log('\n' + '='.repeat(80));
        console.log(`SIMULATION SCENARIO: ${scenarioConfig.name}`);
        console.log('='.repeat(80));

        // Emit progress events if callback provided
        const emitProgress = (step, description, details, extraData) => {
            if (this.progressCallback) {
                this.progressCallback({ 
                    step, 
                    description, 
                    details: extraData || details,
                    ...(extraData && { originalDetails: details })
                });
            }
        };

        // Initialize
        emitProgress(1, 'Initializing simulation database...', 'Setting up test environment');
        await this.initializeDatabase();

        // Create users
        emitProgress(2, 'Creating synthetic users...', `Setting up ${scenarioConfig.users.length} test users`);
        await this.createSyntheticUsers(scenarioConfig.users);

        // Create care circle if specified
        if (scenarioConfig.circle) {
            emitProgress(3, 'Setting up care circle...', 'Creating patient-caregiver relationships');
            await this.createCareCircle(
                scenarioConfig.circle.patientId,
                scenarioConfig.circle.caregiverIds || []
            );
        }

        // Run conversations
        emitProgress(4, 'Starting conversations...', `Running ${scenarioConfig.turns} conversation turns`);
        
        if (this.syntheticUsers.length === 1) {
            // Single user conversation
            await this.runConversation(this.syntheticUsers[0], scenarioConfig.turns, emitProgress);
        } else {
            // Multi-user conversation
            await this.runMultiUserConversation(this.syntheticUsers, scenarioConfig.turns, emitProgress);
        }
        
        emitProgress(5, 'Simulation complete!', 'Analyzing results and generating feedback', { complete: true });

        console.log('='.repeat(80));
        console.log('SIMULATION COMPLETE');
        console.log('='.repeat(80) + '\n');
    }

    /**
     * Clean up simulation database
     */
    async cleanup() {
        if (this.db) {
            await this.db.close();
        }
        
        // Optionally delete simulation database
        // await fs.unlink(this.dbPath);
        console.log('[Simulator] Cleanup complete (database preserved for analysis)');
    }
}

/**
 * Example usage
 */
async function runExampleSimulation() {
    const scenario = {
        name: 'Basic Medication Non-Adherence',
        users: [
            { userId: 'alice', role: 'patient', personaKey: 'medication_nonadherent' }
        ],
        circle: {
            patientId: 'alice',
            caregiverIds: []
        },
        turns: 5
    };

    const simulator = new SimulationDriver({ logResults: true });
    
    try {
        await simulator.runScenario(scenario);
    } finally {
        await simulator.cleanup();
    }
}

// Run if called directly
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || 
    process.argv[1].includes('simulator')) {
    runExampleSimulation().catch(error => {
        console.error('Simulation error:', error);
        process.exit(1);
    });
}

export { SimulationDriver, SyntheticUser };

