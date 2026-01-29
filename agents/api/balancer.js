/**
 * @fileoverview Load Balancer and State Management
 */

import config from '../../config.js';
import { PROVIDERS } from './config.js';
import { isOllamaAvailable } from './providers/ollama.js';
import { getGeminiClients } from './providers/gemini.js';
import { getOpenAIClient } from './providers/openai.js';

export let failedKeys = new Set();
export let useOnlyOpenAI = config.USE_ONLY_OPENAI ?? false;
let requestCounter = 0;

export const providerState = {
    ollamaFailed: false,
};

export function setUseOnlyOpenAI(val) {
    useOnlyOpenAI = val;
    console.log(`[Agent] ${val ? 'Using OpenAI only' : 'Using round-robin load balancing'}`);
}

export function resetFailedKeys() {
    failedKeys.clear();
    providerState.ollamaFailed = false;
    console.log('[Agent] Failed keys reset - all providers available again');
}

export function getNextProvider(useCase = 'basic_responses') {
    if (useOnlyOpenAI) {
        const client = getOpenAIClient();
        if (client && !failedKeys.has(config.CHAT_GPT_KEY)) {
            return { type: PROVIDERS.OPENAI, client };
        }
        return null;
    }

    const availableProviders = [];

    if (isOllamaAvailable(providerState)) {
        availableProviders.push({ type: PROVIDERS.OLLAMA });
    }

    // Add Llama 4 if configured
    if (config.LLAMA_API_URL) {
        availableProviders.push({ type: PROVIDERS.LLAMA });
    }

    // Add Gemini clients that haven't failed
    const geminiClients = getGeminiClients();
    const workingGeminiClients = geminiClients.filter(gc => !failedKeys.has(gc.apiKey));
    if (workingGeminiClients.length > 0) {
        availableProviders.push({ type: PROVIDERS.GEMINI, clients: workingGeminiClients });
    }

    // Add OpenAI if available and not failed
    const openAIClient = getOpenAIClient();
    if (openAIClient && !failedKeys.has(config.CHAT_GPT_KEY)) {
        availableProviders.push({ type: PROVIDERS.OPENAI, client: openAIClient });
    }

    if (availableProviders.length === 0) {
        return null;
    }

    // Round-robin
    const provider = availableProviders[requestCounter % availableProviders.length];
    requestCounter++;

    return provider;
}

export function getStats() {
    const geminiClients = getGeminiClients();
    const workingGeminiClients = geminiClients.filter(gc => !failedKeys.has(gc.apiKey));
    const openAIClient = getOpenAIClient();
    const workingOpenAI = openAIClient && !failedKeys.has(config.CHAT_GPT_KEY);
    const workingOllama = isOllamaAvailable(providerState) ? 1 : 0;

    let nextProviderType = 'none';
    const previewProvider = getNextProvider();
    if (previewProvider) {
        nextProviderType = previewProvider.type;
        requestCounter = Math.max(0, requestCounter - 1); // undo increment from preview
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
