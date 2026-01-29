/**
 * @fileoverview API Client Logging Logic
 */

import { logApiUsage } from '../../db/index.js';
import { MODEL_PRICING } from './config.js';

export const providerLogs = {
    success: [],
    failure: [],
};

export function trackProviderOutcome(type, model, status, detail = '') {
    const entry = `${type}:${model}${detail ? ` (${detail})` : ''}`;
    if (status === 'success') {
        providerLogs.success.push(entry);
    } else {
        providerLogs.failure.push(entry);
    }
}

export function logProviderSummary() {
    if (providerLogs.success.length > 0) {
        console.info(`[Agent] Providers succeeded: ${providerLogs.success.join(', ')}`);
    }
    if (providerLogs.failure.length > 0) {
        console.warn(`[Agent] Providers failed: ${providerLogs.failure.join(', ')}`);
    }
    // Clear logs after summary
    providerLogs.success = [];
    providerLogs.failure = [];
}

export function calculateCost(model, promptTokens, completionTokens) {
    // Find matching model key (partial match support)
    const pricingKey = Object.keys(MODEL_PRICING).find(k => model.includes(k)) || 'gpt-3.5-turbo';
    const pricing = MODEL_PRICING[pricingKey] || MODEL_PRICING['gpt-3.5-turbo'];

    const inputCost = (promptTokens / 1_000_000) * pricing.input;
    const outputCost = (completionTokens / 1_000_000) * pricing.output;

    return inputCost + outputCost;
}

export async function logUsage(providerType, model, useCase, usage) {
    if (usage.total_tokens > 0) {
        const cost = calculateCost(model, usage.prompt_tokens, usage.completion_tokens);
        try {
            await logApiUsage(
                providerType,
                model,
                useCase,
                usage.prompt_tokens,
                usage.completion_tokens,
                usage.total_tokens,
                cost
            );
        } catch (e) {
            console.error('[Agent] Failed to log API usage:', e.message);
        }
    }
}
