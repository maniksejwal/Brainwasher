/**
 * @fileoverview This module is the central client for all interactions with the
 * external LLM APIs. It supports both Google Gemini and OpenAI GPT, defaulting to
 * OpenAI if a key is provided. It manages API key rotation and implements a robust
 * retry mechanism.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import config from '../config.js';

let geminiClients = [];
let openAIClient;
let useOpenAI = false;

if (config.CHAT_GPT_KEY) {
    try {
        openAIClient = new OpenAI({ apiKey: config.CHAT_GPT_KEY });
        useOpenAI = true;
        console.log('[Agent] OpenAI client initialized. Will use as default.');
    } catch (error) {
        console.error('[Agent] Error initializing OpenAI client:', error.message);
    }
}

if (config.GEMINI_API_KEYS && config.GEMINI_API_KEYS.length > 0) {
    geminiClients = config.GEMINI_API_KEYS.map(apiKey => {
        if (!apiKey) return null;
        try {
            return new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: config.GEMINI_MODEL });
        } catch (error) {
            console.error('[Agent] Error initializing a Gemini client:', error.message);
            return null;
        }
    }).filter(Boolean);
    if (geminiClients.length > 0) {
        console.log(`[Agent] ${geminiClients.length} Gemini client(s) initialized.`);
    }
}

if (!useOpenAI && geminiClients.length === 0) {
    console.error("\n[Agent] FATAL ERROR: No valid API keys found for OpenAI or Gemini.");
}

let geminiKeyIndex = 0;
function getNextGeminiClient() {
    if (geminiClients.length === 0) return null;
    const client = geminiClients[geminiKeyIndex];
    geminiKeyIndex = (geminiKeyIndex + 1) % geminiClients.length;
    return client;
}

// FIX: Added 'expectJson' parameter to conditionally request JSON from OpenAI
export async function makeApiCall(prompt, history = [], expectJson = false) {
    const fullPrompt = `${history.join('\n')}\n\n${prompt}`;
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            let text;
            if (useOpenAI) {
                const requestBody = {
                    model: config.OPENAI_MODEL,
                    messages: [{ role: 'user', content: fullPrompt }],
                };
                if (expectJson) {
                    requestBody.response_format = { type: "json_object" };
                }
                const completion = await openAIClient.chat.completions.create(requestBody);
                text = completion.choices[0].message.content;
            } else {
                const model = getNextGeminiClient();
                if (!model) throw new Error("No Gemini clients available.");
                const result = await model.generateContent(fullPrompt);
                const response = await result.response;
                text = response.text();
            }

            // Process the response
            if (expectJson) {
                const parsedResponse = parseJsonResponse(text, attempt, maxRetries);
                if (parsedResponse) {
                    return parsedResponse;
                }
                // If parsing failed and we have retries left, continue to retry
                if (attempt < maxRetries) {
                    console.warn(`[Agent] JSON parsing failed on attempt ${attempt}, retrying...`);
                    continue;
                }
                // Last attempt failed - return fallback
                return createFallbackResponse(text);
            }
            
            return { reply: text };

        } catch (error) {
            lastError = error;
            const shouldRetry = shouldRetryError(error, attempt, maxRetries);
            
            if (shouldRetry) {
                const delay = calculateRetryDelay(attempt);
                console.warn(`[Agent] API call failed on attempt ${attempt}, retrying in ${Math.round(delay/1000)}s...`, error.message);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                break;
            }
        }
    }

    console.error("[Agent] Error calling API after all retries:", lastError);
    return createFallbackResponse("I'm having some trouble processing that right now.");
}

function parseJsonResponse(text, attempt, maxRetries) {
    // Try markdown-wrapped JSON first
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch && jsonMatch[1]) {
        try {
            return JSON.parse(jsonMatch[1]);
        } catch (e) {
            console.warn(`[Agent] Failed to parse markdown JSON on attempt ${attempt}:`, e.message);
        }
    }
    
    // Try raw JSON
    try {
        return JSON.parse(text);
    } catch (e) {
        console.warn(`[Agent] Failed to parse raw JSON on attempt ${attempt}:`, e.message);
        return null;
    }
}

function shouldRetryError(error, attempt, maxRetries) {
    if (attempt >= maxRetries) return false;
    
    const status = error.status || (error.response ? error.response.status : 500);
    const errorMessage = error.message?.toLowerCase() || '';
    
    // Retry on network/rate limit errors
    if (status === 503 || status === 429 || status === 502 || status === 504) {
        return true;
    }
    
    // Retry on timeout errors
    if (errorMessage.includes('timeout') || errorMessage.includes('network')) {
        return true;
    }
    
    // Retry on API key rotation for Gemini
    if (errorMessage.includes('api key') || errorMessage.includes('quota')) {
        return true;
    }
    
    return false;
}

function calculateRetryDelay(attempt) {
    // Exponential backoff with jitter
    const baseDelay = Math.pow(2, attempt) * 1000;
    const jitter = Math.random() * 1000;
    return baseDelay + jitter;
}

function createFallbackResponse(reply) {
    return {
        intent: 'ASKING_QUESTION',
        state_update: null,
        reply: reply,
        privacyLevel: 'PRIVATE',
        criticality: 'NONE',
        facts: {},
        mentioned_usernames: [],
        sharingSuggestion: null
    };
}

