/**
 * @fileoverview PromptVersionManager for Simulation System
 * Manages saving, retrieving, and setting baseline versions of system prompts.
 */
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'care_circle_simulation.db');

export class PromptVersionManager {
    constructor() {
        this.db = null;
    }

    async _getDb() {
        if (!this.db) {
            this.db = await open({
                filename: DB_FILE,
                driver: sqlite3.Database
            });
            await this.db.run(`
                CREATE TABLE IF NOT EXISTS prompt_versions (
                    version_id       TEXT PRIMARY KEY,
                    prompt_type      TEXT NOT NULL,
                    content          TEXT NOT NULL,
                    metadata         TEXT,
                    is_baseline      INTEGER DEFAULT 0,
                    created_at       INTEGER,
                    created_by       TEXT,
                    parent_version_id TEXT
                )
            `);
        }
        return this.db;
    }

    /**
     * Get the current baseline prompt for a specific type
     * @param {string} promptType - 'system_base', 'system_variant', etc.
     * @param {string} versionId - Optional specific version ID
     */
    async getPrompt(promptType, versionId = null) {
        const db = await this._getDb();

        if (versionId) {
            return await db.get(
                'SELECT * FROM prompt_versions WHERE version_id = ?',
                [versionId]
            );
        }

        // Default to current baseline for type
        return await db.get(
            'SELECT * FROM prompt_versions WHERE prompt_type = ? AND is_baseline = 1 ORDER BY created_at DESC LIMIT 1',
            [promptType]
        );
    }

    /**
     * Save a new prompt version
     * @param {Object} promptData - { version_id, prompt_type, content, parent_version_id, created_by }
     * @param {boolean} setBaseline - Whether to mark this as the new baseline
     */
    async saveVersion(promptData, setBaseline = false) {
        const db = await this._getDb();
        const now = Date.now();

        await db.run('BEGIN TRANSACTION');
        try {
            // 1. If setting baseline, unset current baseline for this type
            if (setBaseline) {
                await db.run(
                    'UPDATE prompt_versions SET is_baseline = 0 WHERE prompt_type = ?',
                    [promptData.prompt_type]
                );
            }

            // 2. Insert new version
            await db.run(`
                INSERT INTO prompt_versions 
                (version_id, prompt_type, content, metadata, is_baseline, created_at, created_by, parent_version_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                promptData.version_id,
                promptData.prompt_type,
                promptData.content,
                JSON.stringify(promptData.metadata || {}),
                setBaseline ? 1 : 0,
                now,
                promptData.created_by || 'system',
                promptData.parent_version_id || null
            ]);

            await db.run('COMMIT');
            console.log(`[PromptVersionManager] Saved version: ${promptData.version_id} (baseline: ${setBaseline})`);
            return { version_id: promptData.version_id, success: true };
        } catch (err) {
            await db.run('ROLLBACK');
            console.error('[PromptVersionManager] Failed to save version:', err.message);
            throw err;
        }
    }

    /**
     * Get version history for a prompt type
     */
    async getHistory(promptType) {
        const db = await this._getDb();
        return await db.all(
            'SELECT * FROM prompt_versions WHERE prompt_type = ? ORDER BY created_at DESC',
            [promptType]
        );
    }

    /**
     * Set a specific version as the baseline
     */
    async setBaseline(versionId) {
        const db = await this._getDb();
        const version = await db.get('SELECT prompt_type FROM prompt_versions WHERE version_id = ?', [versionId]);

        if (!version) throw new Error(`Version ${versionId} not found`);

        await db.run('BEGIN TRANSACTION');
        try {
            await db.run('UPDATE prompt_versions SET is_baseline = 0 WHERE prompt_type = ?', [version.prompt_type]);
            await db.run('UPDATE prompt_versions SET is_baseline = 1 WHERE version_id = ?', [versionId]);
            await db.run('COMMIT');
            return true;
        } catch (err) {
            await db.run('ROLLBACK');
            throw err;
        }
    }

    async close() {
        if (this.db) {
            await this.db.close();
            this.db = null;
        }
    }
}

export const promptVersionManager = new PromptVersionManager();
