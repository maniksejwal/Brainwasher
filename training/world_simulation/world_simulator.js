/**
 * @fileoverview World Simulation Package
 * Handles multi-care circle dynamics with role inversions and complex family networks
 * Primary reason: Not breaking existing simulation system
 */

import { getDb } from '../../db/connection.js';
import { WORLD_SCENARIOS } from './world_scenarios.js';
import { WORLD_PERSONAS } from './world_personas.js';

export class WorldSimulator {
    constructor(options = {}) {
        this.dbPath = options.dbPath || './care_circle_world_simulation.db';
        this.db = null;
        this.worldUsers = []; // Users who exist across multiple circles
        this.circles = []; // Multiple care circles in the world
        this.runId = Date.now();
        this.worldId = `world_${this.runId}`;
        this.logResults = options.logResults !== false;
        this.autoFeedback = options.autoFeedback !== false;
    }

    /**
     * Initialize world simulation database
     */
    async initializeWorldDatabase() {
        this.db = await getDb();

        // Create world-specific tables
        await this.db.exec(`
            PRAGMA journal_mode = WAL;
            
            -- World users table (users who exist across multiple circles)
            CREATE TABLE IF NOT EXISTS world_users (
                world_user_id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                created_at INTEGER NOT NULL
            );
            
            -- World circles table (multiple care circles)
            CREATE TABLE IF NOT EXISTS world_circles (
                world_circle_id TEXT PRIMARY KEY,
                primary_patient_id TEXT NOT NULL,
                circle_name TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (primary_patient_id) REFERENCES world_users(world_user_id)
            );
            
            -- World circle members (users in multiple circles with different roles)
            CREATE TABLE IF NOT EXISTS world_circle_members (
                member_id INTEGER PRIMARY KEY AUTOINCREMENT,
                world_circle_id TEXT NOT NULL,
                world_user_id TEXT NOT NULL,
                role TEXT NOT NULL,
                relationship_type TEXT,
                consent_level TEXT DEFAULT 'none',
                session_state TEXT,
                UNIQUE(world_circle_id, world_user_id),
                FOREIGN KEY (world_circle_id) REFERENCES world_circles(world_circle_id),
                FOREIGN KEY (world_user_id) REFERENCES world_users(world_user_id)
            );
            
            -- World messages (messages across all circles)
            CREATE TABLE IF NOT EXISTS world_messages (
                message_id INTEGER PRIMARY KEY AUTOINCREMENT,
                world_circle_id TEXT NOT NULL,
                world_user_id TEXT NOT NULL,
                role TEXT NOT NULL,
                message TEXT NOT NULL,
                privacy_level TEXT NOT NULL,
                criticality_level TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (world_circle_id) REFERENCES world_circles(world_circle_id)
            );
            
            -- World feedback (feedback across all circles)
            CREATE TABLE IF NOT EXISTS world_feedback (
                feedback_id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT,
                world_circle_id TEXT,
                world_user_id TEXT NOT NULL,
                score INTEGER NOT NULL,
                comment TEXT,
                prompt_version TEXT,
                model_used TEXT,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (world_user_id) REFERENCES world_users(world_user_id)
            );
        `);
    }

    /**
     * Create world users who exist across multiple circles
     */
    async createWorldUsers(userConfigs) {
        for (const config of userConfigs) {
            const worldUserId = `${config.username}_world_${this.runId}`;
            
            await this.db.run(
                `INSERT OR REPLACE INTO world_users (world_user_id, username, created_at) VALUES (?, ?, ?)`,
                [worldUserId, config.username, Date.now()]
            );
            
            this.worldUsers.push({
                worldUserId,
                username: config.username,
                persona: config.persona,
                circles: config.circles // Array of { circleId, role, relationship }
            });
        }
    }

    /**
     * Create multiple care circles
     */
    async createWorldCircles(circleConfigs) {
        for (const config of circleConfigs) {
            const worldCircleId = `${config.name}_world_${this.runId}`;
            
            await this.db.run(
                `INSERT OR REPLACE INTO world_circles (world_circle_id, primary_patient_id, circle_name, created_at) VALUES (?, ?, ?, ?)`,
                [worldCircleId, config.primaryPatientId, config.name, Date.now()]
            );
            
            this.circles.push({
                worldCircleId,
                name: config.name,
                primaryPatientId: config.primaryPatientId,
                members: config.members
            });
        }
    }

