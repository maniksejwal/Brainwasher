/**
 * @fileoverview OpenAI Provider Implementation
 */

import OpenAI from 'openai';
import config from '../../../config.js';

let openAIClient;

export function initializeOpenAI(failedKeys) {
    if (!config.CHAT_GPT_KEY) return null;

    // Don't re-init if already exists and key is valid
    if (openAIClient && !failedKeys.has(config.CHAT_GPT_KEY)) {
        return openAIClient;
    }

    try {
        openAIClient = new OpenAI({ apiKey: config.CHAT_GPT_KEY });
        console.log('[Agent] OpenAI client initialized.');
        return openAIClient;
    } catch (error) {
        console.error('[Agent] Error initializing OpenAI client:', error.message);
        failedKeys.add(config.CHAT_GPT_KEY);
        return null;
    }
}

export function getOpenAIClient() {
    return openAIClient;
}

export async function callOpenAI(client, model, prompt, temperature, maxTokens, expectJson = false) {
    const requestBody = {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: maxTokens,
    };

    if (expectJson) {
        requestBody.response_format = { type: 'json_object' };
    }

    const completion = await client.chat.completions.create(requestBody);
    const text = completion.choices[0].message.content;

    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    if (completion.usage) {
        usage = {
            prompt_tokens: completion.usage.prompt_tokens,
            completion_tokens: completion.usage.completion_tokens,
            total_tokens: completion.usage.total_tokens
        };
    }

    return { text, usage };
}
