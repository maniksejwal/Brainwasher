/**
 * @fileoverview Defines the database schema and provides initialization functions.
 * This module is responsible for creating all the necessary tables and ensuring
 * the database is ready for use when the application starts. The schema is designed
 * to support the Reciprocal Care Circles architecture, with distinct tables for
 * users, circles, memberships, messages, facts, and various action types.
 */

import { getDb } from './connection.js';

export async function initializeDatabase() {
    const db = await getDb();
    await db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS users ( user_id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, profile_data TEXT, preferences TEXT );
        CREATE TABLE IF NOT EXISTS care_circles ( circle_id TEXT PRIMARY KEY, primary_patient_id TEXT NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (primary_patient_id) REFERENCES users(user_id) );
        CREATE TABLE IF NOT EXISTS care_circle_members ( member_id INTEGER PRIMARY KEY AUTOINCREMENT, circle_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, relationship_type TEXT, consent_level TEXT DEFAULT 'none', session_state TEXT, UNIQUE(circle_id, user_id), FOREIGN KEY (circle_id) REFERENCES care_circles(circle_id), FOREIGN KEY (user_id) REFERENCES users(user_id) );
        CREATE TABLE IF NOT EXISTS messages ( message_id INTEGER PRIMARY KEY AUTOINCREMENT, circle_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, message TEXT NOT NULL, privacy_level TEXT NOT NULL, criticality_level TEXT NOT NULL, timestamp INTEGER NOT NULL, FOREIGN KEY (circle_id) REFERENCES care_circles(circle_id) );
        CREATE TABLE IF NOT EXISTS facts ( fact_key TEXT NOT NULL, circle_id TEXT NOT NULL, reported_by TEXT NOT NULL, value TEXT, timestamp INTEGER NOT NULL, UNIQUE(fact_key, circle_id, reported_by) );
        CREATE TABLE IF NOT EXISTS fact_history ( history_id INTEGER PRIMARY KEY AUTOINCREMENT, fact_key TEXT NOT NULL, circle_id TEXT NOT NULL, reported_by TEXT NOT NULL, value TEXT, timestamp INTEGER NOT NULL );
        CREATE TABLE IF NOT EXISTS escalations ( escalation_id INTEGER PRIMARY KEY AUTOINCREMENT, circle_id TEXT NOT NULL, type TEXT NOT NULL, details TEXT NOT NULL, timestamp INTEGER NOT NULL, is_read INTEGER DEFAULT 0 );

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

        CREATE TABLE IF NOT EXISTS pending_actions ( action_id TEXT PRIMARY KEY, circle_id TEXT NOT NULL, user_id TEXT NOT NULL, action_type TEXT NOT NULL, details TEXT NOT NULL, created_at INTEGER NOT NULL );
        CREATE TABLE IF NOT EXISTS implied_consent ( user_id TEXT NOT NULL, circle_id TEXT NOT NULL, topic TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (user_id, circle_id, topic) );
        
        CREATE TABLE IF NOT EXISTS api_usage (
            usage_id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            use_case TEXT,
            prompt_tokens INTEGER,
            completion_tokens INTEGER,
            total_tokens INTEGER,
            cost_usd REAL,
            metadata TEXT
        );

        CREATE TABLE IF NOT EXISTS user_notification_preferences (
            pref_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            channel TEXT NOT NULL,
            event_type TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            config TEXT,
            UNIQUE(user_id, channel, event_type),
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS notification_logs (
            log_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            channel TEXT NOT NULL,
            type TEXT NOT NULL,
            content TEXT,
            status TEXT,
            error_details TEXT,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT,
            message_id INTEGER,
            user_id TEXT,
            circle_id TEXT,
            score INTEGER,
            comment TEXT,
            timestamp INTEGER,
            source TEXT DEFAULT 'user',
            feedback_id INTEGER,
            category TEXT,
            prompt_version TEXT,
            prompt_type TEXT,
            system_used TEXT,
            scenario_name TEXT,
            persona_name TEXT,
            goal_adherence_score REAL,
            goal_history_score REAL,
            goal_conversation_score REAL,
            critical_failure INTEGER,
            model_used TEXT,
            model_version TEXT,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        );
        
        CREATE TABLE IF NOT EXISTS detailed_feedback (
            report_id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT,
            message_id INTEGER,
            user_id TEXT NOT NULL,
            circle_id TEXT,
            category TEXT NOT NULL,
            details TEXT,
            description TEXT,
            context TEXT,
            source TEXT DEFAULT 'simulation',
            scenario_name TEXT,
            persona_name TEXT,
            prompt_version TEXT,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        );
        
        CREATE TABLE IF NOT EXISTS prompt_versions (
            version TEXT PRIMARY KEY,
            name TEXT,
            content TEXT NOT NULL,
            deployed_at TEXT,
            performance_score REAL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        
        CREATE TABLE IF NOT EXISTS system_roles (
            user_id TEXT PRIMARY KEY,
            role TEXT NOT NULL DEFAULT 'user',
            permissions TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        );
        
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        );
    `);
    console.log('[Database] Initialized.');

    // Migrate existing tables to add missing columns
    await migrateDatabase(db);
}

/**
 * Migrate existing database tables to add missing columns.
 * Exported for simulation code that opens its own SQLite file (e.g. WorldSimulator).
 */
export async function migrateDatabase(db) {
    try {
        // Check and add trigger_type to future_plans if missing
        const futurePlansInfo = await db.all('PRAGMA table_info(future_plans)');
        const hasTriggerType = futurePlansInfo.some(col => col.name === 'trigger_type');
        if (!hasTriggerType && futurePlansInfo.length > 0) {
            console.log('[Migration] Adding trigger_type columns to future_plans...');
            await db.run('ALTER TABLE future_plans ADD COLUMN trigger_type TEXT');
            await db.run('ALTER TABLE future_plans ADD COLUMN trigger_value TEXT');
            await db.run('ALTER TABLE future_plans ADD COLUMN trigger_details TEXT');
        }

        // Check and add trigger_type to scheduled_messages if missing
        const scheduledMessagesInfo = await db.all('PRAGMA table_info(scheduled_messages)');
        const hasScheduledTriggerType = scheduledMessagesInfo.some(col => col.name === 'trigger_type');
        if (!hasScheduledTriggerType && scheduledMessagesInfo.length > 0) {
            console.log('[Migration] Adding trigger_type columns to scheduled_messages...');
            await db.run('ALTER TABLE scheduled_messages ADD COLUMN trigger_type TEXT');
            await db.run('ALTER TABLE scheduled_messages ADD COLUMN trigger_value TEXT');
            await db.run('ALTER TABLE scheduled_messages ADD COLUMN trigger_details TEXT');
            await db.run('ALTER TABLE scheduled_messages ADD COLUMN trigger_condition TEXT');
        }

        // Migration for Enhanced User Profiles
        const usersInfo = await db.all('PRAGMA table_info(users)');
        const hasProfileData = usersInfo.some(col => col.name === 'profile_data');
        if (!hasProfileData && usersInfo.length > 0) {
            console.log('[Migration] Adding profile_data and preferences to users...');
            await db.run('ALTER TABLE users ADD COLUMN profile_data TEXT');
            await db.run('ALTER TABLE users ADD COLUMN preferences TEXT');
        }

        // New Structured Facts Table (facts_v2)
        // Check if facts_v2 exists, if not create it
        const factsV2Exists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='facts_v2'");

        if (!factsV2Exists) {
            await db.exec(`
                CREATE TABLE IF NOT EXISTS facts_v2 (
                    fact_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    circle_id TEXT NOT NULL,
                    fact_key TEXT NOT NULL,
                    value TEXT,
                    category TEXT,
                    subject_id TEXT, -- Who is this fact about? (User ID or 'system' or name)
                    target_object TEXT, -- Specific object/body part/topic (optional)
                    sensitivity TEXT DEFAULT 'normal', -- public, circle, private, sensitive
                    observed_at INTEGER, -- Point in time the fact was observed or stated to be true (distinct from validity)
                    confidence REAL DEFAULT 1.0,
                    source_type TEXT DEFAULT 'user',
                    reported_by TEXT NOT NULL,
                    provenance TEXT,
                    valid_from INTEGER,
                    valid_until INTEGER,
                    visibility TEXT DEFAULT 'circle',
                    is_current INTEGER DEFAULT 1,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (circle_id) REFERENCES care_circles(circle_id)
                );
                CREATE INDEX IF NOT EXISTS idx_facts_v2_circle_key ON facts_v2(circle_id, fact_key);
                CREATE INDEX IF NOT EXISTS idx_facts_v2_validity ON facts_v2(valid_from, valid_until);
                CREATE INDEX IF NOT EXISTS idx_facts_v2_subject ON facts_v2(subject_id);
            `);
        } else {
            // Migration for new columns if table exists but cols missing (for dev iteration)
            const info = await db.all('PRAGMA table_info(facts_v2)');
            if (!info.some(c => c.name === 'subject_id')) {
                await db.run('ALTER TABLE facts_v2 ADD COLUMN subject_id TEXT');
            }
            if (!info.some(c => c.name === 'target_object')) {
                await db.run('ALTER TABLE facts_v2 ADD COLUMN target_object TEXT');
            }
            if (!info.some(c => c.name === 'sensitivity')) {
                await db.run('ALTER TABLE facts_v2 ADD COLUMN sensitivity TEXT DEFAULT "normal"');
            }
            if (!info.some(c => c.name === 'observed_at')) {
                await db.run('ALTER TABLE facts_v2 ADD COLUMN observed_at INTEGER');
            }
        }

        // Migration for Unread Messages (Care Circles)
        const membersInfo = await db.all('PRAGMA table_info(care_circle_members)');
        const hasLastRead = membersInfo.some(col => col.name === 'last_read_timestamp');
        if (!hasLastRead && membersInfo.length > 0) {
            console.log('[Migration] Adding last_read_timestamp to care_circle_members...');
            await db.run('ALTER TABLE care_circle_members ADD COLUMN last_read_timestamp INTEGER DEFAULT 0');
        }

        // Direct Messages Table
        await db.exec(`
            CREATE TABLE IF NOT EXISTS direct_messages (
                dm_id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id TEXT NOT NULL,
                receiver_id TEXT NOT NULL,
                message TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                read_at INTEGER,
                FOREIGN KEY (sender_id) REFERENCES users(user_id),
                FOREIGN KEY (receiver_id) REFERENCES users(user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_dm_receiver ON direct_messages(receiver_id);
            CREATE INDEX IF NOT EXISTS idx_dm_conversation ON direct_messages(sender_id, receiver_id);
        `);

        // In-App Notifications (Inbox)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS in_app_notifications (
                notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                type TEXT NOT NULL, -- 'message', 'alert', 'system'
                title TEXT,
                body TEXT,
                data TEXT, -- JSON payload (link, validation errors, etc)
                is_read INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_notif_user ON in_app_notifications(user_id);
        `);

        // Migration for feedback table - add all missing columns
        const feedbackInfo = await db.all('PRAGMA table_info(feedback)');
        if (feedbackInfo.length > 0) {
            const feedbackColumns = feedbackInfo.map(col => col.name);
            
            // List of all required feedback columns
            const requiredColumns = [
                { name: 'source', type: 'TEXT', default: '"user"' },
                { name: 'prompt_version', type: 'TEXT', default: null },
                { name: 'category', type: 'TEXT', default: null },
                { name: 'goal_adherence_score', type: 'REAL', default: null },
                { name: 'goal_history_score', type: 'REAL', default: null },
                { name: 'goal_conversation_score', type: 'REAL', default: null },
                { name: 'critical_failure', type: 'INTEGER', default: null }
            ];
            
            // Add missing columns
            for (const column of requiredColumns) {
                if (!feedbackColumns.includes(column.name)) {
                    console.log(`[Migration] Adding ${column.name} column to feedback table...`);
                    const defaultClause = column.default ? ` DEFAULT ${column.default}` : '';
                    await db.run(`ALTER TABLE feedback ADD COLUMN ${column.name} ${column.type}${defaultClause}`);
                }
            }
        }

        // Migration for detailed_feedback table - add all missing columns
        const detailedFeedbackInfo = await db.all('PRAGMA table_info(detailed_feedback)');
        if (detailedFeedbackInfo.length > 0) {
            const detailedFeedbackColumns = detailedFeedbackInfo.map(col => col.name);
            
            // List of all required detailed_feedback columns
            const requiredDetailedColumns = [
                { name: 'message_id', type: 'INTEGER', default: null },
                { name: 'description', type: 'TEXT', default: null },
                { name: 'context', type: 'TEXT', default: null },
                { name: 'source', type: 'TEXT', default: '"simulation"' },
                { name: 'scenario_name', type: 'TEXT', default: null },
                { name: 'persona_name', type: 'TEXT', default: null }
            ];
            
            // Add missing columns
            for (const column of requiredDetailedColumns) {
                if (!detailedFeedbackColumns.includes(column.name)) {
                    console.log(`[Migration] Adding ${column.name} column to detailed_feedback table...`);
                    const defaultClause = column.default ? ` DEFAULT ${column.default}` : '';
                    await db.run(`ALTER TABLE detailed_feedback ADD COLUMN ${column.name} ${column.type}${defaultClause}`);
                }
            }
        }

    } catch (error) {
        console.warn('[Schema Migration] Error migrating database:', error.message);
    }
}

export async function clearDatabase() {
    const db = await getDb();
    await db.exec(`
        DELETE FROM implied_consent;
        DELETE FROM pending_actions;
        DELETE FROM directives;
        DELETE FROM escalations;
        DELETE FROM fact_history;
        DELETE FROM facts;
        DELETE FROM messages;
        DELETE FROM care_circle_members;
        DELETE FROM care_circles;
        DELETE FROM users;
    `);
    console.log('[Database] Cleared.');
}