    /**
     * Add members to circles with their roles
     */
    async addMembersToCircles() {
        for (const user of this.worldUsers) {
            for (const circleConfig of user.circles) {
                await this.db.run(
                    `INSERT OR REPLACE INTO world_circle_members 
                     (world_circle_id, world_user_id, role, relationship_type, consent_level) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [circleConfig.circleId, user.worldUserId, circleConfig.role, circleConfig.relationship, 'full']
                );
            }
        }
    }

    /**
     * Run a world scenario with role inversions
     */
    async runWorldScenario(scenarioKey) {
        const scenario = WORLD_SCENARIOS[scenarioKey];
        if (!scenario) {
            throw new Error(`World scenario '${scenarioKey}' not found`);
        }

        console.log(`\n🌍 WORLD SIMULATION: ${scenario.name}`);
        console.log(`📋 Description: ${scenario.description}`);
        console.log(`👥 Users: ${scenario.users.length} | 🔄 Turns: ${scenario.turns}\n`);

        // Initialize world database
        await this.initializeWorldDatabase();
        
        // Create world users
        await this.createWorldUsers(scenario.users);
        
        // Create world circles
        await this.createWorldCircles(scenario.circles);
        
        // Add members to circles
        await this.addMembersToCircles();

        // Run conversations across circles
        await this.runWorldConversations(scenario);

        console.log(`\n✅ WORLD SIMULATION COMPLETE: ${scenario.name}`);
    }

    /**
     * Run conversations across multiple circles
     */
    async runWorldConversations(scenario) {
        for (let turn = 0; turn < scenario.turns; turn++) {
            console.log(`\n  Turn ${turn + 1}/${scenario.turns}:`);
            
            // Select active circle and user for this turn
            const activeCircle = this.circles[turn % this.circles.length];
            const activeUser = this.worldUsers[turn % this.worldUsers.length];
            
            // Find user's role in this circle
            const userCircleConfig = activeUser.circles.find(c => c.circleId === activeCircle.worldCircleId);
            if (!userCircleConfig) continue;
            
            console.log(`    🌍 Circle: ${activeCircle.name}`);
            console.log(`    👤 User: ${activeUser.username} (${userCircleConfig.role})`);
            
            // Generate user message based on persona and role
            const userMessage = await this.generateUserMessage(activeUser, userCircleConfig, turn);
            console.log(`    💬 ${activeUser.username}: ${userMessage}`);
            
            // Generate agent response
            const agentResponse = await this.generateAgentResponse(userMessage, activeUser, activeCircle, userCircleConfig);
            console.log(`    🤖 Agent: ${agentResponse.reply}`);
            
            // Store conversation
            await this.storeWorldMessage(activeCircle.worldCircleId, activeUser.worldUserId, userCircleConfig.role, userMessage);
            await this.storeWorldMessage(activeCircle.worldCircleId, 'agent', `${userCircleConfig.role}_agent`, agentResponse.reply);
            
            // Generate feedback
            if (this.autoFeedback) {
                await this.generateWorldFeedback(activeCircle.worldCircleId, activeUser.worldUserId, userMessage, agentResponse);
            }
        }
    }

    /**
     * Generate user message based on persona and role
     */
    async generateUserMessage(user, circleConfig, turn) {
        const persona = WORLD_PERSONAS[user.persona];
        const roleContext = `You are ${user.username}, a ${persona.age}-year-old ${persona.gender} who is ${circleConfig.role} in the ${circleConfig.circleId} circle.`;
        
        // Role-specific context
        let roleSpecificContext = '';
        if (circleConfig.role === 'patient') {
            roleSpecificContext = 'You are the primary patient in this care circle.';
        } else if (circleConfig.role === 'caregiver') {
            roleSpecificContext = `You are caring for the patient as their ${circleConfig.relationship}.`;
        }
        
        const fullPrompt = `${roleContext} ${roleSpecificContext} ${persona.prompt_template}`;
        
        // Use synthetic user generation (simplified)
        const responses = persona.sample_responses || ['Hello', 'How are you?', 'I need help'];
        return responses[turn % responses.length];
    }

    /**
     * Generate agent response
     */
    async generateAgentResponse(userMessage, user, circle, circleConfig) {
        // Import the unified agent
        const { processUserMessage } = await import('../../agents/unifiedAgent.js');
        
        try {
            const result = await processUserMessage(
                user.worldUserId,
                circleConfig.role,
                userMessage,
                [], // careCircleMembers - simplified for world simulation
                circle.worldCircleId
            );
            
            return result;
        } catch (error) {
            console.error(`[WorldSimulator] Agent response failed:`, error.message);
            return { reply: "I understand your concern. Let me help you with that." };
        }
    }

    /**
     * Store world message
     */
    async storeWorldMessage(worldCircleId, worldUserId, role, message) {
        await this.db.run(
            `INSERT INTO world_messages (world_circle_id, world_user_id, role, message, privacy_level, criticality_level, timestamp)
             VALUES (?, ?, ?, ?, 'PRIVATE', 'NONE', ?)`,
            [worldCircleId, worldUserId, role, message, Date.now()]
        );
    }

    /**
     * Generate world feedback
     */
    async generateWorldFeedback(worldCircleId, worldUserId, userMessage, agentResponse) {
        // Simplified feedback generation
        const score = Math.random() > 0.7 ? -1 : Math.random() > 0.5 ? 0 : 1;
        const comment = score < 0 ? 'Needs improvement' : score > 0 ? 'Good response' : 'Neutral response';
        
        await this.db.run(
            `INSERT INTO world_feedback (conversation_id, world_circle_id, world_user_id, score, comment, prompt_version, model_used, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [`${this.worldId}_${worldCircleId}`, worldCircleId, worldUserId, score, comment, 'world_v1.0', agentResponse.modelUsed || 'unknown', Date.now()]
        );
    }

    /**
     * Cleanup world simulation
     */
    async cleanup() {
        if (this.db) {
            await this.db.close();
        }
    }
}
