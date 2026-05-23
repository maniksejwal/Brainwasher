/**
 * @fileoverview Shared JSON parsing utility
 * Handles malformed JSON from LLM APIs with common fixes
 */

/**
 * Parse JSON from text with fixes for common malformations
 * @param {string} text - Text to parse
 * @param {object} options - Options
 * @param {boolean} options.logErrors - Whether to log errors (default: false)
 * @param {number} options.attempt - Attempt number for logging (default: 1)
 * @returns {object|null} Parsed JSON object or null if parsing fails
 */
export function parseJsonWithFixes(text, options = {}) {
    if (!text || typeof text !== 'string') {
        return null;
    }
    
    const { logErrors = false, attempt = 1 } = options;
    
    // Try markdown-wrapped JSON first
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch && jsonMatch[1]) {
        const parsed = tryParseJson(jsonMatch[1], logErrors, attempt);
        if (parsed) return parsed;
    }
    
    // Try raw JSON
    const parsed = tryParseJson(text, logErrors, attempt);
    if (parsed) return parsed;
    
    // Try finding JSON object in text
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        const parsed = tryParseJson(objectMatch[0], logErrors, attempt);
        if (parsed) return parsed;
    }
    
    return null;
}

/**
 * Try to parse JSON with common fixes for malformed JSON
 * @param {string} text - Text to parse
 * @param {boolean} logErrors - Whether to log errors
 * @param {number} attempt - Attempt number for logging
 * @returns {object|null} Parsed JSON or null
 */
