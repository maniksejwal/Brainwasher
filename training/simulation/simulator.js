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
            conversationTurn = this.conversationHistory.length
        } = context;

        // Build prompt for synthetic user
        const prompt = this._buildMessagePrompt(lastAgentMessage, currentGoal, conversationTurn);

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
    _buildMessagePrompt(lastAgentMessage, goal, turn) {
        let prompt = `This is conversation turn ${turn + 1}.\n`;
        
        if (goal) {
            prompt += `Your current goal: ${goal}\n`;
        }
        
        if (lastAgentMessage) {
            prompt += `\nThe care agent just said:\n"${lastAgentMessage}"\n`;
            prompt += `\nRespond naturally as your character would. Keep your response brief (1-3 sentences).`;
        } else {
            prompt += `\nInitiate a conversation with your care agent. Express a health concern or update. Keep it brief (1-2 sentences).`;
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
    async simulateAgentResponse(userId, message) {
        // For now, use a simple mock response
        // In a full implementation, this would call the actual handleMessage function
        // but with the simulation database injected
        
        const mockResponses = [
            "I understand. How are you feeling today?",
            "Thank you for sharing that. Can you tell me more?",
            "That sounds concerning. Have you experienced this before?",
            "I appreciate you letting me know. Let's monitor this together.",
            "That's good to hear. Keep up the great work!",
            "I'm here to support you. Is there anything else I should know?"
        ];

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
     * Run a simulated conversation
     */
    async runConversation(patientUser, turns = null, emitProgress = null) {
        const maxTurns = turns || this.maxTurns;
        console.log(`\n[Simulator] Starting conversation with ${patientUser.userId} (${maxTurns} turns max)`);
        console.log(`  Persona: ${patientUser.persona.name}`);
        console.log('');

        for (let turn = 0; turn < maxTurns; turn++) {
            console.log(`  Turn ${turn + 1}/${maxTurns}:`);

            // Emit turn progress
            if (emitProgress) {
                emitProgress(4, `Turn ${turn + 1}/${maxTurns}`, `Generating conversation with ${patientUser.persona.name}`);
            }

            // Generate user message
            const lastAgentMsg = patientUser.conversationHistory.length > 0
                ? patientUser.conversationHistory[patientUser.conversationHistory.length - 1].content
                : '';
            
            const userMessage = await patientUser.generateMessage({
                lastAgentMessage: lastAgentMsg,
                conversationTurn: turn
            });

            if (!userMessage) {
                console.log('    Failed to generate user message. Ending conversation.');
                break;
            }

            console.log(`    User: ${userMessage}`);

            // Simulate agent processing
            const startTime = Date.now();
            const agentResult = await this.simulateAgentResponse(patientUser.userId, userMessage);
            const latency = Date.now() - startTime;

            console.log(`    Agent: ${agentResult.agent_response}`);

            // Record agent response
            patientUser.recordAgentResponse(agentResult.agent_response);

            // Automatic feedback from simulation
            if (this.autoFeedback) {
                const feedback = await this.feedbackCollector.provideFeedback(
                    `${this.conversationId}_${patientUser.userId}_${turn}`,
                    patientUser.userId,
                    patientUser.userId, // circleId = userId for patient's own circle
                    null, // messageId - would need to query DB
                    userMessage,
                    agentResult.agent_response,
                    agentResult.orchestrator_action,
                    userMessage
                );

                if (feedback.issuesFound > 0) {
                    console.log(`    🔍 Auto-detected ${feedback.issuesFound} issue(s):`);
                    feedback.issues.forEach(issue => {
                        console.log(`       ${issue.category}: ${issue.description}`);
                    });
                }
            }

            // Log interaction
            if (this.logResults) {
                await trainingLogger.logInteraction({
                    conversationId: `${this.conversationId}_${patientUser.userId}`,
                    userId: patientUser.userId,
                    message: userMessage,
                    agentResponse: agentResult.agent_response,
                    orchestratorAction: agentResult.orchestrator_action,
                    stateVector: agentResult.state_vector,
                    promptVersion: 'simulation_v1.0',
                    latencyMs: latency,
                    simulation: true,
                    persona: patientUser.personaKey
                });

                await metricsCollector.recordMessageLength(
                    patientUser.userId,
                    userMessage.length,
                    agentResult.agent_response.length
                );
            }

            // Small delay between turns
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`\n  Conversation complete (${patientUser.conversationHistory.length / 2} exchanges)\n`);
    }

    /**
     * Run full simulation scenario
     */
    async runScenario(scenarioConfig) {
        console.log('\n' + '='.repeat(80));
        console.log(`SIMULATION SCENARIO: ${scenarioConfig.name}`);
        console.log('='.repeat(80));

        // Emit progress events if callback provided
        const emitProgress = (step, description, details) => {
            if (this.progressCallback) {
                this.progressCallback({ step, description, details });
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
        for (const user of this.syntheticUsers) {
            if (user.role === 'patient') {
                await this.runConversation(user, scenarioConfig.turns, emitProgress);
            }
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

