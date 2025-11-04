/**
 * @fileoverview Clean Simulation Driver
 * Orchestrates simulation scenarios with real AI integration
 */

import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { getPersona } from './personas.js';
import { SyntheticUser } from './synthetic_user.js';
import { simulationClientManager } from './simulation_client.js';
import { escalationNotificationSystem } from './escalation_notification_system.js';
import { syntheticUserFeedback } from './synthetic_user_feedback.js';
import { ConversationRunner } from './conversation_runner.js';

// Safety: Use separate database for simulations
const SIMULATION_DB_PATH = './care_circle_simulation.db';

export class SimulationDriver {
    constructor(options = {}) {
        this.dbPath = options.dbPath || SIMULATION_DB_PATH;
        this.db = null;
        this.syntheticUsers = [];
        this.runId = Date.now(); // Unique ID for this simulation run
        this.conversationId = `sim_${this.runId}`;
        this.scenarioId = null; // Will be set when scenario is selected
        this.promptVersion = null; // Will be set when scenario is selected
        this.logResults = options.logResults !== false;
        this.autoFeedback = options.autoFeedback !== false;
        this.progressCallback = options.progressCallback || null;
        
        // Initialize escalation notification system
        escalationNotificationSystem.initialize();
    }

    /**
     * Initialize simulation database (separate from production)
     */
    async initializeDatabase() {
        // Suppress verbose database logs unless in debug mode
        if (process.env.SIMULATION_DEBUG === 'true') {
        console.log(`[Simulator] Initializing test database: ${this.dbPath}`);
        }
        
        // Safety check: Never use production database
        if (this.dbPath.includes('care_circle.db') && !this.dbPath.includes('simulation')) {
            throw new Error('SAFETY: Attempted to use production database for simulation!');
        }

        this.db = await open({
            filename: this.dbPath,
            driver: sqlite3.Database
        });

        // No database clearing needed - each run uses unique IDs to prevent contamination
        // All data is preserved for analysis and training

        // Use EXACT same schema as real system
        await this.db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

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
            CREATE TABLE IF NOT EXISTS directives (
                directive_id INTEGER PRIMARY KEY AUTOINCREMENT,
                circle_id TEXT NOT NULL,
                doctor_id TEXT NOT NULL,
                type TEXT NOT NULL,
                details TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                is_acknowledged INTEGER DEFAULT 0,
                FOREIGN KEY (circle_id) REFERENCES care_circles(circle_id),
                FOREIGN KEY (doctor_id) REFERENCES users(user_id)
            );
            CREATE TABLE IF NOT EXISTS pending_actions ( 
                action_id TEXT PRIMARY KEY, 
                circle_id TEXT NOT NULL, 
                user_id TEXT NOT NULL, 
                action_type TEXT NOT NULL, 
                details TEXT NOT NULL, 
                created_at INTEGER NOT NULL 
            );
            CREATE TABLE IF NOT EXISTS implied_consent ( 
                user_id TEXT NOT NULL, 
                circle_id TEXT NOT NULL, 
                topic TEXT NOT NULL, 
                expires_at INTEGER NOT NULL, 
                PRIMARY KEY (user_id, circle_id, topic) 
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
                timestamp INTEGER NOT NULL,
                source TEXT DEFAULT 'simulation',
                goal_adherence_score REAL,
                goal_history_score REAL,
                goal_conversation_score REAL,
                critical_failure BOOLEAN DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            );
            CREATE TABLE IF NOT EXISTS detailed_feedback (
                report_id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT,
                message_id INTEGER,
                user_id TEXT NOT NULL,
                circle_id TEXT,
                category TEXT NOT NULL,
                source TEXT,
                description TEXT,
                details TEXT,
                context TEXT,
                severity TEXT,
                prompt_version TEXT,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            );
        `);

            // Suppress schema logs unless in debug mode
            if (process.env.SIMULATION_DEBUG === 'true') {
        console.log('[Simulator] Test database initialized');
            }
    }

    /**
     * Create synthetic users from configuration
     */
    async createSyntheticUsers(userConfigs) {
        // Suppress user creation logs unless in debug mode
        if (process.env.SIMULATION_DEBUG === 'true') {
        console.log(`[Simulator] Creating ${userConfigs.length} synthetic users...`);
        }

        for (const config of userConfigs) {
            // userId may be missing in scenario configs - generate fallback
            const userId = config.userId || `sim_${config.role}_${Date.now()}`;
            const { role, personaKey, personaOptions } = config;
            
            // Support multiple persona options: if personaOptions array exists, randomly select one
            let selectedPersonaKey = personaKey;
            if (personaOptions && Array.isArray(personaOptions) && personaOptions.length > 0) {
                // Randomly select from options
                selectedPersonaKey = personaOptions[Math.floor(Math.random() * personaOptions.length)];
            }
            
            const personaData = getPersona(role, selectedPersonaKey);
            
            // Create run-specific user ID to prevent contamination
            const runSpecificUserId = `${userId}_run_${this.runId}`;
            
            const syntheticUser = new SyntheticUser(runSpecificUserId, role, selectedPersonaKey, personaData);
            this.syntheticUsers.push(syntheticUser);

            // Create simulation client for this user to receive notifications
            simulationClientManager.createClient(runSpecificUserId, role);

            // Create user in database (matching real schema)
            await this.db.run(
                `INSERT OR REPLACE INTO users (user_id, username, created_at) VALUES (?, ?, ?)`,
                [runSpecificUserId, `sim_${runSpecificUserId}`, Date.now()]
            );

            console.log(`  ✓ Created ${role}: ${runSpecificUserId} (${personaData.name})`);
        }
    }

    /**
     * Create a care circle for simulation
     */
    async createCareCircle(patientId, caregiverIds = []) {
        // patientId and caregiverIds are already run-specific from syntheticUsers
        const circleId = patientId; // Circle ID = patient ID
        
        // Create care circle (matching real schema)
        await this.db.run(
            `INSERT OR REPLACE INTO care_circles (circle_id, primary_patient_id, created_at) VALUES (?, ?, ?)`,
            [circleId, patientId, Date.now()]
        );

        // Add patient to circle (matching real schema)
        await this.db.run(
            `INSERT OR REPLACE INTO care_circle_members (circle_id, user_id, role, consent_level) 
             VALUES (?, ?, 'patient', 'FULL')`,
            [circleId, patientId]
        );

        // Add caregivers (matching real schema)
        for (const caregiverId of caregiverIds) {
            const memberRole = this.syntheticUsers.find(u => u.userId === caregiverId)?.role || 'caregiver';
            await this.db.run(
                `INSERT OR REPLACE INTO care_circle_members (circle_id, user_id, role, consent_level)
                 VALUES (?, ?, ?, 'FULL')`,
                [circleId, caregiverId, memberRole]
            );
        }

        console.log(`[Simulator] Created care circle: ${circleId}`);
        return circleId;
    }

    /**
     * Set scenario and update conversation ID
     */
    setScenario(scenarioKey) {
        this.scenarioId = scenarioKey;
        this.conversationId = `sim_${this.runId}_${scenarioKey}`;
        // Generate dynamic prompt version based on scenario and timestamp
        this.promptVersion = `simulation_v${Date.now()}_${scenarioKey}`;
    }

    /**
     * Run full simulation scenario
     */
    async runScenario(scenarioConfig, scenarioKey) {
        // Set scenario ID and update conversation ID
        this.setScenario(scenarioKey);
        
        console.log(`\n🧪 SIMULATION: ${scenarioConfig.name || scenarioKey}`);
        console.log(`📋 Scenario: ${scenarioConfig.description || 'No description provided'}`);
        console.log(`👥 Users: ${scenarioConfig.users.length} | 🔄 Turns: ${scenarioConfig.turns || 6}\n`);

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
            emitProgress(1, 'Initializing simulation database...', 'Setting up test environment');
        await this.initializeDatabase();

        // Create users
            emitProgress(2, 'Creating synthetic users...', `Setting up ${scenarioConfig.users.length} test users`);
        await this.createSyntheticUsers(scenarioConfig.users);

            // Create care circle for ALL scenarios (single user needs it too)
            emitProgress(3, 'Setting up care circle...', 'Creating patient-caregiver relationships');
            const patientUser = this.syntheticUsers.find(u => u.role === 'patient');
            const caregiverUsers = this.syntheticUsers.filter(u => u.role === 'caregiver');
            const doctorUsers = this.syntheticUsers.filter(u => u.role === 'doctor');
            
            const patientId = patientUser?.userId || this.syntheticUsers[0].userId;
            const caregiverIds = caregiverUsers.map(u => u.userId);
            const doctorIds = doctorUsers.map(u => u.userId);
            
            await this.createCareCircle(patientId, [...caregiverIds, ...doctorIds]);

            // Run conversations
            const totalTurns = scenarioConfig.sessions ? scenarioConfig.sessions * scenarioConfig.turns : scenarioConfig.turns;
            emitProgress(4, 'Starting conversations...', `Running ${totalTurns} conversation turns across ${scenarioConfig.sessions || 1} sessions`);
            
            const conversationRunner = new ConversationRunner(
                this.db, 
                this.conversationId, 
                this.autoFeedback, 
                this.logResults,
                scenarioConfig, // Pass scenario context for evaluation
                this.promptVersion // Pass dynamic prompt version
            );
            
            if (this.syntheticUsers.length === 1) {
                // Single user conversation
                if (scenarioConfig.sessions) {
                    // Multi-session scenario
                    await conversationRunner.runMultiSessionConversation(
                        this.syntheticUsers[0], 
                        scenarioConfig.sessions,
                        scenarioConfig.turns, 
                        emitProgress
                    );
                } else {
                    // Single session scenario
                    await conversationRunner.runSingleUserConversation(
                        this.syntheticUsers[0], 
                        scenarioConfig.turns, 
                        emitProgress
                    );
                }
            } else {
                // Multi-user conversation
                if (scenarioConfig.sessions) {
                    // Multi-session scenario
                    await conversationRunner.runMultiSessionMultiUserConversation(
                        this.syntheticUsers, 
                        scenarioConfig.sessions,
                        scenarioConfig.turns, 
                        emitProgress
                    );
                } else {
                    // Single session scenario
                    await conversationRunner.runMultiUserConversation(
                        this.syntheticUsers, 
                        scenarioConfig.turns, 
                        emitProgress
                    );
                }
            }
            
            emitProgress(5, 'Simulation complete!', 'Analyzing results and generating feedback', { complete: true });

        console.log(`\n✅ SIMULATION COMPLETE: ${scenarioConfig.name}`);
        console.log(`📊 Users: ${scenarioConfig.users.length} | 🔄 Turns: ${scenarioConfig.turns || 6} | 💬 Feedback: ${this.autoFeedback ? 'Auto-generated' : 'Manual'}\n`);

        } catch (error) {
            console.error('[Simulator] Error during simulation:', error.message);
            throw error;
        }
    }

    /**
     * Clean up simulation database
     */
    async cleanup() {
        // Cleanup simulation clients
        simulationClientManager.cleanup();
        
        // Cleanup escalation notification system
        escalationNotificationSystem.cleanup();
        
        // Cleanup synthetic user feedback system to prevent data leakage
        syntheticUserFeedback.cleanup();
        
        if (this.db) {
            await this.db.close();
        }
        // Suppress cleanup logs unless in debug mode
        if (process.env.SIMULATION_DEBUG === 'true') {
        console.log('[Simulator] Cleanup complete (database preserved for analysis)');
    }
}
}

