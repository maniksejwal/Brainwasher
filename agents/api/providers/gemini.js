/**
 * @fileoverview Gemini Provider Implementation
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../../../config.js';
import { PROVIDERS } from '../config.js';

console.log('[DEBUG Gemini] Module loaded. GoogleGenerativeAI type:', typeof GoogleGenerativeAI);

let geminiClients = [];

export function initializeGemini(failedKeys) {
    if (config.GEMINI_API_KEYS && config.GEMINI_API_KEYS.length > 0) {
        geminiClients = config.GEMINI_API_KEYS.map((apiKey, index) => {
            if (!apiKey) return null;
            try {
                const client = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: config.GEMINI_MODEL });
                return { client, apiKey, index };
            } catch (error) {
                console.error(`[Agent] Error initializing Gemini client ${index}:`, error.message);
                failedKeys.add(apiKey);
                return null;
            }
        }).filter(Boolean);

        if (geminiClients.length > 0) {
            console.log(`[Agent] ${geminiClients.length} Gemini client(s) initialized.`);
        }
    }
    return geminiClients;
}

export function getGeminiClients() {
    return geminiClients;
}

export function addGeminiKeys(newKeys, failedKeys) {
    const validKeys = newKeys.filter(key => key && !failedKeys.has(key));

    validKeys.forEach((apiKey, index) => {
        try {
            const client = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: config.GEMINI_MODEL });
            geminiClients.push({ client, apiKey, index: geminiClients.length + index });
            console.log(`[Agent] Added Gemini client ${geminiClients.length + index}`);
        } catch (error) {
            console.error(`[Agent] Error adding Gemini key:`, error.message);
            failedKeys.add(apiKey);
        }
    });

    return validKeys.length;
}

export async function callGemini(client, prompt, temperature, maxTokens) {
    const generationConfig = {
        temperature,
        maxOutputTokens: maxTokens,
    };
    const result = await client.client.generateContent(prompt, generationConfig);
    const response = await result.response;
    const text = response.text();

    const usage = {
        prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
        completion_tokens: response.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: response.usageMetadata?.totalTokenCount || 0
    };

    return { text, usage };
}
