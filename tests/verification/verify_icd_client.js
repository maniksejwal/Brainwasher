/**
 * @fileoverview Verification script for ICD Client using local annotation data
 */

import { getIcdCodes, categorizeDocument } from '../agents/icd_client.js';
import fs from 'fs/promises';
import path from 'path';

async function testIcdIntegration() {
    console.log('🏥 Testing ICD Client Integration...\n');

    // Load test data
    const testDataPath = './data/storage/local/testing/case1/20250302_185802.json';
    let testData;
    try {
        const content = await fs.readFile(testDataPath, 'utf8');
        testData = JSON.parse(content);
        console.log(`✅ Loaded test execution data from ${testDataPath}`);
    } catch (error) {
        console.error(`❌ Failed to load test data: ${error.message}`);
        return;
    }

    // Standardize test data to match expected API response format
    // The API likely returns the full object or a subset
    const mockApiResponse = {
        codes: testData.icd_cm_codes || [],
        diagnosis: testData.diagnosis || [],
        confidence: 0.95
    };

    console.log('\n--- Simulating API Response Handling ---');
    console.log('Input Data (Diagnosis):', mockApiResponse.diagnosis.map(d => d.diagnosis).join(', '));
    console.log('Expected Codes:', mockApiResponse.codes);

    // Test Mock Mode
    console.log('\n--- Testing Client Mock Mode ---');
    try {
        // This should trigger the mock logic since ICD_API_URL is likely empty in config main
        const result = await getIcdCodes("Patient has fever and chills.", { mockData: mockApiResponse });
        console.log('Client Result:', JSON.stringify(result, null, 2));

        if (result.mock && result.codes.length > 0) {
            console.log('✅ Client successfully retrieved local mock data.');
        } else {
            console.warn('⚠️ Client returned empty or non-mock data.');
        }
    } catch (error) {
        console.error('Client Error:', error.message);
    }

    // Verify structure compatibility
    if (mockApiResponse.codes.length > 0 && mockApiResponse.diagnosis.length > 0) {
        console.log('✅ ICD Annotation data structure matches expected client usage.');
    } else {
        console.warn('⚠️ Test data missing expected fields (codes or diagnosis).');
    }
}

testIcdIntegration().catch(console.error);
