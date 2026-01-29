/**
 * @fileoverview Ollama Provider Implementation
 */

import config from '../../../config.js';

import { postJson } from './utils.js';

export function isOllamaAvailable(providerState) {
    return Boolean(config.OLLAMA_API_BASE_URL) && !providerState.ollamaFailed;
}

export async function callOllama(prompt, temperature, maxTokens, model) {
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

    try {
        const data = await postJson(`${config.OLLAMA_API_BASE_URL}/generate`, requestBody);

        if (typeof data?.response !== 'string') {
            throw new Error('[Agent] Ollama response missing "response" field');
        }

        // Standardize usage
        const usage = {
            prompt_tokens: data.prompt_eval_count || 0,
            completion_tokens: data.eval_count || 0,
            total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
        };

        return { text: data.response, usage };
    } catch (error) {
        const errorText = error.message || 'Unknown Ollama error';
        const newError = new Error(`[Agent] Ollama request failed: ${errorText}`);
        newError.status = error.status;
        throw newError;
    }
}
