/**
 * @fileoverview This module is the central client for all interactions with the
 * external Gemini API. It manages API key rotation and implements a robust
 * retry mechanism with exponential backoff to handle transient server errors.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config.js';

let genAIs = [];

if (config.API_KEYS && config.API_KEYS.length > 0) {
    genAIs = config.API_KEYS.map(apiKey => {
        if (!apiKey) return null;
        try {
            return new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: config.GEMINI_MODEL });
        } catch (error) {
            console.error('[Agent] Error initializing a Gemini client. Is the API key valid?', error.message);
            return null;
        }
    }).filter(Boolean);
}

if (genAIs.length === 0) {
    console.error("\n[Agent] FATAL ERROR: No valid Gemini API keys found or initialized.");
    console.error("Please check your .env file and ensure GEMINI_API_KEY_1 (and optionally GEMINI_API_KEY_2) are set correctly.\n");
}

let keyIndex = 0;
function getNextClient() {
    if (genAIs.length === 0) return null;
    const client = genAIs[keyIndex];
    keyIndex = (keyIndex + 1) % genAIs.length;
    return client;
}

export async function makeApiCall(prompt, history = []) {
    const model = getNextClient();
    if (!model) {
         return {
            reply: "The AI service is not configured. Please check the server logs.",
            privacyLevel: 'PRIVATE',
            criticality: 'NONE',
            facts: {},
            sharingSuggestion: null
        };
    }

    const fullPrompt = `${history.join('\n')}\n\n${prompt}`;
    
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await model.generateContent(fullPrompt);
            const response = await result.response;
            let text = response.text();
            
            const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch && jsonMatch[1]) {
                return JSON.parse(jsonMatch[1]);
            }
            return { reply: text };

        } catch (error) {
            lastError = error;
            if (error.status === 503 || error.status === 429) {
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                console.warn(`[Agent] API call failed with status ${error.status}. Retrying in ${Math.round(delay/1000)}s... (Attempt ${attempt}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                break;
            }
        }
    }

    console.error("[Agent] Error calling Gemini API after all retries:", lastError);
    return {
        reply: "I'm having some trouble processing that right now. Could you please rephrase?",
        privacyLevel: 'PRIVATE',
        criticality: 'LOW',
        facts: {},
        sharingSuggestion: null
    };
}
