/**
 * @fileoverview Clean Simulation Driver
 * Orchestrates simulation scenarios with real AI integration
 */

import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { getPersona } from './personas.js';
import { SyntheticUser } from './synthetic_user.js';
import { ConversationRunner } from './conversation_runner.js';

// Safety: Use separate database for simulations
const SIMULATION_DB_PATH = './care_circle_simulation.db';

export class SimulationDriver {
    constructor(options = {}) {
        this.dbPath = options.dbPath || SIMULATION_DB_PATH;
        this.db = null;
        this.syntheticUsers = [];
        this.conversationId = `sim_${Date.now()}`;
        this.logResults = options.logResults !== false;
        this.autoFeedback = options.autoFeedback !== false;
        this.progressCallback = options.progressCallback || null;
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
                prompt_version TEXT,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            );
        `);

        console.log('[Simulator] Test database initialized');
    }

    /**
     * Create synthetic users from configuration
     */
    async createSyntheticUsers(userConfigs) {
        console.log(`[Simulator] Creating ${userConfigs.length} synthetic users...`);

        for (const config of userConfigs) {
            const { userId, role, personaKey } = config;
            const personaData = getPersona(role, personaKey);
            
            const syntheticUser = new SyntheticUser(userId, role, personaKey, personaData);
            this.syntheticUsers.push(syntheticUser);

            // Create user in database (matching real schema)
            await this.db.run(
                `INSERT OR REPLACE INTO users (user_id, username, created_at) VALUES (?, ?, ?)`,
                [userId, `sim_${userId}`, Date.now()]
            );

            console.log(`  ✓ Created ${role}: ${userId} (${personaData.name})`);
        }
    }

    /**
     * Create a care circle for simulation
     */
    async createCareCircle(patientId, caregiverIds = []) {
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
            emitProgress(4, 'Starting conversations...', `Running ${scenarioConfig.turns} conversation turns`);
            
            const conversationRunner = new ConversationRunner(
                this.db, 
                this.conversationId, 
                this.autoFeedback, 
                this.logResults
            );
            
            if (this.syntheticUsers.length === 1) {
                // Single user conversation
                await conversationRunner.runSingleUserConversation(
                    this.syntheticUsers[0], 
                    scenarioConfig.turns, 
                    emitProgress
                );
            } else {
                // Multi-user conversation
                await conversationRunner.runMultiUserConversation(
                    this.syntheticUsers, 
                    scenarioConfig.turns, 
                    emitProgress
                );
            }
            
            emitProgress(5, 'Simulation complete!', 'Analyzing results and generating feedback', { complete: true });

        console.log('='.repeat(80));
        console.log('SIMULATION COMPLETE');
        console.log('='.repeat(80) + '\n');

        } catch (error) {
            console.error('[Simulator] Error during simulation:', error.message);
            throw error;
        }
    }

    /**
     * Clean up simulation database
     */
    async cleanup() {
        if (this.db) {
            await this.db.close();
        }
        console.log('[Simulator] Cleanup complete (database preserved for analysis)');
    }
}

