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
let failedKeys = new Set(); // Track failed API keys
let requestCounter = 0; // For load balancing
let useOnlyOpenAI = true; // Flag to skip round-robin and use only OpenAI (default to true due to Gemini issues)

// Initialize OpenAI client
if (config.CHAT_GPT_KEY) {
    try {
        openAIClient = new OpenAI({ apiKey: config.CHAT_GPT_KEY });
        console.log('[Agent] OpenAI client initialized.');
    } catch (error) {
        console.error('[Agent] Error initializing OpenAI client:', error.message);
        failedKeys.add(config.CHAT_GPT_KEY);
    }
}

// Initialize Gemini clients
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

if (geminiClients.length === 0 && !openAIClient) {
    console.error("\n[Agent] FATAL ERROR: No valid API keys found for OpenAI or Gemini.");
}

// Get next available provider (round-robin between Gemini and OpenAI, or OpenAI only)
function getNextProvider(useCase = 'basic_responses') {
    // If useOnlyOpenAI flag is set, return OpenAI only
    if (useOnlyOpenAI) {
        if (openAIClient && !failedKeys.has(config.CHAT_GPT_KEY)) {
            return { type: 'openai', client: openAIClient };
        }
        return null;
    }
    
    const availableProviders = [];
    
    // Add Gemini clients that haven't failed
    const workingGeminiClients = geminiClients.filter(gc => !failedKeys.has(gc.apiKey));
    if (workingGeminiClients.length > 0) {
        availableProviders.push({ type: 'gemini', clients: workingGeminiClients });
    }
    
    // Add OpenAI if available and not failed
    if (openAIClient && !failedKeys.has(config.CHAT_GPT_KEY)) {
        availableProviders.push({ type: 'openai', client: openAIClient });
    }
    
    if (availableProviders.length === 0) {
        return null;
    }
    
    // Round-robin between providers
    const provider = availableProviders[requestCounter % availableProviders.length];
    requestCounter++;
    
    return provider;
}

// Select appropriate model based on use case - SIMPLIFIED
function selectModelForUseCase(useCase, expectJson, promptLength) {
    // If free tier only, use default model
    if (config.USE_FREE_TIER_ONLY) {
        return {
            preferredModel: config.DEFAULT_MODEL,
            fallbackModel: config.FALLBACK_MODEL,
            reason: 'Free tier only mode'
        };
    }
    
    // Simple use case mapping
    const useCaseModels = {
        'basic_responses': config.BASIC_RESPONSES_MODEL,
        'conversational_agent': config.CONVERSATIONAL_AGENT_MODEL,
        'escalation': config.ESCALATION_MODEL,
        'critical_analysis': config.CRITICAL_ANALYSIS_MODEL,
        'synthetic_user': config.SYNTHETIC_USER_MODEL
    };
    
    const selectedModel = useCaseModels[useCase] || config.DEFAULT_MODEL;
    
    return {
        preferredModel: selectedModel,
        fallbackModel: config.FALLBACK_MODEL,
        reason: `Use case: ${useCase}`
    };
}

