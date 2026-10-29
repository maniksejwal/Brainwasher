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
    recordRequest,
    setUseOnlyOpenAI,
    failedKeys as publicFailedKeys, // Re-export as read-only or setter
    resetFailedKeys
} from './balancer.js';

// Providers
import { initializeOpenAI, callOpenAI } from './providers/openai.js';
import { initializeGemini, callGemini, addGeminiKeys as providerAddGeminiKeys } from './providers/gemini.js';
import { callOllama } from './providers/ollama.js';
import { callLlama } from './providers/llama.js';
import { callBedrock } from './providers/bedrock.js';

// Initialization
initializeOpenAI(failedKeys);
initializeGemini(failedKeys);

if (!getNextProvider()) {
    console.error("\n[Agent] No AI provider configured with the required credentials.");
}

/* --- Control Exports --- */
export { setUseOnlyOpenAI, resetFailedKeys };
export function isUsingOnlyOpenAI() { return config.USE_ONLY_OPENAI; } // Simpler reading from config/state
export { getStats as getApiStats } from './balancer.js';

export function addGeminiKeys(newKeys) {
    return providerAddGeminiKeys(newKeys, failedKeys);
}

/* --- Main Logic --- */

// JSON responses (e.g. clinical assessment) run ~250+ tokens; 100 truncated them into invalid JSON
const DEFAULT_MAX_TOKENS = 100;
const DEFAULT_JSON_MAX_TOKENS = 1000;

export async function makeApiCall(prompt, history = [], expectJson = false, temperature = 0.7, maxTokens = undefined, useCase = 'basic_responses') {
    maxTokens ??= expectJson ? DEFAULT_JSON_MAX_TOKENS : DEFAULT_MAX_TOKENS;
    const fullPrompt = `${history.join('\n')}\n\n${prompt}`;
    const maxProviders = 5;
    const maxRetries = 5;
    let lastError = null;
    const attemptedProviders = new Set();
    recordRequest();

    // Reset per-request state
    providerState.ollamaFailed = false;
    // Log clearing handled by logger helpers

    // Select appropriate model
    const modelSelection = selectModelForUseCase(useCase, expectJson, prompt.length);

    try {
        for (let providerAttempt = 1; providerAttempt <= maxProviders; providerAttempt++) {
            const provider = getNextProvider(useCase, attemptedProviders);

            if (!provider) {
                console.error('[Agent] No available API providers');
                return createFallbackResponse(RESPONSE_MESSAGES.GENERIC_FAILURE);
            }

            const providerType = provider.type;
            const baseModel = modelSelection.preferredModel || config.OLLAMA_DEFAULT_MODEL || config.DEFAULT_MODEL;
            const modelForAttempt = normalizeModelForProvider(providerType, baseModel);

            for (let retry = 1; retry <= maxRetries; retry++) {
            try {
                let text;
                let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

                switch (providerType) {
                    case PROVIDERS.OLLAMA: {
                        const res = await callOllama(fullPrompt, temperature, maxTokens, modelForAttempt);
                        text = res.text;
                        usage = res.usage;
                        providerState.ollamaFailed = false;
                        break;
                    }
                    case PROVIDERS.OPENAI: {
                        const res = await callOpenAI(provider.client, modelForAttempt, fullPrompt, temperature, maxTokens, expectJson);
                        text = res.text;
                        usage = res.usage;
                        break;
                    }
                    case PROVIDERS.GEMINI: {
                        const geminiClientsForAttempt = provider.clients || [];
                        if (geminiClientsForAttempt.length === 0) throw new Error('[Agent] No Gemini clients available');

                        const geminiClient = geminiClientsForAttempt[(retry - 1) % geminiClientsForAttempt.length];
                        const res = await callGemini(geminiClient, fullPrompt, temperature, maxTokens);
                        text = res.text;
                        usage = res.usage;
                        break;
                    }
                    case PROVIDERS.LLAMA: {
                        const res = await callLlama(fullPrompt, temperature, maxTokens);
                        text = res.text;
                        usage = res.usage;
                        break;
                    }
                    case PROVIDERS.BEDROCK: {
                        const res = await callBedrock(fullPrompt, temperature, maxTokens);
                        text = res.text;
                        usage = res.usage;
                        break;
                    }
                    default:
                        throw new Error(`[Agent] Unsupported provider type: ${providerType}`);
                }

                // Log Usage
                await logUsage(providerType, modelForAttempt, useCase, usage);

                // JSON Parsing
                if (expectJson) {
                    const parsedResponse = parseJsonResponse(text, retry, maxRetries);
                    if (parsedResponse) {
                        trackProviderOutcome(providerType, modelForAttempt, 'success');
                        logProviderSummary();
                        if (typeof parsedResponse === 'object' && parsedResponse !== null) {
                            parsedResponse.model_used = modelForAttempt;
                            parsedResponse.model_provider = providerType;
                        }
                        return parsedResponse;
                    }

                    trackProviderOutcome(providerType, modelForAttempt, 'failure', 'invalid JSON response');
                    if (retry < maxRetries) {
                        await retryDelay(retry);
                        continue;
                    }
                    attemptedProviders.add(providerType);
                    break;
                }

                trackProviderOutcome(providerType, modelForAttempt, 'success');
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

                if (retry < maxRetries && shouldRetryError(error)) {
                    await retryDelay(retry);
                    continue;
                }
                handleProviderError(error, providerType, provider, retry);
                attemptedProviders.add(providerType);
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
        providerState.llamaFailed = false;
        providerState.bedrockFailed = false;
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
                const client = geminiClients[(attempt - 1) % geminiClients.length];
                if (isKeyFailureError(error)) failedKeys.add(client.apiKey);
            }
            break;
        case PROVIDERS.OLLAMA:
            providerState.ollamaFailed = true;
            break;
        case PROVIDERS.LLAMA:
            providerState.llamaFailed = true;
            break;
        case PROVIDERS.BEDROCK:
            providerState.bedrockFailed = true;
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

function shouldRetryError(error) {
    if (isKeyFailureError(error)) return false;
    const status = error.status || error.response?.status;
    const message = error.message?.toLowerCase() || '';
    return status === 408 || status === 429 || status >= 500 ||
        message.includes('timeout') || message.includes('network') || message.includes('fetch failed');
}

async function retryDelay(retry) {
    await new Promise(resolve => setTimeout(resolve, Math.min(500 * 2 ** (retry - 1), 2000)));
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
        sharingSuggestion: null,
        // Lets callers tell a failed LLM call apart from a genuine NONE/default answer
        isFallback: true
    };
}
