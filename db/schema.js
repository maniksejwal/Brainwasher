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
        CREATE TABLE IF NOT EXISTS care_circles ( circle_id TEXT PRIMARY KEY, primary_patient_id TEXT NOT NULL, created_at INTEGER NOT NULL, circle_type TEXT DEFAULT 'medical', organization_context TEXT, coordination_engine TEXT DEFAULT 'medical_care', FOREIGN KEY (primary_patient_id) REFERENCES users(user_id) );
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
    
    // Create companion confidential communication tables
    await createCompanionConfidentialTables();

    // Create dialog graph tables (supervised training + MCTS comparison)
    await addDialogGraphSchemaTables();

    // Create intervention queue table (cross-user scheduled interventions)
    const { addInterventionQueueTable } = await import('./queries_interventions.js');
    await addInterventionQueueTable();
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

        // Fact Conflicts Table — per-conflict-event history (D3 fix).
        // facts_v2 has a boolean conflict_flag that gets overwritten on each update;
        // this table preserves the full conflict event log including the messages
        // that triggered each conflict, enabling resolution tracking and audit.
        await db.exec(`
            CREATE TABLE IF NOT EXISTS fact_conflicts (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                circle_id             TEXT    NOT NULL,
                fact_key              TEXT    NOT NULL,
                fact_id_new           INTEGER,              -- facts_v2.fact_id of the incoming (conflicting) fact
                fact_id_existing      INTEGER,              -- facts_v2.fact_id of the fact that was displaced
                reporter_user_id      TEXT    NOT NULL,     -- user who reported the new (conflicting) value
                existing_reporter_id  TEXT,                 -- user who reported the previous value
                claimed_value         TEXT    NOT NULL,     -- new value being claimed
                existing_value        TEXT,                 -- value it conflicts with
                source_message_id     TEXT,                 -- messages.message_id that triggered this fact (if available)
                source_message_text   TEXT,                 -- verbatim message text for audit trail
                existing_message_id   TEXT,                 -- messages.message_id that established the existing value
                existing_message_text TEXT,                 -- verbatim text that established the existing fact
                conflict_detected_at  INTEGER NOT NULL,
                resolved              INTEGER DEFAULT 0,    -- 0=open, 1=resolved
                resolution_notes      TEXT,
                resolved_at           INTEGER,
                resolved_by           TEXT,                 -- user_id who resolved the conflict
                FOREIGN KEY (circle_id) REFERENCES care_circles(circle_id)
            );
            CREATE INDEX IF NOT EXISTS idx_fact_conflicts_circle_key
                ON fact_conflicts(circle_id, fact_key);
            CREATE INDEX IF NOT EXISTS idx_fact_conflicts_open
                ON fact_conflicts(circle_id, resolved, conflict_detected_at DESC);
        `);
        console.log('[Schema] fact_conflicts table ready');

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

        // htn_benchmark_episodes: cost and hysteresis tracking columns (added for 6-exp redesign)
        const benchEpCols = {
            cost_usd_total:          'REAL',
            llm_calls_total:         'INTEGER',
            hysteresis_zone_changes: 'INTEGER',
        };
        for (const [col, colType] of Object.entries(benchEpCols)) {
            try {
                await db.run(`ALTER TABLE htn_benchmark_episodes ADD COLUMN ${col} ${colType}`);
            } catch (_e) { /* column already exists — SQLite throws on duplicate ADD */ }
        }

        // htn_benchmark_turns: per-turn cost and hysteresis columns
        const benchTurnCols = {
            cost_usd_turn:        'REAL',
            llm_calls_turn:       'INTEGER',
            hysteresis_zone:      'INTEGER',
            hysteresis_zone_name: 'TEXT',
        };
        for (const [col, colType] of Object.entries(benchTurnCols)) {
            try {
                await db.run(`ALTER TABLE htn_benchmark_turns ADD COLUMN ${col} ${colType}`);
            } catch (_e) { /* column already exists */ }
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

/**
 * Add metadata tables for conversation intelligence
 * rich metadata tables to capture LLM analysis results
 * 
 * BACKWARDS COMPATIBILITY:
 * - Existing 'messages' table unchanged - all existing queries work
 * - New tables are LEFT JOINed - null metadata doesn't break existing functionality
 * - All existing functions (getRecentMessages, etc.) continue to work exactly as before
 * 
 * FORWARDS COMPATIBILITY: 
 * - New enhanced functions (getEnhancedConversationHistory) use rich metadata when available
 * - System gracefully handles missing metadata (falls back to basic message data)
 * - Future LLM improvements can add more metadata without breaking existing storage
 * 
 * ENSURING WE DON'T FORGET:
 * - Schema function name clearly indicates purpose: addConversationIntelligenceTables()
 * - Comments document exact purpose of each table
 * - Migration pattern allows incremental adoption
 */
export async function addConversationIntelligenceTables() {
    const db = await getDb();
    
    await db.exec(`
        -- Store LLM analysis results for messages (complements existing facts_v2)
        CREATE TABLE IF NOT EXISTS message_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            circle_id TEXT NOT NULL,
            context_type TEXT, -- 'medical' or 'business' (from circle type)
            intent TEXT, -- LLM-determined intent from inputUnderstanding handler
            topics TEXT, -- JSON array of LLM-determined topics
            urgency TEXT DEFAULT 'normal', -- LLM-determined urgency level
            metadata_json TEXT, -- Full LLM analysis results as JSON
            created_at INTEGER NOT NULL,
            FOREIGN KEY (message_id) REFERENCES messages(message_id)
        );

        -- Link messages to documents (unified for medical reports and business documents)
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT,
            document_type TEXT, -- LLM-determined type: 'medical_report', 'contract', etc.
            circle_id TEXT NOT NULL,
            created_by TEXT,
            status TEXT DEFAULT 'draft',
            context_type TEXT, -- 'medical' or 'business'
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (circle_id) REFERENCES care_circles(circle_id)
        );

        CREATE TABLE IF NOT EXISTS message_document_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            document_id TEXT NOT NULL,
            link_type TEXT, -- LLM-determined: 'creation_trigger', 'review_discussion', etc.
            created_at INTEGER NOT NULL,
            FOREIGN KEY (message_id) REFERENCES messages(message_id),
            FOREIGN KEY (document_id) REFERENCES documents(id)
        );

        -- Performance indexes
        CREATE INDEX IF NOT EXISTS idx_message_metadata_circle_context 
        ON message_metadata(circle_id, context_type);
        
        CREATE INDEX IF NOT EXISTS idx_message_metadata_intent_topics 
        ON message_metadata(intent, topics);
    `);

    console.log('[Schema] Conversation intelligence tables added - LLM analysis storage ready');
}

/**
 * Add companion confidential communication tables
 */
async function createCompanionConfidentialTables() {
    const db = await getDb();
    
    await db.exec(`
        -- Companion-to-companion confidential messages
        CREATE TABLE IF NOT EXISTS companion_confidential_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL,
            sender_companion_id TEXT NOT NULL,      -- Which companion sent this
            sender_user_id TEXT NOT NULL,           -- User the sender companion belongs to
            recipient_companion_id TEXT,            -- Specific companion recipient (null for broadcast)
            recipient_user_id TEXT,                 -- User the recipient companion belongs to
            message_content TEXT NOT NULL,
            confidential_level TEXT NOT NULL,       -- companion_only, companion_network, cross_user_companion
            intelligence_type TEXT,                 -- context_sharing, risk_assessment, pattern_detection
            related_circle_id TEXT,                 -- Related circle context
            metadata TEXT,                          -- JSON metadata
            requires_action BOOLEAN DEFAULT 0,     -- Whether this requires companion action
            expires_at INTEGER,                     -- Auto-delete timestamp for sensitive intel
            created_at INTEGER NOT NULL,
            read_at INTEGER,
            FOREIGN KEY (sender_user_id) REFERENCES users(user_id),
            FOREIGN KEY (recipient_user_id) REFERENCES users(user_id)
        );

        -- Companion intelligence sharing logs
        CREATE TABLE IF NOT EXISTS companion_intel_sharing (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sharing_id TEXT NOT NULL,
            source_companion TEXT NOT NULL,         -- medical_companion, professional_companion, etc.
            target_companion TEXT NOT NULL,
            user_id TEXT NOT NULL,                  -- User whose companions are sharing intel
            intelligence_summary TEXT NOT NULL,     -- High-level summary of shared intelligence
            detailed_analysis TEXT,                 -- Detailed analysis (may be encrypted)
            sharing_reason TEXT NOT NULL,           -- why this intelligence was shared
            privacy_level TEXT NOT NULL,            -- COMPANION_CONFIDENTIAL, USER_INVISIBLE
            user_consent_status TEXT DEFAULT 'not_required', -- explicit, implicit, not_required
            shared_at INTEGER NOT NULL,
            accessed_at INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        -- Companion decision coordination
        CREATE TABLE IF NOT EXISTS companion_decision_sync (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            decision_context TEXT NOT NULL,         -- What decision needs coordination
            medical_companion_input TEXT,           -- Medical companion's perspective
            professional_companion_input TEXT,     -- Professional companion's perspective
            social_companion_input TEXT,           -- Social companion's perspective  
            consensus_reached BOOLEAN DEFAULT 0,
            final_recommendation TEXT,
            confidence_score REAL,                  -- 0-1 confidence in recommendation
            user_override TEXT,                     -- If user overrides companion decision
            created_at INTEGER NOT NULL,
            resolved_at INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        );

        -- Indexes for performance
        CREATE INDEX IF NOT EXISTS idx_companion_messages_recipient 
        ON companion_confidential_messages(recipient_user_id, recipient_companion_id);
        
        CREATE INDEX IF NOT EXISTS idx_companion_messages_sender 
        ON companion_confidential_messages(sender_user_id, sender_companion_id);
        
        CREATE INDEX IF NOT EXISTS idx_companion_intel_user 
        ON companion_intel_sharing(user_id);
        
        CREATE INDEX IF NOT EXISTS idx_companion_decisions 
        ON companion_decision_sync(user_id, consensus_reached);
    `);

    console.log('[Schema] Companion confidential communication tables added');
}

/**
 * Add dialog graph tables for supervised training and MCTS comparison.
 * Called once during database initialization.
 */
export async function addDialogGraphSchemaTables() {
    const { addDialogGraphTables } = await import('./queries_dialog_graphs.js');
    await addDialogGraphTables();
    console.log('[Schema] Dialog graph tables added');
}

/**
 * Add HTN benchmark tables.
 * Stores results from tensornets/benchmarks/runner.py via the FastAPI bridge.
 * These replace the .md/.json file outputs — the DB is the source of truth.
 *
 * Tables:
 *   htn_benchmark_runs    — one row per benchmark run (arm, scenario set, config)
 *   htn_benchmark_episodes — one row per episode in a run (reward, physio, judge scores)
 *   htn_benchmark_turns   — one row per turn in an episode (action, response, stress)
 *
 * Used by:
 *   - tensornets/server.py POST /benchmark/record-*
 *   - tensornetsBridge.js recordBenchmarkRun()
 *   - GUI dashboard (benchmarks tab)
 *   - CLI: node cli --tensornets benchmark list/show/export
 */
export async function addHTNBenchmarkTables(db) {
    if (!db) {
        const { getDb } = await import('./connection.js');
        db = await getDb();
    }

    await db.exec(`
        CREATE TABLE IF NOT EXISTS htn_benchmark_runs (
            run_id          TEXT PRIMARY KEY,
            arm             TEXT NOT NULL,   -- 'htn_mcts' | 'oldschool' | 'hysteresis_prompt'
            label           TEXT,            -- human-readable label
            scenario_set    TEXT NOT NULL,   -- e.g. 'canonical_10' | 'deaddiction' | 'flooding'
            config          TEXT,            -- JSON: model IDs, hyperparams, random seed
            started_at      INTEGER NOT NULL,
            completed_at    INTEGER,
            episode_count   INTEGER DEFAULT 0,
            mean_reward     REAL,
            mean_stress_auc REAL,
            goal_achieved_pct REAL,
            notes           TEXT
        );

        CREATE TABLE IF NOT EXISTS htn_benchmark_episodes (
            episode_id      TEXT PRIMARY KEY,
            run_id          TEXT NOT NULL REFERENCES htn_benchmark_runs(run_id),
            scenario_id     TEXT NOT NULL,
            persona_id      TEXT,
            arm             TEXT NOT NULL,
            turn_count      INTEGER DEFAULT 0,
            cumulative_reward REAL,
            stress_auc      REAL,
            goal_achieved   INTEGER DEFAULT 0,
            turns_to_goal   INTEGER,
            trust_delta_final REAL,
            tokens_scout    INTEGER DEFAULT 0,
            tokens_maverick INTEGER DEFAULT 0,
            latency_ms_mean REAL,
            cost_usd_total  REAL,            -- total USD cost for all LLM calls in episode
            llm_calls_total INTEGER DEFAULT 0, -- total LLM API calls in episode
            hysteresis_zone_changes INTEGER DEFAULT 0, -- zone transitions fired (Exp 3/4 only)
            started_at      INTEGER NOT NULL,
            completed_at    INTEGER,
            summary         TEXT   -- JSON: final state snapshot
        );

        CREATE TABLE IF NOT EXISTS htn_benchmark_turns (
            turn_id         INTEGER PRIMARY KEY AUTOINCREMENT,
            episode_id      TEXT NOT NULL REFERENCES htn_benchmark_episodes(episode_id),
            run_id          TEXT NOT NULL,
            arm             TEXT NOT NULL,
            turn_number     INTEGER NOT NULL,
            action          TEXT,            -- action_selector.js taxonomy action
            response        TEXT,
            hrv_ms          REAL,
            stress_label    TEXT,
            stress_index    REAL,
            reward_stress   REAL,
            reward_trust    REAL,
            reward_goal     REAL,
            reward_info     REAL,
            reward_consistency REAL,
            judge_clinical  REAL,
            judge_empathy   REAL,
            judge_safety    REAL,
            judge_goal      REAL,
            judge_strategy  REAL,
            linguistic_stress REAL,
            discrepancy_flag INTEGER DEFAULT 0,
            tokens_scout    INTEGER DEFAULT 0,
            tokens_maverick INTEGER DEFAULT 0,
            latency_ms      INTEGER,
            cost_usd_turn   REAL,            -- estimated USD cost for this single turn
            llm_calls_turn  INTEGER DEFAULT 1, -- LLM API calls this turn (1 normal; 2 CoT)
            hysteresis_zone INTEGER,         -- locked zone id at this turn (Exp 3/4 only)
            hysteresis_zone_name TEXT        -- locked zone name (Exp 3/4 only)
        );

        CREATE INDEX IF NOT EXISTS idx_bench_runs_arm     ON htn_benchmark_runs(arm);
        CREATE INDEX IF NOT EXISTS idx_bench_episodes_run ON htn_benchmark_episodes(run_id);
        CREATE INDEX IF NOT EXISTS idx_bench_turns_ep     ON htn_benchmark_turns(episode_id);

        -- Checkpoint events: written each time train.py saves actor/critic weights.
        -- Used by the dashboard to draw vertical dashed lines on learning curves.
        -- stopped=1 means STOP_AT_CHECKPOINT was honoured (training paused here).
        CREATE TABLE IF NOT EXISTS htn_benchmark_checkpoints (
            checkpoint_id  TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))),
            run_id         TEXT    NOT NULL REFERENCES htn_benchmark_runs(run_id),
            arm            TEXT    NOT NULL,
            episode        INTEGER NOT NULL,
            stopped        INTEGER NOT NULL DEFAULT 0,
            ts             INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bench_ckpt_arm ON htn_benchmark_checkpoints(arm, ts);

        -- Metadata / configuration table for benchmark system.
        -- Stores named key-value pairs: baseline cutoff timestamps, experiment labels,
        -- hyperparameter snapshots, and any other system-level annotations.
        -- query: SELECT value FROM htn_benchmark_metadata WHERE key = 'baseline_cutoff_ts'
        CREATE TABLE IF NOT EXISTS htn_benchmark_metadata (
            key         TEXT PRIMARY KEY,
            value       TEXT NOT NULL,
            description TEXT,
            set_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        -- Full conversation transcripts for qualitative analysis and paper samples.
        -- Populated during A3C runs for canonical scenarios only (is_canonical=1).
        -- Each row = one complete episode transcript (all turns in order).
        -- Separate from htn_benchmark_turns (which stores scores) — this stores
        -- the actual text so transcripts can be read, annotated, and compared arm-by-arm.
        -- Both regular and world scenarios are stored (scenario_type = 'regular'|'world').
        CREATE TABLE IF NOT EXISTS htn_transcripts (
            transcript_id   TEXT PRIMARY KEY,  -- = episode_id from htn_benchmark_episodes
            run_id          TEXT NOT NULL,
            arm             TEXT NOT NULL,     -- 'htn_mcts' | 'oldschool' | 'hysteresis_prompt'
            scenario_id     TEXT NOT NULL,
            scenario_type   TEXT NOT NULL DEFAULT 'regular',  -- 'regular' | 'world'
            persona_id      TEXT,
            is_canonical    INTEGER DEFAULT 0, -- 1 = selected for paper / qualitative review
            canonical_label TEXT,             -- human-readable label e.g. 'deaddiction_rapport'
            transcript      TEXT NOT NULL,    -- full JSON array of {turn, role, message, action, scores}
            summary         TEXT,             -- 2-3 sentence human-readable summary for paper
            annotated       INTEGER DEFAULT 0,-- 1 = manually reviewed and annotated
            created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE INDEX IF NOT EXISTS idx_transcripts_run      ON htn_transcripts(run_id);
        CREATE INDEX IF NOT EXISTS idx_transcripts_scenario ON htn_transcripts(scenario_id, arm);
        CREATE INDEX IF NOT EXISTS idx_transcripts_canonical ON htn_transcripts(is_canonical);
    `);

    // Mark the baseline cutoff: end of Saturday 2026-05-23 (day before yesterday).
    // All feedback/simulation data created BEFORE this timestamp is considered the
    // "pre-HTN baseline" for A3C comparison. Arm 2 (oldschool) reward distributions
    // are anchored to this window. Only insert once; do not overwrite if already set.
    const existing = await db.get(
        "SELECT key FROM htn_benchmark_metadata WHERE key = 'baseline_cutoff_ts'"
    );
    if (!existing) {
        const baselineCutoff = new Date('2026-05-23T23:59:59+05:30').getTime();
        await db.run(
            `INSERT INTO htn_benchmark_metadata (key, value, description) VALUES (?, ?, ?)`,
            [
                'baseline_cutoff_ts',
                String(baselineCutoff),
                'End of pre-HTN baseline window (2026-05-23 23:59:59 IST). Feedback and simulation ' +
                'data before this timestamp is the old-pipeline baseline for A3C arm comparison.'
            ]
        );
        console.log('[Schema] HTN baseline cutoff set to 2026-05-23T23:59:59 IST');
    }

    console.log('[Schema] HTN benchmark tables added');
}

