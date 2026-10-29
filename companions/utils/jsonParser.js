/**
 * @fileoverview JSON parsing utility for Companion handlers
 * Extracts JSON from API responses that may be wrapped in markdown code blocks
 */

import { parseJsonWithFixes, parseApiResponse } from '../../utils/jsonParser.js';

/**
 * Parse JSON from API response (Companion-specific)
 * Handles both direct JSON objects and responses that need parsing
 * @param {object|string} apiResponse - Response from makeApiCall (either parsed object or { reply: "..." })
 * @param {string} component - Caller name, used to log when the LLM call fell back
 * @returns {object|null} Parsed JSON object or null if parsing fails
 */
export function parseCompanionResponse(apiResponse, component = 'Companion') {
    // Handle null/undefined
    if (!apiResponse) {
        console.warn('[JSONParser] Empty API response');
        return null;
    }

    if (apiResponse.isFallback) {
        console.warn(`[${component}] LLM call failed; using fallback defaults`);
    }
    
    // Use shared parser
    return parseApiResponse(apiResponse);
}

