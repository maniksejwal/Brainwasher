import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;

// This function manages the singleton database connection.
export async function getDb() {
    if (!db) {
        db = await open({
            filename: './care_circle.db',
            driver: sqlite3.Database
        });
    }
    return db;
}
