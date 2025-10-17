import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;

// This function manages the singleton database connection.
export async function getDb() {
    if (!db) {
        // Use simulation database if in simulation mode
        const dbPath = process.env.SIMULATION_MODE === 'true' 
            ? './care_circle_simulation.db' 
            : './care_circle.db';
            
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });
    }
    return db;
}