// Enhanced API call with load balancing and failover
export async function makeApiCall(prompt, history = [], expectJson = false, temperature = 0.7, maxTokens = 100, useCase = 'basic_responses') {
    const fullPrompt = `${history.join('\n')}\n\n${prompt}`;
    const maxRetries = 3;
    let lastError = null;

    // Select appropriate model based on use case
    const modelSelection = selectModelForUseCase(useCase, expectJson, prompt.length);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const provider = getNextProvider();
        if (!provider) {
            console.error("[Agent] No available API providers");
            return createFallbackResponse("I'm having some trouble processing that right now.");
        }

        try {
            let text;
            let apiKey;
            
            if (provider.type === 'openai') {
                // Use model from config
                const requestBody = {
                    model: config.OPENAI_MODEL, // Use config value
                    messages: [{ role: 'user', content: fullPrompt }],
                    temperature: temperature,
                    max_tokens: maxTokens
                };
                if (expectJson) {
                    requestBody.response_format = { type: "json_object" };
                }
                const completion = await provider.client.chat.completions.create(requestBody);
                text = completion.choices[0].message.content;
                apiKey = config.CHAT_GPT_KEY;
                
            } else if (provider.type === 'gemini') {
                // Round-robin between available Gemini clients
                const geminiClient = provider.clients[attempt % provider.clients.length];
                const generationConfig = {
                    temperature: temperature,
                    maxOutputTokens: maxTokens
                };
                
                const result = await geminiClient.client.generateContent(fullPrompt, generationConfig);
                const response = await result.response;
                text = response.text();
                apiKey = geminiClient.apiKey;
                console.log(`[Agent] ✅ Gemini request successful (attempt ${attempt}, client ${geminiClient.index})`);
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
            
            return { 
                reply: text, 
                modelUsed: provider.type === 'openai' ? config.OPENAI_MODEL : config.GEMINI_MODEL,
                modelProvider: provider.type
            };

        } catch (error) {
            lastError = error;
            
            // Mark this API key as failed if it's a key-specific error
            if (provider.type === 'openai') {
                if (isKeyFailureError(error)) {
                    failedKeys.add(config.CHAT_GPT_KEY);
                    console.warn(`[Agent] ❌ OpenAI failed: ${error.message.split('.')[0]}`);
                }
            } else if (provider.type === 'gemini') {
                const geminiClient = provider.clients[attempt % provider.clients.length];
                if (isKeyFailureError(error)) {
                    failedKeys.add(geminiClient.apiKey);
                    console.warn(`[Agent] ❌ Gemini ${geminiClient.index} failed: ${error.message.split('.')[0]}`);
                }
            }
            
            const shouldRetry = shouldRetryError(error, attempt, maxRetries);
            
            if (shouldRetry) {
                const delay = calculateRetryDelay(attempt);
                console.warn(`[Agent] Retry ${attempt}/${maxRetries} in ${Math.round(delay/1000)}s`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                break;
            }
        }
    }

    console.error(`[Agent] All retries failed: ${lastError.message.split('.')[0]}`);
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

function isKeyFailureError(error) {
    const status = error.status || (error.response ? error.response.status : 500);
    const errorMessage = error.message?.toLowerCase() || '';
    
    // API key specific failures
    if (status === 401 || status === 403) {
        return true; // Unauthorized/Forbidden
    }
    
    // Model not found (404) - treat as key failure to avoid retrying
    if (status === 404 && errorMessage.includes('model')) {
        return true;
    }
    
    // Quota exceeded or invalid key
    if (errorMessage.includes('quota exceeded') || 
        errorMessage.includes('invalid api key') ||
        errorMessage.includes('api key not found') ||
        errorMessage.includes('billing') ||
        errorMessage.includes('payment')) {
        return true;
    }
    
    return false;
}

function shouldRetryError(error, attempt, maxRetries) {
    if (attempt >= maxRetries) return false;
    
    const status = error.status || (error.response ? error.response.status : 500);
    const errorMessage = error.message?.toLowerCase() || '';
    
    // Don't retry if it's a key failure
    if (isKeyFailureError(error)) {
        return false;
    }
    
    // Retry on network/rate limit errors
    if (status === 503 || status === 429 || status === 502 || status === 504) {
        return true;
    }
    
    // Retry on timeout errors
    if (errorMessage.includes('timeout') || errorMessage.includes('network')) {
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

// Export utility functions for monitoring
export function getApiStats() {
    const workingGeminiClients = geminiClients.filter(gc => !failedKeys.has(gc.apiKey));
    const workingOpenAI = openAIClient && !failedKeys.has(config.CHAT_GPT_KEY);
    
    return {
        totalRequests: requestCounter,
        workingProviders: {
            gemini: workingGeminiClients.length,
            openai: workingOpenAI ? 1 : 0
        },
        failedKeys: Array.from(failedKeys),
        nextProvider: getNextProvider()?.type || 'none'
    };
}

// Reset failed keys (useful for testing or when keys are renewed)
export function resetFailedKeys() {
    failedKeys.clear();
    console.log('[Agent] Failed keys reset - all providers available again');
}

// Add more Gemini keys dynamically
export function addGeminiKeys(newKeys) {
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

// Control functions
export function setUseOnlyOpenAI(onlyOpenAI = true) {
    useOnlyOpenAI = onlyOpenAI;
    console.log(`[Agent] ${onlyOpenAI ? 'Using OpenAI only' : 'Using round-robin load balancing'}`);
}

export function isUsingOnlyOpenAI() {
    return useOnlyOpenAI;
}

