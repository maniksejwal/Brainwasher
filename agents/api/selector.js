/**
 * @fileoverview Model Selection Logic
 */

import config from '../../config.js';
import { PROVIDERS } from './config.js';

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

export function selectModelForUseCase(useCase, expectJson, promptLength) {
    // This chooses prompt/model preferences; provider priority is set by the balancer.
    if (config.USE_LLAMA_FOR_ALL) {
        // TODO: Remove this global override and configure models individually in config.js
        return {
            preferredModel: 'llama4',
            fallbackModel: config.FALLBACK_MODEL,
            reason: 'Global Llama 4 Override'
        };
    }

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

export function normalizeModelForProvider(providerType, desiredModel) {
    switch (providerType) {
        case PROVIDERS.OPENAI:
            return OPENAI_MODELS.has(desiredModel) ? desiredModel : config.OPENAI_MODEL;
        case PROVIDERS.GEMINI:
            return desiredModel?.toLowerCase().includes('gemini')
                ? desiredModel
                : config.GEMINI_MODEL;
        case PROVIDERS.OLLAMA:
            return desiredModel === 'llama4' || desiredModel?.toLowerCase().startsWith('gpt-')
                ? (config.OLLAMA_DEFAULT_MODEL || config.DEFAULT_MODEL)
                : desiredModel;
        case PROVIDERS.LLAMA:
            return 'llama4';
        case PROVIDERS.BEDROCK:
            return config.BEDROCK_MODEL_ID;
        default:
            return desiredModel;
    }
}
