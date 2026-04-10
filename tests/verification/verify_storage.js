/**
 * @fileoverview Test storage abstraction layer
 * Verifies provider interface and local storage implementation
 */

import { getStorage, resetStorage } from '../lib/storage/index.js';
import fs from 'fs/promises';
import path from 'path';

async function testStorageLayer() {
    console.log('🧪 Testing Storage Abstraction Layer...\n');

    // Reset for clean test
    resetStorage();

    const storage = getStorage();
    const testPath = 'test/sample.txt';
    const testContent = 'Hello, Storage Layer!';

    try {
        // Test 1: Write
        console.log('1. Testing write...');
        await storage.write(testPath, testContent);
        console.log('   ✅ Write successful\n');

        // Test 2: Read
        console.log('2. Testing read...');
        const readContent = await storage.read(testPath);
        if (readContent === testContent) {
            console.log('   ✅ Read successful (content matches)\n');
        } else {
            console.log('   ❌ Read failed (content mismatch)\n');
        }

        // Test 3: Exists
        console.log('3. Testing exists...');
        const exists = await storage.exists(testPath);
        if (exists) {
            console.log('   ✅ Exists check successful\n');
        } else {
            console.log('   ❌ Exists check failed\n');
        }

        // Test 4: Append
        console.log('4. Testing append...');
        await storage.append(testPath, '\nAppended line!');
        const appendedContent = await storage.read(testPath);
        if (appendedContent.includes('Appended line!')) {
            console.log('   ✅ Append successful\n');
        } else {
            console.log('   ❌ Append failed\n');
        }

        // Test 5: List
        console.log('5. Testing list...');
        const files = await storage.list('test');
        if (files.length > 0) {
            console.log(`   ✅ List successful (found ${files.length} file(s))\n`);
        } else {
            console.log('   ❌ List failed\n');
        }

        // Test 6: Delete
        console.log('6. Testing delete...');
        await storage.delete(testPath);
        const existsAfterDelete = await storage.exists(testPath);
        if (!existsAfterDelete) {
            console.log('   ✅ Delete successful\n');
        } else {
            console.log('   ❌ Delete failed\n');
        }

        // Cleanup test directory
        const testDir = path.join('./data/storage/local', 'test');
        try {
            await fs.rmdir(testDir);
        } catch (e) {
            // Ignore if directory doesn't exist
        }

        console.log('✅ All storage tests complete!');
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    }
}

testStorageLayer().catch(console.error);
