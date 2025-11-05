/**
 * @fileoverview Database queries for prompt version management
 */

import { getDb, getProductionDb } from './connection.js';

/**
 * Migrate prompt_versions table to ensure it has the 'name' column
 * This handles existing databases created before the 'name' column was added
 */
async function ensurePromptVersionsSchema() {
    const db = await getDb();
    
    try {
        // Check if table exists
        const tableExists = await db.get(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='prompt_versions'
        `);
        
        if (!tableExists) {
            // Table doesn't exist - will be created by schema.js with correct columns
            return;
        }
        
        // Check if 'name' column exists by querying table info
        const tableInfo = await db.all(`PRAGMA table_info(prompt_versions)`);
        const hasNameColumn = tableInfo.some(col => col.name === 'name');
        
        if (!hasNameColumn) {
            console.log('[DB Migration] Adding missing "name" column to prompt_versions table...');
            try {
                await db.run(`ALTER TABLE prompt_versions ADD COLUMN name TEXT`);
                console.log('[DB Migration] Successfully added "name" column');
            } catch (alterError) {
                // If ALTER fails, try to handle gracefully
                console.warn('[DB Migration] Could not add "name" column:', alterError.message);
                // If the table has a different schema (e.g., from database_manager.js),
                // we might need to handle it differently
                throw alterError;
            }
        }
        
        // Also check for other missing columns from the standard schema
        const hasCreatedAtColumn = tableInfo.some(col => col.name === 'created_at');
        if (!hasCreatedAtColumn) {
            try {
                await db.run(`ALTER TABLE prompt_versions ADD COLUMN created_at INTEGER`);
                // Set default for existing rows
                await db.run(`UPDATE prompt_versions SET created_at = ? WHERE created_at IS NULL`, [Date.now()]);
                console.log('[DB Migration] Successfully added "created_at" column');
            } catch (error) {
                console.warn('[DB Migration] Could not add "created_at" column:', error.message);
            }
        }
    } catch (error) {
        // Table might not exist yet - that's fine, schema.js will create it
        if (error.message.includes('no such table')) {
            // Table will be created by schema.js with the correct columns
            return;
        }
        console.warn('[DB Migration] Error checking prompt_versions schema:', error.message);
        // Don't throw - allow the INSERT to proceed (it might work if columns match)
    }
}

/**
 * Save a prompt version to the database
 * ALWAYS saves to production database, even if in simulation mode
 * @param {string} version - Version identifier (e.g., "v1762012142761")
 * @param {string} content - Prompt content
 * @param {string} name - Optional name/description for the prompt
 * @param {number} performanceScore - Optional performance score
 * @param {string} deployedAt - Optional deployment timestamp
 * @param {boolean} forceProduction - Force use of production database (default: true)
 */
export async function savePromptVersion(version, content, name = null, performanceScore = 0, deployedAt = null, forceProduction = true) {
    // Always use production database for prompt storage
    const db = forceProduction ? await getProductionDb() : await getDb();
    
    try {
        // Ensure schema is up to date (migration for existing databases)
        await ensurePromptVersionsSchemaForDb(db);
        
        // If no name provided, generate a default one from version
        const promptName = name || `Prompt ${version}`;
        
        // Create timestamp for human-readable tracking
        const createdAt = Date.now();
        
        // Note: The name passed in should already contain timestamp if needed
        // (it's added by the calling code in training_pipeline.js and prompt_optimizer_multi.js)
        
        await db.run(`
            INSERT OR REPLACE INTO prompt_versions (version, name, content, deployed_at, performance_score, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [version, promptName, content, deployedAt || null, performanceScore, createdAt]);
    } finally {
        // Close the production DB connection if we opened a fresh one
        if (forceProduction && db) {
            await db.close();
        }
    }
}

/**
 * Migrate prompt_versions table for a specific database connection
 */
async function ensurePromptVersionsSchemaForDb(db) {
    try {
        // Check if table exists
        const tableExists = await db.get(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='prompt_versions'
        `);
        
        if (!tableExists) {
            // Table doesn't exist - create it with correct schema
            await db.run(`
                CREATE TABLE IF NOT EXISTS prompt_versions (
                    version TEXT PRIMARY KEY,
                    name TEXT,
                    content TEXT NOT NULL,
                    deployed_at TEXT,
                    performance_score REAL DEFAULT 0,
                    created_at INTEGER NOT NULL
                )
            `);
            return;
        }
        
        // Check if 'name' column exists by querying table info
        const tableInfo = await db.all(`PRAGMA table_info(prompt_versions)`);
        const hasNameColumn = tableInfo.some(col => col.name === 'name');
        
        if (!hasNameColumn) {
            console.log('[DB Migration] Adding missing "name" column to prompt_versions table...');
            try {
                await db.run(`ALTER TABLE prompt_versions ADD COLUMN name TEXT`);
                console.log('[DB Migration] Successfully added "name" column');
            } catch (alterError) {
                // If ALTER fails, try to handle gracefully
                console.warn('[DB Migration] Could not add "name" column:', alterError.message);
                throw alterError;
            }
        }
        
        // Also check for other missing columns from the standard schema
        const hasCreatedAtColumn = tableInfo.some(col => col.name === 'created_at');
        if (!hasCreatedAtColumn) {
            try {
                await db.run(`ALTER TABLE prompt_versions ADD COLUMN created_at INTEGER`);
                // Set default for existing rows
                await db.run(`UPDATE prompt_versions SET created_at = ? WHERE created_at IS NULL`, [Date.now()]);
                console.log('[DB Migration] Successfully added "created_at" column');
            } catch (error) {
                console.warn('[DB Migration] Could not add "created_at" column:', error.message);
            }
        }
    } catch (error) {
        console.warn('[DB Migration] Error checking prompt_versions schema:', error.message);
        // Don't throw - allow the INSERT to proceed (it might work if columns match)
    }
}


/**
 * Get a prompt version by version identifier
 * @param {string} version - Version identifier
 * @returns {object|null} Prompt version object
 */
export async function getPromptVersion(version) {
    const db = await getDb();
    
    const row = await db.get(`
        SELECT * FROM prompt_versions WHERE version = ?
    `, [version]);
    
    return row || null;
}

/**
 * Find prompt version by name (supports partial matching)
 * @param {string} name - Name or partial name to search for
 * @returns {array} Array of matching prompt versions
 */
export async function findPromptVersionsByName(name) {
    const db = await getDb();
    
    const rows = await db.all(`
        SELECT * FROM prompt_versions 
        WHERE name LIKE ? OR version LIKE ?
        ORDER BY created_at DESC
    `, [`%${name}%`, `%${name}%`]);
    
    return rows;
}

/**
 * Get all prompt versions
 * @param {number} limit - Optional limit on number of results
 * @returns {array} Array of prompt versions
 */
export async function getAllPromptVersions(limit = 100) {
    const db = await getDb();
    
    const rows = await db.all(`
        SELECT * FROM prompt_versions 
        ORDER BY created_at DESC 
        LIMIT ?
    `, [limit]);
    
    return rows;
}

/**
 * Get the currently deployed prompt version
 * @returns {object|null} The most recently deployed prompt
 */
export async function getCurrentDeployedPrompt() {
    const db = await getDb();
    
    const row = await db.get(`
        SELECT * FROM prompt_versions 
        WHERE deployed_at IS NOT NULL
        ORDER BY deployed_at DESC 
        LIMIT 1
    `);
    
    return row || null;
}

