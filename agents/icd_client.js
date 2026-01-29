/**
 * @fileoverview Client for interacting with the ICD Coding and Doc Categorization API.
 */

import config from '../config.js';
import { getStorage } from '../lib/storage/index.js';

// Mock data path (relative to project root)
// Mock data path (relative to storage root)
const MOCK_DATA_PATH = 'testing/case1/20250302_185802.json';

/**
 * Get ICD codes for specific medical text
 * @param {string} text - The medical text to analyze
 * @param {object} options - Optional parameters
 * @returns {Promise<object>} ICD analysis result
 */
export async function getIcdCodes(text, options = {}) {
    if (!config.ICD_API_URL) {
        console.warn('[ICD Client] ICD_API_URL not configured. Using local mock data.');
        return await _getMockData();
    }

    try {
        const response = await fetch(`${config.ICD_API_URL}/extract`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.ICD_API_KEY ? { 'x-api-key': config.ICD_API_KEY } : {})
            },
            body: JSON.stringify({
                text: text,
                ...options
            })
        });

        if (!response.ok) {
            throw new Error(`ICD API Error: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('[ICD Client] Failed to get ICD codes:', error.message);
        throw error;
    }
}

/**
 * Categorize a medical document
 * @param {string} text - Document content
 * @returns {Promise<object>} Categorization result
 */
export async function categorizeDocument(text) {
    if (!config.ICD_API_URL) {  // Assuming same base URL for now
        console.warn('[ICD Client] ICD_API_URL not configured. Returning mock category.');
        return { category: 'UNKNOWN', confidence: 0, mock: true };
    }

    try {
        const response = await fetch(`${config.ICD_API_URL}/categorize`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.ICD_API_KEY ? { 'x-api-key': config.ICD_API_KEY } : {})
            },
            body: JSON.stringify({ text })
        });

        if (!response.ok) {
            throw new Error(`Doc Categorizer API Error: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('[ICD Client] Failed to categorize document:', error.message);
        throw error;
    }
}

/**
 * Helper to load mock data from storage
 */
async function _getMockData() {
    try {
        const storage = getStorage();
        if (await storage.exists(MOCK_DATA_PATH)) {
            const content = await storage.read(MOCK_DATA_PATH);
            const data = JSON.parse(content);
            return {
                codes: data.icd_cm_codes || [],
                diagnosis: data.diagnosis || [],
                confidence: 0.95, // Simulated confidence
                mock: true
            };
        }
    } catch (error) {
        console.error('[ICD Client] Failed to load mock data:', error.message);
    }
    return { codes: [], diagnosis: [], mock: true };
}
