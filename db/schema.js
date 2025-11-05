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

        CREATE TABLE IF NOT EXISTS users ( user_id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL );
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
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        );
        
        CREATE TABLE IF NOT EXISTS detailed_feedback (
            report_id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT,
            user_id TEXT NOT NULL,
            circle_id TEXT,
            category TEXT NOT NULL,
            details TEXT NOT NULL,
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
    `);
    console.log('[Database] Initialized.');
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

