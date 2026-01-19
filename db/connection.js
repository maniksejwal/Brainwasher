import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;
let currentDbPath = null;

// This function manages the singleton database connection.
export async function getDb() {
    // Use simulation database when in simulation mode (for both regular and world simulations)
    const dbPath = process.env.SIMULATION_MODE === 'true'
        ? './care_circle_simulation.db'
        : './care_circle.db';

    // If database path changed or connection doesn't exist, create/recreate connection
    if (!db || currentDbPath !== dbPath) {
        if (db) {
            // Close existing connection if switching databases
            await db.close();
        }
        currentDbPath = dbPath;
        console.log(`[DB] Opening connection: ${dbPath}`);
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });
    }
    return db;
}

// Allow overriding the database instance (e.g., for simulations)
export function setGlobalDb(dbInstance) {
    if (db) {
        // Optional: console.warn("Overriding existing global DB connection");
    }
    db = dbInstance;
}

/**
 * Get a fresh connection to the production database (bypasses cache)
 * Use this when you need to ensure you're using the production DB
 */
export async function getProductionDb() {
    return await open({
        filename: './care_circle.db',
        driver: sqlite3.Database
    });
}
