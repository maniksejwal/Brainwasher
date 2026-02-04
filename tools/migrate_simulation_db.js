/**
 * @fileoverview Migration script to fix api_usage table in simulation DB
 */

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';

const DB_PATH = './care_circle_simulation.db';

async function migrate() {
    console.log(`[Migration] Opening database: ${DB_PATH}`);

    // Connect to database
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });

    try {
        console.log('[Migration] Checking api_usage table schema...');

        // Get current columns
        const columns = await db.all(`PRAGMA table_info(api_usage)`);
        const columnNames = columns.map(c => c.name);

        console.log('[Migration] Current columns:', columnNames.join(', '));

        const columnsToAdd = [
            { name: 'use_case', type: 'TEXT' },
            { name: 'cost_usd', type: 'REAL' },
            { name: 'metadata', type: 'TEXT' }
        ];

        let changesMade = false;

        for (const col of columnsToAdd) {
            if (!columnNames.includes(col.name)) {
                console.log(`[Migration] Adding missing column: ${col.name}...`);
                await db.exec(`ALTER TABLE api_usage ADD COLUMN ${col.name} ${col.type}`);
                changesMade = true;
            }
        }

        // Check for columns to remove (if they exist from bad schema)
        // Note: SQLite doesn't support DROP COLUMN easily in older versions, 
        // but we can ignore extra columns.

        if (changesMade) {
            console.log('[Migration] ✅ Schema update complete.');
        } else {
            console.log('[Migration] Schema is already up to date.');
        }

    } catch (error) {
        console.error('[Migration] Failed:', error.message);
    } finally {
        await db.close();
    }
}

migrate();
