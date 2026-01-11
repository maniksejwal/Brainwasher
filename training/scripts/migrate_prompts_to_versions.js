/**
 * @fileoverview Migrate current hardcoded prompts to prompt_versions table as baseline.
 */
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { PROMPT_UNIFIED_AGENT_WITH_STATE } from '../../prompts/unified_prompt.js';
import {
    PROMPT_GPT35_TURBO,
    PROMPT_GPT4,
    PROMPT_GPT4_TURBO,
    PROMPT_GPT5,
    PROMPT_GEMINI
} from '../../prompts/model_specific_prompts.js';

const DB_FILE = path.join(process.cwd(), 'care_circle_simulation.db');

async function migratePrompts() {
    console.log(`Connecting to database at ${DB_FILE}...`);
    const db = await open({
        filename: DB_FILE,
        driver: sqlite3.Database
    });

    const now = Date.now();
    const prompts = [
        { id: 'unified_v1.0', type: 'system_base', content: PROMPT_UNIFIED_AGENT_WITH_STATE },
        { id: 'unified_v1.0_gpt35', type: 'system_variant', content: PROMPT_GPT35_TURBO },
        { id: 'unified_v1.0_gpt4', type: 'system_variant', content: PROMPT_GPT4 },
        { id: 'unified_v1.0_gpt4_turbo', type: 'system_variant', content: PROMPT_GPT4_TURBO },
        { id: 'unified_v1.0_gpt5', type: 'system_variant', content: PROMPT_GPT5 },
        { id: 'unified_v1.0_gemini', type: 'system_variant', content: PROMPT_GEMINI }
    ];

    console.log("Migrating prompts to prompt_versions table...");
    for (const p of prompts) {
        try {
            await db.run(`
                INSERT OR IGNORE INTO prompt_versions 
                (version_id, prompt_type, content, is_baseline, created_at, created_by)
                VALUES (?, ?, ?, 1, ?, 'migration')
            `, [p.id, p.type, p.content, now]);
            console.log(`[Migrate] Added baseline: ${p.id}`);
        } catch (err) {
            console.error(`[Migrate] Failed to add ${p.id}:`, err.message);
        }
    }

    // Also add current simulation_v1.0 as a baseline if it doesn't exist
    await db.run(`
        INSERT OR IGNORE INTO prompt_versions 
        (version_id, prompt_type, content, is_baseline, created_at, created_by)
        VALUES (?, 'simulation_base', ?, 1, ?, 'migration')
    `, ['simulation_v1.0', PROMPT_UNIFIED_AGENT_WITH_STATE, now]);

    console.log("✓ Migration complete.");
    await db.close();
}

migratePrompts().catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
});
