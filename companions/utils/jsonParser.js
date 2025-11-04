/**
 * @fileoverview JSON parsing utility for Companion handlers
 * Extracts JSON from API responses that may be wrapped in markdown code blocks
 */

import { parseJsonWithFixes, parseApiResponse } from '../../utils/jsonParser.js';

/**
 * Parse JSON from API response (Companion-specific)
 * Handles both direct JSON objects and responses that need parsing
 * @param {object|string} apiResponse - Response from makeApiCall (either parsed object or { reply: "..." })
 * @returns {object|null} Parsed JSON object or null if parsing fails
 */
export function parseCompanionResponse(apiResponse) {
    // Handle null/undefined
    if (!apiResponse) {
        console.warn('[JSONParser] Empty API response');
        return null;
    }
    
    // Use shared parser
    return parseApiResponse(apiResponse);
}

