/**
 * @fileoverview Initialize the prompt_versions table in the database.
 */
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';

const DB_FILE = path.join(process.cwd(), 'care_circle_simulation.db');

async function initializePromptDB() {
    console.log(`Connecting to database at ${DB_FILE}...`);
    const db = await open({
        filename: DB_FILE,
        driver: sqlite3.Database
    });

    console.log("Checking prompt_versions table schema...");

    // Check if table exists and has the old schema
    let tableExists = false;
    try {
        const result = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='prompt_versions'");
        if (result) tableExists = true;
    } catch (e) { }

    if (tableExists) {
        // Check for columns to see if migration is needed
        const columns = await db.all("PRAGMA table_info(prompt_versions)");
        const hasPromptType = columns.some(c => c.name === 'prompt_type');

        if (!hasPromptType) {
            console.log("⚠️ Old schema detected. Migrating data...");

            // Rename old table
            await db.exec("ALTER TABLE prompt_versions RENAME TO prompt_versions_old");

            // Create new table
            await db.exec(`
                CREATE TABLE IF NOT EXISTS prompt_versions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    version_id TEXT UNIQUE NOT NULL,
                    prompt_type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    metadata TEXT,
                    is_baseline BOOLEAN DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    created_by TEXT,
                    parent_version_id TEXT,
                    performance_summary TEXT
                );
            `);

            // Migrate data
            // Old schema: id, version, content, deployed_at, performance_score, is_active
            // New schema: ..., version_id, prompt_type, ...
            // Mapping: version -> version_id, 'unified' -> prompt_type, content -> content
            await db.exec(`
                INSERT INTO prompt_versions (version_id, prompt_type, content, created_at, created_by, performance_summary)
                SELECT 
                    version, 
                    'unified', 
                    content, 
                    strftime('%s', deployed_at) * 1000, 
                    'legacy_migration',
                    json_object('score', performance_score)
                FROM prompt_versions_old
            `);

            console.log("✓ Data migrated.");
            await db.exec("DROP TABLE prompt_versions_old");
        } else {
            console.log("✓ Schema matches.");
        }
    } else {
        console.log("Creating prompt_versions table (fresh)...");
        await db.exec(`
            CREATE TABLE IF NOT EXISTS prompt_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                version_id TEXT UNIQUE NOT NULL,
                prompt_type TEXT NOT NULL,  -- 'system', 'user', 'feedback', etc.
                content TEXT NOT NULL,
                metadata TEXT,  -- JSON: {scenario, complexity, etc.}
                is_baseline BOOLEAN DEFAULT 0,
                created_at INTEGER NOT NULL,
                created_by TEXT,  -- 'manual', 'rl_training', 'user_edit'
                parent_version_id TEXT,  -- For tracking lineage
                performance_summary TEXT  -- JSON: {avg_score, runs, etc.}
            );
        `);
    }

    console.log("Ensuring indices...");
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_prompt_versions_type ON prompt_versions(prompt_type);
        CREATE INDEX IF NOT EXISTS idx_prompt_versions_baseline ON prompt_versions(is_baseline);
    `);

    console.log("✓ prompt_versions table ready.");
    await db.close();
}

initializePromptDB().catch(err => {
    console.error("Failed to initialize prompt database:", err);
    process.exit(1);
});
