/**
 * @fileoverview Main API Client Facade
 */

import config from '../../config.js';
import { parseJsonWithFixes } from '../../utils/jsonParser.js';
import { PROVIDERS, RESPONSE_MESSAGES } from './config.js';

// Logic modules
import {
    selectModelForUseCase,
    normalizeModelForProvider
} from './selector.js';
import {
    logUsage,
    trackProviderOutcome,
    logProviderSummary,
    providerLogs
} from './logger.js';
import {
    getNextProvider,
    failedKeys,
    providerState,
    setUseOnlyOpenAI,
    failedKeys as publicFailedKeys, // Re-export as read-only or setter
    resetFailedKeys
} from './balancer.js';

// Providers
import { initializeOpenAI, callOpenAI } from './providers/openai.js';
import { initializeGemini, callGemini, addGeminiKeys as providerAddGeminiKeys } from './providers/gemini.js';
import { callOllama } from './providers/ollama.js';
import { callLlama } from './providers/llama.js';

// Initialization
initializeOpenAI(failedKeys);
initializeGemini(failedKeys);

if (!config.CHAT_GPT_KEY && !config.GEMINI_API_KEYS?.length && !config.OLLAMA_API_BASE_URL) {
    console.error("\n[Agent] FATAL ERROR: No valid API providers configured (Ollama, OpenAI, Gemini).");
}

/* --- Control Exports --- */
export { setUseOnlyOpenAI, resetFailedKeys };
export function isUsingOnlyOpenAI() { return config.USE_ONLY_OPENAI; } // Simpler reading from config/state
export { getStats as getApiStats } from './balancer.js';

export function addGeminiKeys(newKeys) {
    return providerAddGeminiKeys(newKeys, failedKeys);
}

/* --- Main Logic --- */

export async function makeApiCall(prompt, history = [], expectJson = false, temperature = 0.7, maxTokens = 100, useCase = 'basic_responses') {
    const fullPrompt = `${history.join('\n')}\n\n${prompt}`;
    const maxRetries = 3;
    let lastError = null;

    // Reset per-request state
    providerState.ollamaFailed = false;
    // Log clearing handled by logger helpers

    // Select appropriate model
    const modelSelection = selectModelForUseCase(useCase, expectJson, prompt.length);

    try {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            // Check for specific model forcing
            let provider;
            if (modelSelection.preferredModel === 'llama4') {
                provider = { type: PROVIDERS.LLAMA };
            } else {
                provider = getNextProvider(useCase);
            }

            if (!provider) {
                console.error('[Agent] No available API providers');
                return createFallbackResponse(RESPONSE_MESSAGES.GENERIC_FAILURE);
            }

            const providerType = provider.type;
            const baseModel = modelSelection.preferredModel || config.OLLAMA_DEFAULT_MODEL || config.DEFAULT_MODEL;
            const modelForAttempt = normalizeModelForProvider(providerType, baseModel);

            try {
                let text;
                let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

                switch (providerType) {
                    case PROVIDERS.OLLAMA: {
                        const res = await callOllama(fullPrompt, temperature, maxTokens, modelForAttempt);
                        text = res.text;
                        usage = res.usage;
                        providerState.ollamaFailed = false;
                        trackProviderOutcome(PROVIDERS.OLLAMA, modelForAttempt, 'success');
                        break;
                    }
                    case PROVIDERS.OPENAI: {
                        const res = await callOpenAI(provider.client, modelForAttempt, fullPrompt, temperature, maxTokens, expectJson);
                        text = res.text;
                        usage = res.usage;
                        trackProviderOutcome(PROVIDERS.OPENAI, modelForAttempt, 'success');
                        break;
                    }
                    case PROVIDERS.GEMINI: {
                        const geminiClientsForAttempt = provider.clients || [];
                        if (geminiClientsForAttempt.length === 0) throw new Error('[Agent] No Gemini clients available');

                        const geminiClient = geminiClientsForAttempt[attempt % geminiClientsForAttempt.length];
                        const res = await callGemini(geminiClient, fullPrompt, temperature, maxTokens);
                        text = res.text;
                        usage = res.usage;
                        trackProviderOutcome(`${PROVIDERS.GEMINI}#${geminiClient.index}`, modelForAttempt, 'success');
                        break;
                    }
                    case PROVIDERS.LLAMA: {
                        const res = await callLlama(fullPrompt, temperature, maxTokens);
                        text = res.text;
                        usage = res.usage;
                        trackProviderOutcome(PROVIDERS.LLAMA, modelForAttempt, 'success');
                        break;
                    }
                    default:
                        throw new Error(`[Agent] Unsupported provider type: ${providerType}`);
                }

                // Log Usage
                await logUsage(providerType, modelForAttempt, useCase, usage);

                // JSON Parsing
                if (expectJson) {
                    const parsedResponse = parseJsonResponse(text, attempt, maxRetries);
                    if (parsedResponse) {
                        logProviderSummary();
                        if (typeof parsedResponse === 'object' && parsedResponse !== null) {
                            parsedResponse.model_used = modelForAttempt;
                            parsedResponse.model_provider = providerType;
                        }
                        return parsedResponse;
                    }

                    if (attempt < maxRetries) continue;

                    console.warn('[Agent] All JSON parsing attempts failed, returning raw text');
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

                // Handle Specific Provider Errors
                handleProviderError(error, providerType, provider, attempt);

                if (shouldRetryError(error, attempt, maxRetries, providerType)) {
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


/* --- Helpers --- */

function parseJsonResponse(text, attempt, maxRetries) {
    return parseJsonWithFixes(text, { logErrors: attempt === maxRetries, attempt });
}

function handleProviderError(error, providerType, provider, attempt) {
    switch (providerType) {
        case PROVIDERS.OPENAI:
            if (isKeyFailureError(error)) failedKeys.add(config.CHAT_GPT_KEY);
            break;
        case PROVIDERS.GEMINI:
            const geminiClients = provider.clients || [];
            if (geminiClients.length > 0) {
                const client = geminiClients[attempt % geminiClients.length];
                if (isKeyFailureError(error)) failedKeys.add(client.apiKey);
            }
            break;
        case PROVIDERS.OLLAMA:
            providerState.ollamaFailed = true;
            break;
        case PROVIDERS.LLAMA:
            providerState.llamaFailed = true;
            break;
    }
}

function isKeyFailureError(error) {
    const status = error.status || (error.response ? error.response.status : 500);
    const msg = error.message?.toLowerCase() || '';
    if (status === 401 || status === 403) return true;
    if (status === 404 && msg.includes('model')) return true;
    if (msg.includes('quota exceeded') || msg.includes('invalid api key') || msg.includes('billing')) return true;
    return false;
}

function shouldRetryError(error, attempt, maxRetries, providerType) {
    if (attempt >= maxRetries) return false;
    const status = error.status || (error.response ? error.response.status : 500);
    const msg = error.message?.toLowerCase() || '';

    if (providerType === 'ollama') {
        if (status >= 500 || status === 408) return true;
        return msg.includes('timeout') || msg.includes('network');
    }

    if (providerType === 'llama') {
        // Always retry Llama errors to trigger failover to backup providers
        return true;
    }

    // Allow retry on key failure (so we can switch providers)
    // if (isKeyFailureError(error)) return false; // Removed to enable failover

    if ([503, 429, 502, 504].includes(status)) return true;
    if (msg.includes('timeout') || msg.includes('network')) return true;

    return false;
}

function calculateRetryDelay(attempt) {
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
