/**
 * @fileoverview This module is the central client for all interactions with the
 * external LLM APIs. It supports both Google Gemini and OpenAI GPT, defaulting to
 * OpenAI if a key is provided. It manages API key rotation and implements a robust
 * retry mechanism.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import config from '../config.js';
import { parseJsonWithFixes } from '../utils/jsonParser.js';

const PROVIDERS = Object.freeze({
    OLLAMA: 'ollama',
    OPENAI: 'openai',
    GEMINI: 'gemini',
});

const RESPONSE_MESSAGES = Object.freeze({
    GENERIC_FAILURE: 'I hit an issue reaching our language models. Please try again soon.',
    MODEL_UNAVAILABLE: modelName => `I couldn't reach ${modelName}. Please make sure it's available and try again.`,
    NETWORK_FAILURE: 'I lost connection to our language service. Please check the network and try again.',
});

let geminiClients = [];
let openAIClient;
let failedKeys = new Set(); // Track failed API keys
let requestCounter = 0; // For load balancing
let useOnlyOpenAI = config.USE_ONLY_OPENAI ?? false; // Flag to skip round-robin and use only OpenAI (set via config)
const providerState = {
    ollamaFailed: false,
};
const providerLogs = {
    success: [],
    failure: [],
};

function trackProviderOutcome(type, model, status, detail = '') {
    const entry = `${type}:${model}${detail ? ` (${detail})` : ''}`;
    if (status === 'success') {
        providerLogs.success.push(entry);
    } else {
        providerLogs.failure.push(entry);
    }
}

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

if (geminiClients.length === 0 && !openAIClient && !config.OLLAMA_API_BASE_URL) {
    console.error("\n[Agent] FATAL ERROR: No valid API providers configured (Ollama, OpenAI, Gemini).");
}

function isOllamaAvailable() {
    return Boolean(config.OLLAMA_API_BASE_URL) && !providerState.ollamaFailed;
}

const OPENAI_MODELS = new Set(
    [
        config.OPENAI_MODEL,
        config.OPENAI_MODEL_GPT4,
        config.OPENAI_MODEL_GPT4_TURBO,
        config.OPENAI_MODEL_GPT4O,
        config.OPENAI_MODEL_GPT4O_MINI,
        config.OPENAI_MODEL_GPT5,
    ].filter(Boolean)
);

function normalizeModelForProvider(providerType, desiredModel) {
    switch (providerType) {
        case PROVIDERS.OPENAI:
            return OPENAI_MODELS.has(desiredModel) ? desiredModel : config.OPENAI_MODEL;
        case PROVIDERS.GEMINI:
            return desiredModel?.toLowerCase().includes('gemini')
                ? desiredModel
                : config.GEMINI_MODEL;
        case PROVIDERS.OLLAMA:
            return desiredModel?.toLowerCase().startsWith('gpt-')
                ? (config.OLLAMA_DEFAULT_MODEL || config.DEFAULT_MODEL)
                : desiredModel;
        default:
            return desiredModel;
    }
}

async function callOllama(prompt, temperature, maxTokens, model) {
    if (!config.OLLAMA_API_BASE_URL) {
        throw new Error('[Agent] Ollama base URL not configured');
    }

    const requestBody = {
        model: model || config.OLLAMA_DEFAULT_MODEL || config.DEFAULT_MODEL,
        prompt,
        stream: false,
    };

    if (typeof temperature === 'number') {
        requestBody.temperature = temperature;
    }

    if (typeof maxTokens === 'number') {
        requestBody.max_tokens = maxTokens;
    }

    const response = await fetch(`${config.OLLAMA_API_BASE_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const error = new Error(`[Agent] Ollama request failed (${response.status}): ${errorText || response.statusText}`);
        error.status = response.status;
        throw error;
    }

    const data = await response.json();
    if (typeof data?.response !== 'string') {
        throw new Error('[Agent] Ollama response missing "response" field');
    }

    return data;
}

// Get next available provider (round-robin between Gemini and OpenAI, or OpenAI only)
function getNextProvider(useCase = 'basic_responses') {
    // If useOnlyOpenAI flag is set, return OpenAI only
    if (useOnlyOpenAI) {
        if (openAIClient && !failedKeys.has(config.CHAT_GPT_KEY)) {
            return { type: PROVIDERS.OPENAI, client: openAIClient };
        }
        return null;
    }

    const availableProviders = [];

    if (isOllamaAvailable()) {
        availableProviders.push({ type: PROVIDERS.OLLAMA });
    }

    // Add Gemini clients that haven't failed
    const workingGeminiClients = geminiClients.filter(gc => !failedKeys.has(gc.apiKey));
    if (workingGeminiClients.length > 0) {
        availableProviders.push({ type: PROVIDERS.GEMINI, clients: workingGeminiClients });
    }

    // Add OpenAI if available and not failed
    if (openAIClient && !failedKeys.has(config.CHAT_GPT_KEY)) {
        availableProviders.push({ type: PROVIDERS.OPENAI, client: openAIClient });
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
    providerState.ollamaFailed = false;
    providerLogs.success = [];
    providerLogs.failure = [];

    // Select appropriate model based on use case
    const modelSelection = selectModelForUseCase(useCase, expectJson, prompt.length);

    try {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const provider = getNextProvider();
            if (!provider) {
                console.error('[Agent] No available API providers');
                return createFallbackResponse(RESPONSE_MESSAGES.GENERIC_FAILURE);
            }

            const providerType = provider.type;
            const baseModel = modelSelection.preferredModel || config.OLLAMA_DEFAULT_MODEL || config.DEFAULT_MODEL;
            const modelForAttempt = normalizeModelForProvider(providerType, baseModel);

            try {
                let text;
                switch (providerType) {
                    case PROVIDERS.OLLAMA: {
                        const ollamaResult = await callOllama(fullPrompt, temperature, maxTokens, modelForAttempt);
                        text = ollamaResult.response;
                        providerState.ollamaFailed = false;
                        trackProviderOutcome(PROVIDERS.OLLAMA, modelForAttempt, 'success');
                        break;
                    }
                    case PROVIDERS.OPENAI: {
                        const requestBody = {
                            model: modelForAttempt,
                            messages: [{ role: 'user', content: fullPrompt }],
                            temperature,
                            max_tokens: maxTokens,
                        };
                        if (expectJson) {
                            requestBody.response_format = { type: 'json_object' };
                        }
                        const completion = await provider.client.chat.completions.create(requestBody);
                        text = completion.choices[0].message.content;
                        trackProviderOutcome(PROVIDERS.OPENAI, modelForAttempt, 'success');
                        break;
                    }
                    case PROVIDERS.GEMINI: {
                        const geminiClientsForAttempt = provider.clients || [];
                        if (geminiClientsForAttempt.length === 0) {
                            throw new Error('[Agent] No Gemini clients available');
                        }
                        const geminiClient = geminiClientsForAttempt[attempt % geminiClientsForAttempt.length];
                        const generationConfig = {
                            temperature,
                            maxOutputTokens: maxTokens,
                        };
                        const result = await geminiClient.client.generateContent(fullPrompt, generationConfig);
                        const response = await result.response;
                        text = response.text();
                        trackProviderOutcome(`${PROVIDERS.GEMINI}#${geminiClient.index}`, modelForAttempt, 'success');
                        break;
                    }
                    default:
                        throw new Error(`[Agent] Unsupported provider type: ${providerType}`);
                }

                if (expectJson) {
                    const parsedResponse = parseJsonResponse(text, attempt, maxRetries);
                    if (parsedResponse) {
                        logProviderSummary();
                        // Attach metadata to the parsed object
                        if (typeof parsedResponse === 'object' && parsedResponse !== null) {
                            parsedResponse.model_used = modelForAttempt;
                            parsedResponse.model_provider = providerType;
                        }
                        return parsedResponse;
                    }
                    if (attempt < maxRetries) {
                        continue;
                    }
                    console.warn('[Agent] All JSON parsing attempts failed, returning raw text for handler processing');
                    logProviderSummary();
                    return {
                        reply: text,
                        modelUsed: modelForAttempt,
                        modelProvider: providerType,
                        _parsingFailed: true,
                    };
                }

                logProviderSummary();
                return {
                    reply: text,
                    modelUsed: modelForAttempt,
                    modelProvider: providerType,
                };
            } catch (error) {
                lastError = error;
                const briefMessage = (error.message || String(error)).split('\n')[0];
                trackProviderOutcome(providerType, modelForAttempt, 'failure', briefMessage);

                switch (providerType) {
                    case PROVIDERS.OPENAI:
                        if (isKeyFailureError(error)) {
                            failedKeys.add(config.CHAT_GPT_KEY);
                        }
                        break;
                    case PROVIDERS.GEMINI: {
                        const geminiClientsForAttempt = provider.clients || [];
                        if (geminiClientsForAttempt.length === 0) {
                            break;
                        }
                        const geminiClient = geminiClientsForAttempt[attempt % geminiClientsForAttempt.length];
                        if (isKeyFailureError(error)) {
                            failedKeys.add(geminiClient.apiKey);
                        }
                        break;
                    }
                    case PROVIDERS.OLLAMA:
                        providerState.ollamaFailed = true;
                        break;
                    default:
                        break;
                }

                const shouldRetry = shouldRetryError(error, attempt, maxRetries, providerType);

                if (shouldRetry) {
                    const delay = calculateRetryDelay(attempt);
                    console.warn(`[Agent] Retry ${attempt}/${maxRetries} in ${Math.round(delay / 1000)}s`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    break;
                }
            }
        }

        const errorMessage = lastError?.message || String(lastError) || 'Unknown error';
        logProviderSummary();
        console.error(`[Agent] All retries failed: ${errorMessage.split('.')[0]}`);
        return createFallbackResponse(RESPONSE_MESSAGES.GENERIC_FAILURE, lastError);
    } finally {
        providerState.ollamaFailed = false;
    }
}

function parseJsonResponse(text, attempt, maxRetries) {
    // Only log errors on the final attempt (when all retries will fail)
    // First error: silent, second attempt success: silent, second attempt failure: log
    return parseJsonWithFixes(text, { logErrors: attempt === maxRetries, attempt });
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

function shouldRetryError(error, attempt, maxRetries, providerType = PROVIDERS.OPENAI) {
    if (attempt >= maxRetries) return false;

    const status = error.status || (error.response ? error.response.status : 500);
    const errorMessage = error.message?.toLowerCase() || '';

    if (providerType === 'ollama') {
        if (status >= 500 || status === 408) {
            return true;
        }
        return errorMessage.includes('timeout') || errorMessage.includes('network');
    }

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

function createFallbackResponse(defaultReply, error = null) {
    logProviderSummary();
    let reply = defaultReply;

    if (error) {
        const message = (error.message || String(error)).toLowerCase();
        if (message.includes('does not exist') && message.includes('model')) {
            const modelMatch = message.match(/model [`'"]?([\w:.\-]+)[`'"]?/);
            const modelName = modelMatch ? modelMatch[1] : 'the requested model';
            reply = RESPONSE_MESSAGES.MODEL_UNAVAILABLE(modelName);
        } else if (message.includes('fetch failed') || message.includes('network')) {
            reply = RESPONSE_MESSAGES.NETWORK_FAILURE;
        }
    }

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
    const workingOllama = isOllamaAvailable() ? 1 : 0;

    let nextProviderType = 'none';
    const previewProvider = getNextProvider();
    if (previewProvider) {
        nextProviderType = previewProvider.type;
        requestCounter = Math.max(0, requestCounter - 1);
    }

    return {
        totalRequests: requestCounter,
        workingProviders: {
            ollama: workingOllama,
            gemini: workingGeminiClients.length,
            openai: workingOpenAI ? 1 : 0
        },
        failedKeys: Array.from(failedKeys),
        nextProvider: nextProviderType
    };
}

// Reset failed keys (useful for testing or when keys are renewed)
export function resetFailedKeys() {
    failedKeys.clear();
    providerState.ollamaFailed = false;
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

function logProviderSummary() {
    if (providerLogs.success.length > 0) {
        console.info(`[Agent] Providers succeeded: ${providerLogs.success.join(', ')}`);
    }
    if (providerLogs.failure.length > 0) {
        console.warn(`[Agent] Providers failed: ${providerLogs.failure.join(', ')}`);
    }
    providerLogs.success = [];
    providerLogs.failure = [];
}

