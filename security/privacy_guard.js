
/**
 * @fileoverview Privacy Guard
 * Utilities for scrubbing Personally Identifiable Information (PII) from data
 * before logging or storage in analysis databases.
 */

export class PrivacyGuard {
    constructor() {
        this.patterns = [
            // Email
            { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
            // Phone (generic international/US formats)
            { regex: /(\+\d{1,3}[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}/g, replacement: '[PHONE]' },
            // SSN (US)
            { regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN]' },
            // Credit Card (Major brands, simple check)
            { regex: /\b(?:\d[ -]*?){13,16}\b/g, replacement: '[CREDIT_CARD]' },
            // Generic Names (Basic Heuristic: Capitalized words following specific triggers)
            // Note: This is weak PII detection. Proper NER requires models (e.g. spaCy/Compromise)
            // For now, we rely on simulation data not having real PII, but we mask obvious patterns
            { regex: /(?<=name is\s)([A-Z][a-z]+)/g, replacement: '[NAME]' },
            { regex: /(?<=Call me\s)([A-Z][a-z]+)/g, replacement: '[NAME]' }
        ];
    }

    /**
     * Scrub PII from a string
     * @param {string} text - Text to scrub
     * @returns {string} Scrubbed text
     */
    scrub(text) {
        // Skip scrubbing in simulation mode (per user request: "simulation doesn't need")
        if (process.env.SIMULATION_MODE === 'true') return text;

        if (!text || typeof text !== 'string') return text;

        let scrubbed = text;
        for (const pattern of this.patterns) {
            scrubbed = scrubbed.replace(pattern.regex, pattern.replacement);
        }
        return scrubbed;
    }

    /**
     * Recursively scrub PII from an object
     * @param {Object} obj - Object to scrub
     * @returns {Object} New object with scrubbed values
     */
    scrubObject(obj) {
        if (!obj) return obj;
        if (typeof obj === 'string') return this.scrub(obj);
        if (typeof obj !== 'object') return obj;

        // Handle Arrays
        if (Array.isArray(obj)) {
            return obj.map(item => this.scrubObject(item));
        }

        // Handle Objects
        const scrubbedObj = {};
        for (const [key, value] of Object.entries(obj)) {
            // Skip scrubbing certain keys if needed (e.g., IDs might look like PII but aren't)
            // if (key === 'id') scrubbedObj[key] = value;

            scrubbedObj[key] = this.scrubObject(value);
        }
        return scrubbedObj;
    }
}

// Export singleton
export const privacyGuard = new PrivacyGuard();
