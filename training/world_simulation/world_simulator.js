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
import { SCENARIOS } from '../simulation/scenarios.js';
import { WORLD_PERSONAS } from './world_personas.js';
import { ConversationRunner } from '../simulation/conversation_runner.js';
import { SimulationFeedback } from '../simulation/simulation_feedback.js';
import { SyntheticUser } from '../simulation/synthetic_user.js';
import { getPersona } from '../simulation/personas.js';

export class WorldSimulator {
    constructor(options = {}) {
        // Use the same simulation database as regular simulations
        this.dbPath = options.dbPath || './care_circle_simulation.db';
        this.db = null;
        this.worldUsers = []; // Users who exist across multiple circles
        this.circles = []; // Multiple care circles in the world
        this.runId = Date.now();
        this.worldId = `world_${this.runId}`;
        this.conversationId = `world_${this.runId}`; // Main conversation ID for training pipeline compatibility
        this.conversationIds = []; // Track all conversation IDs from multiple circles
        this.scenarioId = null; // Will be set when scenario is selected
        this.logResults = options.logResults !== false;
        this.autoFeedback = options.autoFeedback !== false;
        this.promptVersion = options.promptVersion || process.env.PROMPT_VERSION || `world_v${Date.now()}`;
        this.conversationRunners = new Map(); // Track conversation runners per circle
        this.feedbackCollectors = new Map(); // Track feedback collectors per circle
        this.progressCallback = options.progressCallback || null;
        this.turnOverride = null;
    }

