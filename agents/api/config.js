/**
 * @fileoverview Configuration constants for the API Client
 */

export const MODEL_PRICING = {
    // OpenAI (Prices per 1M tokens)
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
    'gpt-4': { input: 30.00, output: 60.00 },
    'gpt-4-turbo-preview': { input: 10.00, output: 30.00 },
    'gpt-4o': { input: 5.00, output: 15.00 },
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    // Gemini (Approximate/Avg)
    'gemini-1.5-flash': { input: 0.35, output: 1.05 },
    'gemini-1.5-pro': { input: 3.50, output: 10.50 },
    'gemini-pro': { input: 0.50, output: 1.50 },
    // Ollama (Local)
    'ollama': { input: 0, output: 0 }
};

export const PROVIDERS = Object.freeze({
    OLLAMA: 'ollama',
    OPENAI: 'openai',
    GEMINI: 'gemini',
    LLAMA: 'llama',
    BEDROCK: 'bedrock',
});

export const RESPONSE_MESSAGES = Object.freeze({
    GENERIC_FAILURE: 'I hit an issue reaching our language models. Please try again soon.',
    MODEL_UNAVAILABLE: modelName => `I couldn't reach ${modelName}. Please make sure it's available and try again.`,
    NETWORK_FAILURE: 'I lost connection to our language service. Please check the network and try again.',
});