function tryParseJson(text, logErrors, attempt) {
    // First try direct parse
    try {
        return JSON.parse(text);
    } catch (e) {
        // Try fixing common issues
    }
    
    // Fix 1: Remove trailing commas before } or ]
    let fixed = text.replace(/,(\s*[}\]])/g, '$1');
    
    // Fix 2: Remove trailing commas in arrays/objects (more aggressive)
    // Fix cases like: { "key": "value", } or [ "item", ]
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
    
    // Fix 3: Fix missing commas between object properties (when there's a } or ] after value)
    // Pattern: "value" } should be "value", } (but only if it's actually missing a comma)
    // This is tricky - we'll be conservative and only fix obvious cases
    
    // Fix 4: Replace single quotes with double quotes ONLY for JSON property keys
    // Only fix property keys: 'key': → "key": (safe - keys don't contain user content)
    fixed = fixed.replace(/'([^']+)':/g, '"$1":');
    
    // Fix 5: Add quotes to unquoted property names
    // Match: { property: value } → { "property": value }
    fixed = fixed.replace(/\{(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '{$1"$2":');
    
    // Fix 6: Fix missing commas between array elements
    // Pattern: "value" ] should be "value", ] if there's a preceding element
    // This is context-dependent, so we'll be conservative
    
    // Fix 7: Fix unclosed strings or objects (try to balance braces)
    const openBraces = (fixed.match(/\{/g) || []).length;
    const closeBraces = (fixed.match(/\}/g) || []).length;
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/\]/g) || []).length;
    
    // Add missing closing braces/brackets if needed
    if (openBraces > closeBraces) {
        fixed += '\n' + '}'.repeat(openBraces - closeBraces);
    }
    if (openBrackets > closeBrackets) {
        fixed += '\n' + ']'.repeat(openBrackets - closeBrackets);
    }
    
    try {
        return JSON.parse(fixed);
    } catch (e2) {
        // Try one more time with more aggressive fixes
        // Remove comments (if any)
        fixed = fixed.replace(/\/\/.*$/gm, '');
        fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');
        
        // Try to fix common JSON structure issues
        // Fix missing commas between array elements (most common issue)
        
        // Fix: } { should be }, { (missing comma between objects in array)
        fixed = fixed.replace(/\}\s*\{/g, '}, {');
        
        // Fix: ] { should be ], { (missing comma between array and object)
        fixed = fixed.replace(/\]\s*\{/g, '], {');
        
        // Fix: "value" { should be "value", { (missing comma between string and object)
        fixed = fixed.replace(/"\s*\{/g, '", {');
        
        // Fix: number { should be number, { (missing comma between number and object)
        fixed = fixed.replace(/(\d+)\s*\{/g, '$1, {');
        
        // Fix: "value"\n} or "value"\n] should be "value",\n} or "value",\n]
        // Only if there's content before (not the first property)
        fixed = fixed.replace(/([^,{[])"\s*\n\s*([}\]])/g, '$1",\n$2');
        
        // Fix: "value" } or "value" ] should be "value", } or "value", ]
        // Only if there's content before (not the first property)  
        fixed = fixed.replace(/([^,{[])"(\s+)([}\]])/g, '$1",$2$3');
        
        // Fix: number } or number ] should be number, } or number, ]
        fixed = fixed.replace(/(\d+)(\s+)([}\]])/g, '$1,$2$3');
        
        // Fix: } ] should be }, ] (object in array)
        fixed = fixed.replace(/\}(\s+)\]/g, '},$1]');
        
        // Fix: ] } should be ], } (array in object)  
        fixed = fixed.replace(/\](\s+)\}/g, '],$1}');
        
        try {
            return JSON.parse(fixed);
        } catch (e3) {
            // Only log errors on first attempt - if retry succeeds, we don't want to see the error
            // The caller will log if all attempts fail
            if (logErrors && attempt === 1) {
                // Use the most recent error (e3) for logging, fallback to e2 or e if needed
                const errorToLog = e3 || e2 || e;
                const errorMessage = errorToLog?.message || String(errorToLog) || 'Unknown parsing error';
                const posMatch = errorMessage.match(/position (\d+)/);
                const pos = posMatch ? parseInt(posMatch[1]) : null;
                const context = pos ? text.substring(Math.max(0, pos - 50), Math.min(text.length, pos + 50)) : 'N/A';
                // Only log if this is the final attempt (will be checked by caller)
                // For now, suppress the log - caller will log if all attempts fail
            }
            return null;
        }
    }
}

/**
 * Parse JSON from API response object (handles both direct objects and wrapped responses)
 * @param {object|string} apiResponse - Response from makeApiCall
 * @returns {object|null} Parsed JSON object or null
 */
export function parseApiResponse(apiResponse) {
    // Handle null/undefined
    if (!apiResponse) {
        return null;
    }
    
    // If already a parsed object with expected structure, return it
    if (typeof apiResponse === 'object' && !apiResponse.modelUsed && !apiResponse.error) {
        // Check if it's a Companion handler response (has handler-specific fields)
        const isCompanionResponse = (
            (apiResponse.level && !apiResponse.intent && !apiResponse.privacyLevel) || // empathyHandler
            (apiResponse.reply && !apiResponse.intent && !apiResponse.modelUsed) || // optimizer
            (apiResponse.assessment && apiResponse.criticality) || // clinicalAgent
            (apiResponse.intent && apiResponse.mentioned_usernames !== undefined) || // inputUnderstanding
            (apiResponse.state_update !== undefined && !apiResponse.intent) || // stateTracker
            (apiResponse.future_plan !== undefined && !apiResponse.modelUsed) // futurePlanningAgent
        );
        
        if (isCompanionResponse) {
            return apiResponse;
        }
        
        // If it has unified response structure, it might be a fallback - return null to trigger parsing
        if (apiResponse.intent && apiResponse.privacyLevel) {
            if (apiResponse.reply && typeof apiResponse.reply === 'string' && !apiResponse.reply.startsWith('{')) {
                return null; // Plain text fallback, needs parsing
            }
        }
    }
    
    // Extract text to parse
    let text = '';
    if (typeof apiResponse === 'string') {
        text = apiResponse;
    } else if (apiResponse?.reply) {
        text = apiResponse.reply;
    } else if (apiResponse?.content) {
        text = apiResponse.content;
    } else if (apiResponse?._parsingFailed && apiResponse.reply) {
        // This is a failed JSON parse from api_client - the reply contains the raw text
        text = apiResponse.reply;
        
        // Special handling for input understanding responses that failed JSON parsing
        if (text.includes('**Primary Intent**') || text.includes('**Mentioned Usernames**')) {
            return parseNaturalLanguageInputUnderstanding(text);
        }
    } else {
        // If it's an object but we can't extract text, check if it's a valid response structure
        if (typeof apiResponse === 'object') {
            // Check if it's a valid Companion response (future_plan, etc.)
            if (apiResponse.future_plan !== undefined && !apiResponse.modelUsed) {
                return apiResponse;
            }
            // Check if it's any other valid object response structure
            if (Object.keys(apiResponse).length > 0 && !apiResponse.modelUsed && !apiResponse.error) {
                // Only log warning if it's not a recognized structure
                const recognizedKeys = ['level', 'reply', 'assessment', 'intent', 'state_update', 'future_plan', 'criticality', 'mentioned_usernames'];
                const hasRecognizedKey = Object.keys(apiResponse).some(key => recognizedKeys.includes(key));
                if (!hasRecognizedKey) {
                    console.warn('[JSONParser] Could not extract text from response object. Keys:', Object.keys(apiResponse));
                }
                return apiResponse;
            }
        }
        return null;
    }
    
    if (!text || typeof text !== 'string') {
        return null;
    }
    
    // Use shared parser
    return parseJsonWithFixes(text, { logErrors: true, attempt: 1 });
}

/**
 * Parse natural language input understanding response when JSON parsing fails
 * Extracts structured data from Llama4's natural language format
 * @param {string} text - Natural language response
 * @returns {object|null} Parsed structure or null
 */
function parseNaturalLanguageInputUnderstanding(text) {
    try {
        const result = {
            intent: 'ASKING_QUESTION',
            mentioned_usernames: [],
            facts: {}
        };
        
        // Extract intent
        const intentMatch = text.match(/\*\*Primary Intent\*\*:.*?(?:classify|intent|would be)\s*(?:as\s*)?\*\*([A-Z_]+)\*\*/i);
        if (intentMatch) {
            result.intent = intentMatch[1];
        } else {
            // Try alternate patterns
            const altIntentMatch = text.match(/intent.*?(?:is|as|classify)\s*(?:as\s*)?"?([A-Z_]+)"?/i);
            if (altIntentMatch) {
                result.intent = altIntentMatch[1];
            }
        }
        
        // Extract mentioned usernames (usually says "no usernames mentioned" for simple cases)
        const usernamesMatch = text.match(/\*\*Mentioned Usernames\*\*:.*?(?:\[(.*?)\]|no usernames|There are no)/i);
        if (usernamesMatch && usernamesMatch[1]) {
            // Parse usernames from array format like ["user1", "user2"]
            const usernames = usernamesMatch[1].split(',').map(u => u.trim().replace(/['"]/g, ''));
            result.mentioned_usernames = usernames.filter(u => u.length > 0);
        }
        
        // Extract facts (usually says "no structured facts" for simple cases)
        const factsMatch = text.match(/\*\*Key Facts\*\*:(.*?)(?:\n\*\*|$)/is);
        if (factsMatch && factsMatch[1] && !factsMatch[1].includes('no structured facts')) {
            // Try to extract any key:value patterns
            const factText = factsMatch[1];
            const keyValueMatches = factText.match(/"([^"]+)":\s*"([^"]+)"/g);
            if (keyValueMatches) {
                keyValueMatches.forEach(match => {
                    const [, key, value] = match.match(/"([^"]+)":\s*"([^"]+)"/);
                    result.facts[key] = value;
                });
            }
        }
        
        console.log('[JSONParser] Successfully parsed natural language input understanding:', result);
        return result;
        
    } catch (error) {
        console.warn('[JSONParser] Failed to parse natural language input understanding:', error.message);
        return null;
    }
}

