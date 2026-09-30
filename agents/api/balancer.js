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
export function recordRequest() { requestCounter++; }

export const providerState = {
    ollamaFailed: false,
    llamaFailed: false,
    bedrockFailed: false,
};

export function setUseOnlyOpenAI(val) {
    useOnlyOpenAI = val;
    console.log(`[Agent] ${val ? 'Using OpenAI preference' : 'Using provider fallback order'}`);
}

export function resetFailedKeys() {
    failedKeys.clear();
    providerState.ollamaFailed = false;
    providerState.llamaFailed = false;
    providerState.bedrockFailed = false;
    console.log('[Agent] Failed keys reset - all providers available again');
}

export function getNextProvider(useCase = 'basic_responses', excluded = new Set()) {
    if (useOnlyOpenAI) {
        const client = getOpenAIClient();
        if (config.CHAT_GPT_KEY && client && !failedKeys.has(config.CHAT_GPT_KEY) && !excluded.has(PROVIDERS.OPENAI)) {
            return { type: PROVIDERS.OPENAI, client };
        }
    }

    // Skip remote providers without credentials; try each in priority order.
    if (config.LLAMA_API_URL && config.LLAMA_API_KEY && !providerState.llamaFailed && !excluded.has(PROVIDERS.LLAMA)) {
        return { type: PROVIDERS.LLAMA };
    }
    if (config.BEDROCK_API_KEY && config.BEDROCK_MODEL_ID && !providerState.bedrockFailed && !excluded.has(PROVIDERS.BEDROCK)) {
        return { type: PROVIDERS.BEDROCK };
    }

    const openAIClient = getOpenAIClient();
    if (config.CHAT_GPT_KEY && openAIClient && !failedKeys.has(config.CHAT_GPT_KEY) && !excluded.has(PROVIDERS.OPENAI)) {
        return { type: PROVIDERS.OPENAI, client: openAIClient };
    }
    const workingGeminiClients = getGeminiClients().filter(gc => gc.apiKey && !failedKeys.has(gc.apiKey));
    if (workingGeminiClients.length > 0 && !excluded.has(PROVIDERS.GEMINI)) {
        return { type: PROVIDERS.GEMINI, clients: workingGeminiClients };
    }
    if (isOllamaAvailable(providerState) && !excluded.has(PROVIDERS.OLLAMA)) {
        return { type: PROVIDERS.OLLAMA };
    }
    return null;
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
    }

    return {
        totalRequests: requestCounter,
        workingProviders: {
            ollama: workingOllama,
            gemini: workingGeminiClients.length,
            openai: workingOpenAI ? 1 : 0,
            bedrock: config.BEDROCK_API_KEY && config.BEDROCK_MODEL_ID && !providerState.bedrockFailed ? 1 : 0,
            llama: config.LLAMA_API_URL && config.LLAMA_API_KEY && !providerState.llamaFailed ? 1 : 0
        },
        failedKeyCount: failedKeys.size,
        nextProvider: nextProviderType
    };
}
