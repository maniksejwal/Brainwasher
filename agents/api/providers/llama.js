/**
 * @fileoverview Llama 4 Provider Implementation
 */

import config from '../../../config.js';
import { postJson } from './utils.js';

export async function callLlama(prompt, temperature, maxTokens) {
    if (!config.LLAMA_API_URL) {
        throw new Error('[Agent] Llama API URL not configured');
    }

    try {
        // Use shared utility for consistent error handling and fetch logic
        const data = await postJson(
            config.LLAMA_API_URL,
            {
                prompt: prompt,
                max_new_tokens: maxTokens,
                temperature: temperature
            },
            {
                apiKey: config.LLAMA_API_KEY // Optional: safe if undefined
            }
        );

        // Adjust based on actual API response format (assuming { generated_text: "..." } or similar)
        const text = data.generated_text || data.response || (data[0] && data[0].generated_text) || "";

        // Rough usage estimate (chars / 4)
        const usage = {
            prompt_tokens: Math.ceil(prompt.length / 4),
            completion_tokens: Math.ceil(text.length / 4),
            total_tokens: Math.ceil((prompt.length + text.length) / 4)
        };

        return { text, usage };
    } catch (error) {
        console.error('[Agent] Error calling Llama 4:', error.message);
        throw error;
    }
}
