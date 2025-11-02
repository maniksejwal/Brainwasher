/**
 * @fileoverview Database queries for prompt version management
 */

import { getDb } from './connection.js';

/**
 * Save a prompt version to the database
 * @param {string} version - Version identifier (e.g., "v1762012142761")
 * @param {string} content - Prompt content
 * @param {string} name - Optional name/description for the prompt
 * @param {number} performanceScore - Optional performance score
 */
export async function savePromptVersion(version, content, name = null, performanceScore = 0, deployedAt = null) {
    const db = await getDb();
    
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