    _makeWorldCircleId(circleConfig, index = 0) {
        const baseName = circleConfig.name || `Circle ${index + 1}`;
        const normalized = baseName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '') || `circle_${index + 1}`;
        return {
            id: `${normalized}_world_${this.runId}`,
            displayName: baseName,
            slug: normalized
        };
    }

    /**
     * Initialize world simulation database
     */
    async initializeWorldDatabase() {
        // Use the same simulation database as regular simulations
        // This allows feedback from world simulations to be included in training analysis
        this.db = await open({
            filename: this.dbPath,
            driver: sqlite3.Database
        });
        
        // Disable foreign key constraints temporarily during setup
        // We'll re-enable them after all data is created
        await this.db.run('PRAGMA foreign_keys = OFF');

        // Create standard tables (required by ConversationRunner and SimulationAI)
        // Also create world-specific tables for tracking
        await this.db.exec(`
            PRAGMA journal_mode = WAL;
            
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
            CREATE TABLE IF NOT EXISTS fact_history ( 
                history_id INTEGER PRIMARY KEY AUTOINCREMENT, 
                fact_key TEXT NOT NULL, 
                circle_id TEXT NOT NULL, 
                reported_by TEXT NOT NULL, 
                value TEXT, 
                timestamp INTEGER NOT NULL 
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
            CREATE TABLE IF NOT EXISTS advice (
                advice_id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                advice_type TEXT NOT NULL,
                advice_text TEXT NOT NULL,
                priority TEXT DEFAULT 'medium',
                timestamp INTEGER NOT NULL
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
        for (let index = 0; index < circleConfigs.length; index += 1) {
            const config = circleConfigs[index];
            const { id: worldCircleId, displayName, slug } = this._makeWorldCircleId(config, index);
            
            // Find the actual user ID (may be prefixed with world_ or just username)
            // Try exact match first, then username match, then prefix match
            let patientUser = this.worldUsers.find(u => u.worldUserId === config.primaryPatientId);
            if (!patientUser) {
                patientUser = this.worldUsers.find(u => u.username === config.primaryPatientId || 
                                                         u.username === config.primaryPatientId.replace('_world_', ''));
            }
            if (!patientUser && config.primaryPatientId.includes('_world_')) {
                // Try matching by username prefix (e.g., 'alice_world_' matches 'alice')
                const usernamePrefix = config.primaryPatientId.split('_world_')[0];
                patientUser = this.worldUsers.find(u => u.username === usernamePrefix);
            }
            
            if (!patientUser) {
                throw new Error(`Primary patient not found for circle ${config.name}. Looking for: ${config.primaryPatientId}, Available users: ${this.worldUsers.map(u => u.username).join(', ')}`);
            }
            
            const patientId = patientUser.worldUserId;
            
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
                slug,
                name: displayName,
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
                // Find the actual circle ID - match by circleId from scenario (e.g., 'alice_circle')
                // to circle name (e.g., 'Alice Circle') to worldCircleId
                const circle = this.circles.find(c => {
                    // Try exact match first
                    if (c.worldCircleId === circleConfig.circleId) return true;
                    // Try matching by name
                    const circleNameNormalized = c.name.toLowerCase().replace(/\s+/g, '_');
                    if (circleConfig.circleId === circleNameNormalized) return true;
                    // Try matching by removing 'Circle' suffix
                    const nameWithoutCircle = c.name.replace(/\s+Circle/i, '').toLowerCase();
                    if (circleConfig.circleId === `${nameWithoutCircle}_circle` || circleConfig.circleId === nameWithoutCircle) return true;
                    // Try reverse matching
                    const circleIdBase = circleConfig.circleId.replace('_circle', '').replace('Circle', '');
                    if (c.name.toLowerCase().includes(circleIdBase)) return true;
                    return false;
                });
                
                if (!circle) {
                    console.warn(`[WorldSimulator] Circle not found for user ${user.username}, circleId: ${circleConfig.circleId}`);
                    console.warn(`[WorldSimulator] Available circles: ${this.circles.map(c => c.name).join(', ')}`);
                    continue;
                }
                
                const circleId = circle.worldCircleId;
                
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
     * Set scenario (for training pipeline compatibility)
     */
    setScenario(scenarioKey) {
        this.scenarioId = scenarioKey;
        this.conversationId = `world_${this.runId}_${scenarioKey}`;
    }

    /**
     * Run scenario (matching SimulationDriver interface for training pipeline)
     * This allows world scenarios to be used in training iterations
     */
    async runScenario(scenarioConfig, scenarioKey, options = {}) {
        // Set scenario ID and update conversation ID
        this.setScenario(scenarioKey);
        const requestedTurns = options.turns ? parseInt(options.turns, 10) : null;
        if (requestedTurns && !Number.isNaN(requestedTurns) && requestedTurns > 0) {
            this.turnOverride = requestedTurns;
        } else {
            this.turnOverride = null;
        }
        
        // Update prompt version from environment if set
        if (process.env.PROMPT_VERSION) {
            this.promptVersion = process.env.PROMPT_VERSION;
        }
        
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

        try {
            // Initialize
            emitProgress(1, 'Initializing world simulation database...', 'Setting up multi-circle environment');
            await this.initializeWorldDatabase();
            
            // Create world users
            emitProgress(2, 'Creating world users...', `Setting up ${scenarioConfig.users.length} users across multiple circles`);
            await this.createWorldUsers(scenarioConfig.users);
            
            // Create world circles
            emitProgress(3, 'Setting up care circles...', `Creating ${scenarioConfig.circles.length} interconnected circles`);
            await this.createWorldCircles(scenarioConfig.circles);
            
            // Add members to circles
            await this.addMembersToCircles();
            
            // Re-enable foreign key constraints after all data is created
            await this.db.run('PRAGMA foreign_keys = ON');

            // Run conversations across circles
            emitProgress(4, 'Starting world conversations...', `Running conversations across ${scenarioConfig.circles.length} circles`);
            await this.runWorldConversations(scenarioConfig);
            this.turnOverride = null;
            
            console.log(`\n✅ WORLD SIMULATION COMPLETE: ${scenarioConfig.name || scenarioKey}`);
        } catch (error) {
            console.error(`[WorldSimulator] Error running scenario: ${error.message}`);
            throw error;
        }
    }

    /**
     * Run a world scenario with role inversions (original method, kept for backward compatibility)
     */
    async runWorldScenario(scenarioKey, options = {}) {
        const scenario = SCENARIOS[scenarioKey];
        if (!scenario) {
            throw new Error(`World scenario '${scenarioKey}' not found`);
        }

        // Use runScenario for consistency
        await this.runScenario(scenario, scenarioKey, options);
    }

    /**
     * Run conversations across multiple circles
     * Updated to use ConversationRunner for realistic conversations
     */
    async runWorldConversations(scenario) {
        // Set SIMULATION_MODE to ensure handlers use the simulation database
        process.env.SIMULATION_MODE = 'true';
        const totalTurns = this.turnOverride || scenario.turns || 6;

        // For each circle, run a proper conversation using ConversationRunner
        for (const circle of this.circles) {
            console.log(`\n🌍 Starting conversation for circle: ${circle.name}`);
            const circleSlug = circle.slug;
            
            // Find all users in this circle
            // Match by circleId from scenario (e.g., 'alice_circle') or by worldCircleId
            // The scenario defines circleId like 'alice_circle', but we create circles with names like 'Alice Circle'
            // We need to match: 'alice_circle' -> 'Alice Circle' -> worldCircleId
            const circleUsers = this.worldUsers.filter(u => 
                u.circles.some(c => {
                    // Try exact match with worldCircleId first
                    if (c.circleId === circle.worldCircleId) return true;
                    // Try matching by slug
                    if (c.circleId === circleSlug) return true;
                    // Try matching by display name normalization
                    const nameWithoutCircle = circle.name.replace(/\s+Circle/i, '').toLowerCase();
                    if (c.circleId === `${nameWithoutCircle}_circle` || c.circleId === nameWithoutCircle) return true;
                    // Also try reverse: if circleId is 'alice_circle', check if circle name contains 'alice'
                    const circleIdBase = c.circleId.replace('_circle', '').replace('Circle', '');
                    if (circle.name.toLowerCase().includes(circleIdBase)) return true;
                    return false;
                })
            );
            
            if (circleUsers.length === 0) {
                console.log(`    ⚠️  No users found for circle ${circle.name}`);
                continue;
            }
            
            // Create SyntheticUser objects for this circle
            const syntheticUsers = [];
            for (const worldUser of circleUsers) {
                // Find the user's circle config - use the same matching logic
                const userCircleConfig = worldUser.circles.find(c => {
                    if (c.circleId === circle.worldCircleId) return true;
                    if (c.circleId === circleSlug) return true;
                    const nameWithoutCircle = circle.name.replace(/\s+Circle/i, '').toLowerCase();
                    if (c.circleId === `${nameWithoutCircle}_circle` || c.circleId === nameWithoutCircle) return true;
                    const circleIdBase = c.circleId.replace('_circle', '').replace('Circle', '');
                    if (circle.name.toLowerCase().includes(circleIdBase)) return true;
                    return false;
                });
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
            // Use circle.worldCircleId directly as conversationId to match the circle users belong to
            const conversationId = circle.worldCircleId;
            this.conversationIds.push(conversationId); // Track for training pipeline
            
            const runner = new ConversationRunner(
                this.db,
                conversationId,
                this.autoFeedback,
                this.logResults,
                { 
                    scenario: scenario.name || scenario.key, 
                    scenarioKey: scenario.key || this.scenarioId,
                    isWorld: true // Mark as world simulation
                },
                this.promptVersion // Pass prompt version for feedback tracking
            );
            
            // Run conversation based on number of users
            try {
                if (syntheticUsers.length === 1) {
                    // Single user conversation
                    await runner.runSingleUserConversation(
                        syntheticUsers[0],
                        totalTurns
                    );
                } else {
                    // Multi-user conversation
                    await runner.runMultiUserConversation(
                        syntheticUsers,
                        totalTurns
                    );
                }
                
                console.log(`\n✅ Completed conversation for circle: ${circle.name}`);
            } catch (error) {
                console.error(`❌ Error in conversation for circle ${circle.name}:`, error.message);
                if (error?.stack) {
                    console.error(error.stack);
                }
                throw error;
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
            try {
                await this.db.close();
            } catch (error) {
                console.warn(`[WorldSimulator] Error closing database: ${error.message}`);
            }
        }
    }
}