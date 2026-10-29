import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../config.js';
import { getNextProvider, failedKeys, resetFailedKeys } from '../agents/api/balancer.js';
import { initializeOpenAI } from '../agents/api/providers/openai.js';
import { initializeGemini } from '../agents/api/providers/gemini.js';
import { PROVIDERS } from '../agents/api/config.js';
import { callBedrock } from '../agents/api/providers/bedrock.js';
import { makeApiCall } from '../agents/api/index.js';

test('provider selection skips missing keys and follows the fallback order', () => {
    resetFailedKeys();
    config.LLAMA_API_URL = 'https://example.invalid/llama';
    config.LLAMA_API_KEY = 'example-llama-key';
    config.BEDROCK_API_KEY = 'example-bedrock-key';
    config.BEDROCK_MODEL_ID = 'example.model-v1:0';
    config.CHAT_GPT_KEY = 'example-openai-key';
    config.GEMINI_API_KEYS = ['example-gemini-key'];
    initializeOpenAI(failedKeys);
    initializeGemini(failedKeys);

    const excluded = new Set();
    for (const expected of [PROVIDERS.LLAMA, PROVIDERS.BEDROCK, PROVIDERS.OPENAI, PROVIDERS.GEMINI]) {
        assert.equal(getNextProvider('basic_responses', excluded)?.type, expected);
        excluded.add(expected);
    }

    config.LLAMA_API_KEY = '';
    assert.equal(getNextProvider()?.type, PROVIDERS.BEDROCK);
    config.BEDROCK_API_KEY = '';
    assert.equal(getNextProvider()?.type, PROVIDERS.OPENAI);
    config.CHAT_GPT_KEY = '';
    assert.equal(getNextProvider()?.type, PROVIDERS.GEMINI);
    failedKeys.add('example-gemini-key');
    assert.notEqual(getNextProvider()?.type, PROVIDERS.GEMINI);
});

test('Bedrock adapter sends a Converse request and maps the response', async () => {
    config.BEDROCK_API_KEY = 'example-bedrock-key';
    config.BEDROCK_MODEL_ID = 'example.model-v1:0';
    config.BEDROCK_REGION = 'ap-south-1';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://bedrock-runtime.ap-south-1.amazonaws.com/model/example.model-v1%3A0/converse');
        assert.equal(options.headers.Authorization, 'Bearer example-bedrock-key');
        assert.deepEqual(JSON.parse(options.body), {
            messages: [{ role: 'user', content: [{ text: 'Hello' }] }],
            inferenceConfig: { maxTokens: 100, temperature: 0.2 },
        });
        return {
            ok: true,
            json: async () => ({
                output: { message: { content: [{ text: 'Hi' }] } },
                usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
            }),
        };
    };
    try {
        assert.deepEqual(await callBedrock('Hello', 0.2, 100), {
            text: 'Hi',
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        });
        config.BEDROCK_API_KEY = '';
        await assert.rejects(callBedrock('Hello', 0.2, 100), /key and model ID are required/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('a failed Llama request falls back to Bedrock', async () => {
    resetFailedKeys();
    config.LLAMA_API_URL = 'https://example.invalid/llama';
    config.LLAMA_API_KEY = 'example-llama-key';
    config.BEDROCK_API_KEY = 'example-bedrock-key';
    config.BEDROCK_MODEL_ID = 'example.model-v1:0';
    config.BEDROCK_REGION = 'ap-south-1';
    config.CHAT_GPT_KEY = '';
    config.GEMINI_API_KEYS = [];
    config.OLLAMA_API_BASE_URL = '';
    const urls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        urls.push(url);
        if (url === config.LLAMA_API_URL) {
            return { ok: false, status: 503, text: async () => 'unavailable' };
        }
        return {
            ok: true,
            json: async () => ({ output: { message: { content: [{ text: 'Bedrock reply' }] } } }),
        };
    };
    try {
        const result = await makeApiCall('Hello');
        assert.equal(result.reply, 'Bedrock reply');
        assert.equal(result.modelProvider, PROVIDERS.BEDROCK);
        assert.equal(urls.length, 6);
        assert.deepEqual(urls.slice(0, 5), Array(5).fill(config.LLAMA_API_URL));
        assert.match(urls[5], /^https:\/\/bedrock-runtime\.ap-south-1\.amazonaws\.com\//);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('a failed Bedrock request falls back to OpenAI', async () => {
    resetFailedKeys();
    config.LLAMA_API_KEY = '';
    config.BEDROCK_API_KEY = 'example-bedrock-key';
    config.BEDROCK_MODEL_ID = 'example.model-v1:0';
    config.CHAT_GPT_KEY = 'example-openai-key';
    config.GEMINI_API_KEYS = [];
    config.OLLAMA_API_BASE_URL = '';
    const client = initializeOpenAI(failedKeys);
    const originalCreate = client.chat.completions.create;
    const originalFetch = globalThis.fetch;
    client.chat.completions.create = async () => ({
        choices: [{ message: { content: 'OpenAI reply' } }],
    });
    let bedrockCalls = 0;
    globalThis.fetch = async () => {
        bedrockCalls++;
        return { ok: false, status: 401 };
    };
    try {
        const result = await makeApiCall('Hello');
        assert.equal(result.reply, 'OpenAI reply');
        assert.equal(result.modelProvider, PROVIDERS.OPENAI);
        assert.equal(bedrockCalls, 1);
    } finally {
        client.chat.completions.create = originalCreate;
        globalThis.fetch = originalFetch;
    }
});

function useBedrockOnly() {
    resetFailedKeys();
    config.LLAMA_API_KEY = '';
    config.BEDROCK_API_KEY = 'example-bedrock-key';
    config.BEDROCK_MODEL_ID = 'example.model-v1:0';
    config.CHAT_GPT_KEY = '';
    config.GEMINI_API_KEYS = [];
    config.OLLAMA_API_BASE_URL = '';
    initializeOpenAI(failedKeys);
    initializeGemini(failedKeys);
}

test('JSON calls default to a larger token limit than plain replies', async () => {
    useBedrockOnly();
    const sentMaxTokens = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        sentMaxTokens.push(JSON.parse(options.body).inferenceConfig.maxTokens);
        return { ok: true, json: async () => ({ output: { message: { content: [{ text: '{"ok": true}' }] } } }) };
    };
    try {
        await makeApiCall('Hello', [], true);
        await makeApiCall('Hello', [], false);
        await makeApiCall('Hello', [], true, 0.7, 300);
        assert.deepEqual(sentMaxTokens, [1000, 100, 300]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('the response after all providers fail is flagged as a fallback', async () => {
    useBedrockOnly();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 401 });
    try {
        const result = await makeApiCall('Hello', [], true);
        assert.equal(result.isFallback, true);
        assert.equal(result.criticality, 'NONE');
    } finally {
        globalThis.fetch = originalFetch;
    }
});
