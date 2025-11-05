/**
 * @fileoverview World Simulation Package
 * Handles multi-care circle dynamics with role inversions and complex family networks
 * Primary reason: Not breaking existing simulation system
 * 
 * Updated to match regular simulation system features:
 * - Prompt version tracking (prompt_version, prompt_type, system_used)
 * - SimulationFeedback class for proper scoring
 * - ConversationRunner for realistic conversations
 * - Goal tracking (goal_adherence_score, goal_history_score, goal_conversation_score)
 * - Message ID tracking in feedback
 */

import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { WORLD_SCENARIOS } from './world_scenarios.js';
import { WORLD_PERSONAS } from './world_personas.js';
import { ConversationRunner } from '../simulation/conversation_runner.js';
import { SimulationFeedback } from '../simulation/simulation_feedback.js';
import { SyntheticUser } from '../simulation/synthetic_user.js';
import { getPersona } from '../simulation/personas.js';

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
        this.promptVersion = options.promptVersion || `world_v${Date.now()}`;
        this.conversationRunners = new Map(); // Track conversation runners per circle
        this.feedbackCollectors = new Map(); // Track feedback collectors per circle
    }

    /**
     * Initialize world simulation database
     */
    async initializeWorldDatabase() {
        // Use separate database for world simulations
        // Open directly to avoid conflicts with regular simulation database
        this.db = await open({
            filename: this.dbPath,
            driver: sqlite3.Database
        });

        // Create standard tables (required by ConversationRunner and SimulationAI)
        // Also create world-specific tables for tracking
        await this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            
            -- Standard tables (required by ConversationRunner/SimulationAI)
            CREATE TABLE IF NOT EXISTS users ( 
                user_id TEXT PRIMARY KEY, 
                username TEXT UNIQUE NOT NULL, 
                created_at INTEGER NOT NULL 
            );
            CREATE TABLE IF NOT EXISTS care_circles ( 
                circle_id TEXT PRIMARY KEY, 
                primary_patient_id TEXT NOT NULL, 
                created_at INTEGER NOT NULL, 
                FOREIGN KEY (primary_patient_id) REFERENCES users(user_id) 
            );
            CREATE TABLE IF NOT EXISTS care_circle_members ( 
                member_id INTEGER PRIMARY KEY AUTOINCREMENT, 
                circle_id TEXT NOT NULL, 
                user_id TEXT NOT NULL, 
                role TEXT NOT NULL, 
                relationship_type TEXT, 
                consent_level TEXT DEFAULT 'none', 
                session_state TEXT, 
                UNIQUE(circle_id, user_id), 
                FOREIGN KEY (circle_id) REFERENCES care_circles(circle_id), 
                FOREIGN KEY (user_id) REFERENCES users(user_id) 
            );
            CREATE TABLE IF NOT EXISTS messages ( 
                message_id INTEGER PRIMARY KEY AUTOINCREMENT, 
                circle_id TEXT NOT NULL, 
                user_id TEXT NOT NULL, 
                role TEXT NOT NULL, 
                message TEXT NOT NULL, 
                privacy_level TEXT NOT NULL, 
                criticality_level TEXT NOT NULL, 
                timestamp INTEGER NOT NULL, 
                FOREIGN KEY (circle_id) REFERENCES care_circles(circle_id) 
            );
            CREATE TABLE IF NOT EXISTS facts ( 
                fact_key TEXT NOT NULL, 
                circle_id TEXT NOT NULL, 
                reported_by TEXT NOT NULL, 
                value TEXT, 
                timestamp INTEGER NOT NULL, 
                UNIQUE(fact_key, circle_id, reported_by) 
            );
            CREATE TABLE IF NOT EXISTS escalations ( 
                escalation_id INTEGER PRIMARY KEY AUTOINCREMENT, 
                circle_id TEXT NOT NULL, 
                type TEXT NOT NULL, 
                details TEXT NOT NULL, 
                timestamp INTEGER NOT NULL, 
                is_read INTEGER DEFAULT 0 
            );
            CREATE TABLE IF NOT EXISTS pending_actions ( 
                action_id TEXT PRIMARY KEY, 
                circle_id TEXT NOT NULL, 
                user_id TEXT NOT NULL, 
                action_type TEXT NOT NULL, 
                details TEXT NOT NULL, 
                created_at INTEGER NOT NULL 
            );
            CREATE TABLE IF NOT EXISTS future_plans (
                plan_id TEXT PRIMARY KEY,
                circle_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                plan_type TEXT NOT NULL,
                description TEXT NOT NULL,
                scheduled_turn INTEGER,
                scheduled_timestamp INTEGER,
                trigger_type TEXT,
                trigger_value TEXT,
                trigger_details TEXT,
                status TEXT DEFAULT 'pending',
                details TEXT,
                created_at INTEGER NOT NULL,
                executed_at INTEGER,
                FOREIGN KEY (circle_id) REFERENCES care_circles(circle_id),
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            );
            CREATE TABLE IF NOT EXISTS scheduled_messages (
                scheduled_message_id TEXT PRIMARY KEY,
                circle_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                target_user_id TEXT,
                message_text TEXT NOT NULL,
                scheduled_turn INTEGER,
                scheduled_timestamp INTEGER,
                trigger_type TEXT,
                trigger_value TEXT,
                trigger_details TEXT,
                trigger_condition TEXT,
                status TEXT DEFAULT 'pending',
                sent_at INTEGER,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (circle_id) REFERENCES care_circles(circle_id),
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            );
            CREATE TABLE IF NOT EXISTS feedback (
                feedback_id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT,
                message_id INTEGER,
                user_id TEXT NOT NULL,
                circle_id TEXT,
                score INTEGER NOT NULL,
                comment TEXT,
                category TEXT,
                prompt_version TEXT,
                prompt_type TEXT,
                system_used TEXT,
                timestamp INTEGER NOT NULL,
                source TEXT DEFAULT 'world_simulation',
                goal_adherence_score REAL,
                goal_history_score REAL,
                goal_conversation_score REAL,
                critical_failure BOOLEAN DEFAULT 0,
                model_used TEXT,
                model_version TEXT,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            );
            
            -- World-specific tracking tables (for analysis and multi-circle tracking)
            CREATE TABLE IF NOT EXISTS world_users (
                world_user_id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS world_circles (
                world_circle_id TEXT PRIMARY KEY,
                primary_patient_id TEXT NOT NULL,
                circle_name TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (primary_patient_id) REFERENCES world_users(world_user_id)
            );
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
        `);
    }

    /**
     * Create world users who exist across multiple circles
     * Also creates users in standard tables for ConversationRunner
     */
    async createWorldUsers(userConfigs) {
        for (const config of userConfigs) {
            const worldUserId = `${config.username}_world_${this.runId}`;
            
            // Create in world_users table (for tracking)
            await this.db.run(
                `INSERT OR REPLACE INTO world_users (world_user_id, username, created_at) VALUES (?, ?, ?)`,
                [worldUserId, config.username, Date.now()]
            );
            
            // Also create in standard users table (required by ConversationRunner)
            await this.db.run(
                `INSERT OR REPLACE INTO users (user_id, username, created_at) VALUES (?, ?, ?)`,
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
     * Also creates circles in standard tables for ConversationRunner
     */
    async createWorldCircles(circleConfigs) {
        for (const config of circleConfigs) {
            const worldCircleId = `${config.name}_world_${this.runId}`;
            
            // Find the actual user ID (may be prefixed with world_)
            const patientUser = this.worldUsers.find(u => u.worldUserId === config.primaryPatientId || 
                                                         u.username === config.primaryPatientId);
            const patientId = patientUser ? patientUser.worldUserId : config.primaryPatientId;
            
            // Create in world_circles table (for tracking)
            await this.db.run(
                `INSERT OR REPLACE INTO world_circles (world_circle_id, primary_patient_id, circle_name, created_at) VALUES (?, ?, ?, ?)`,
                [worldCircleId, patientId, config.name, Date.now()]
            );
            
            // Also create in standard care_circles table (required by ConversationRunner)
            await this.db.run(
                `INSERT OR REPLACE INTO care_circles (circle_id, primary_patient_id, created_at) VALUES (?, ?, ?)`,
                [worldCircleId, patientId, Date.now()]
            );
            
            this.circles.push({
                worldCircleId,
                name: config.name,
                primaryPatientId: patientId,
                members: config.members
            });
        }
    }

    /**
     * Add members to circles with their roles
     * Also adds to standard tables for ConversationRunner
     */
    async addMembersToCircles() {
        for (const user of this.worldUsers) {
            for (const circleConfig of user.circles) {
                // Find the actual circle ID
                const circle = this.circles.find(c => c.worldCircleId === circleConfig.circleId || 
                                                      c.name === circleConfig.circleId);
                const circleId = circle ? circle.worldCircleId : circleConfig.circleId;
                
                // Add to world_circle_members (for tracking)
                await this.db.run(
                    `INSERT OR REPLACE INTO world_circle_members 
                     (world_circle_id, world_user_id, role, relationship_type, consent_level) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [circleId, user.worldUserId, circleConfig.role, circleConfig.relationship, 'full']
                );
                
                // Also add to standard care_circle_members (required by ConversationRunner)
                await this.db.run(
                    `INSERT OR REPLACE INTO care_circle_members 
                     (circle_id, user_id, role, relationship_type, consent_level) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [circleId, user.worldUserId, circleConfig.role, circleConfig.relationship, 'full']
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
     * Updated to use ConversationRunner for realistic conversations
     */
    async runWorldConversations(scenario) {
        // Set SIMULATION_MODE to ensure proper behavior
        process.env.SIMULATION_MODE = 'true';
        
        // For each circle, run a proper conversation using ConversationRunner
        for (const circle of this.circles) {
            console.log(`\n🌍 Starting conversation for circle: ${circle.name}`);
            
            // Find all users in this circle
            const circleUsers = this.worldUsers.filter(u => 
                u.circles.some(c => c.circleId === circle.worldCircleId)
            );
            
            if (circleUsers.length === 0) {
                console.log(`    ⚠️  No users found for circle ${circle.name}`);
                continue;
            }
            
            // Create SyntheticUser objects for this circle
            const syntheticUsers = [];
            for (const worldUser of circleUsers) {
                const userCircleConfig = worldUser.circles.find(c => c.circleId === circle.worldCircleId);
                if (!userCircleConfig) continue;
                
                // Get persona data - try to find matching persona in regular personas
                let personaData = WORLD_PERSONAS[worldUser.persona];
                
                // If not found in world personas, try regular personas
                if (!personaData) {
                    try {
                        personaData = await getPersona(worldUser.persona);
                    } catch {
                        // Fallback to basic persona
                        personaData = {
                            name: worldUser.persona,
                            age: 50,
                            gender: 'unknown',
                            prompt_template: `You are ${worldUser.username}, a ${userCircleConfig.role} in this care circle.`,
                            sample_goals: [`Have a conversation as ${userCircleConfig.role}`]
                        };
                    }
                }
                
                const syntheticUser = new SyntheticUser(
                    worldUser.worldUserId,
                    userCircleConfig.role,
                    worldUser.persona,
                    personaData
                );
                
                syntheticUsers.push(syntheticUser);
            }
            
            if (syntheticUsers.length === 0) {
                console.log(`    ⚠️  No valid synthetic users created for circle ${circle.name}`);
                continue;
            }
            
            // Create conversation runner for this circle
            const conversationId = `${this.worldId}_${circle.worldCircleId}`;
            const runner = new ConversationRunner(
                this.db,
                conversationId,
                this.autoFeedback,
                this.logResults,
                { scenario: scenario.name, scenarioKey: scenario.key },
                this.promptVersion
            );
            
            // Run conversation based on number of users
            try {
                if (syntheticUsers.length === 1) {
                    // Single user conversation
                    await runner.runSingleUserConversation(
                        syntheticUsers[0],
                        scenario.turns
                    );
                } else {
                    // Multi-user conversation
                    await runner.runMultiUserConversation(
                        syntheticUsers,
                        scenario.turns
                    );
                }
                
                console.log(`\n✅ Completed conversation for circle: ${circle.name}`);
            } catch (error) {
                console.error(`❌ Error in conversation for circle ${circle.name}:`, error.message);
            }
        }
    }


    /**
     * Cleanup world simulation
     */
    async cleanup() {
        // Cleanup conversation runners
        for (const runner of this.conversationRunners.values()) {
            // ConversationRunner doesn't have explicit cleanup, but we can ensure cleanup
        }
        this.conversationRunners.clear();
        this.feedbackCollectors.clear();
        
        if (this.db) {
            await this.db.close();
        }
    }
}
