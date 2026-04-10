/**
 * @fileoverview Test database configuration system
 * Verifies environment-based database path selection
 */

import config from '../config.js';
import { getDb, setGlobalDb } from '../db/connection.js';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

async function testDbConfig() {
    console.log('🧪 Testing Database Configuration System...\n');

    // Test 1: Default environment (development)
    console.log('1. Testing default environment (development)...');
    const defaultPath = config.getDbPath();
    console.log(`   Expected: ./data/dbs/care_circle_dev.db`);
    console.log(`   Actual: ${defaultPath}`);
    console.log(`   ✅ ${defaultPath === './data/dbs/care_circle_dev.db' ? 'PASS' : 'FAIL'}\n`);

    // Test 2: Simulation mode (legacy support)
    console.log('2. Testing simulation mode (legacy)...');
    process.env.SIMULATION_MODE = 'true';
    const simPath = config.getDbPath();
    console.log(`   Expected: ./data/dbs/care_circle_simulation.db`);
    console.log(`   Actual: ${simPath}`);
    console.log(`   ✅ ${simPath === './data/dbs/care_circle_simulation.db' ? 'PASS' : 'FAIL'}\n`);
    delete process.env.SIMULATION_MODE;

    // Test 3: Explicit mode parameter
    console.log('3. Testing explicit mode parameter...');
    const testPath = config.getDbPath('test');
    console.log(`   Expected: :memory:`);
    console.log(`   Actual: ${testPath}`);
    console.log(`   ✅ ${testPath === ':memory:' ? 'PASS' : 'FAIL'}\n`);

    // Test 4: NODE_ENV override
    console.log('4. Testing NODE_ENV=production...');
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    // Need to re-import config to pick up new env
    const prodPath = config.getDbPath();
    console.log(`   Expected: ./data/dbs/care_circle_prod.db`);
    console.log(`   Actual: ${prodPath}`);
    console.log(`   ✅ ${prodPath === './data/dbs/care_circle_prod.db' ? 'PASS' : 'FAIL'}\n`);
    process.env.NODE_ENV = originalEnv;

    // Test 5: Explicit DB_PATH override
    console.log('5. Testing DB_PATH override...');
    process.env.DB_PATH = './custom_db.db';
    const customPath = config.getDbPath();
    console.log(`   Expected: ./custom_db.db`);
    console.log(`   Actual: ${customPath}`);
    console.log(`   ✅ ${customPath === './custom_db.db' ? 'PASS' : 'FAIL'}\n`);
    delete process.env.DB_PATH;

    // Test 6: Actual database connection
    console.log('6. Testing actual database connection...');
    try {
        // Use in-memory DB for testing
        const testDb = await open({
            filename: ':memory:',
            driver: sqlite3.Database
        });
        setGlobalDb(testDb);

        const db = await getDb();
        console.log(`   ✅ Database connection successful`);

        // Verify it's the injected DB
        if (db === testDb) {
            console.log(`   ✅ Global DB injection working correctly\n`);
        } else {
            console.log(`   ❌ Global DB injection failed\n`);
        }

        await testDb.close();
    } catch (error) {
        console.log(`   ❌ Database connection failed: ${error.message}\n`);
    }

    console.log('✅ All configuration tests complete!');
}

testDbConfig().catch(console.error);
