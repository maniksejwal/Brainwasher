import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import config from '../config.js';

const dbStorage = new AsyncLocalStorage();
let globalDb;
let currentDbPath = null;

// This function manages the singleton database connection.
export async function getDb() {
    // 1. Check for context-specific DB (isolated simulation)
    const contextDb = dbStorage.getStore();
    if (contextDb) {
        return contextDb;
    }

    // 2. Check for global injected DB
    if (globalDb && currentDbPath === null) {
        return globalDb;
    }

    // 3. Config-based path selection
    const dbPath = config.getDbPath();

    if (!globalDb || currentDbPath !== dbPath) {
        if (globalDb) {
            await globalDb.close();
        }
        currentDbPath = dbPath;
        console.log(`[DB] Opening connection: ${dbPath} (env: ${config.NODE_ENV})`);
        globalDb = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });
    }
    return globalDb;
}

// Allow overriding the database instance (Legacy / Global)
export function setGlobalDb(dbInstance) {
    globalDb = dbInstance;
}

// Execute a function with an isolated database context
export function runWithDb(dbInstance, callback) {
    return dbStorage.run(dbInstance, callback);
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

