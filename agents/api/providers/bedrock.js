/** Amazon Bedrock Converse adapter using a Bedrock API key. */
import config from '../../../config.js';

export async function callBedrock(prompt, temperature, maxTokens) {
    const { BEDROCK_API_KEY: apiKey, BEDROCK_MODEL_ID: modelId, BEDROCK_REGION: region } = config;
    if (!apiKey || !modelId) {
        throw new Error('[Agent] Bedrock API key and model ID are required');
    }
    if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region)) {
        throw new Error('[Agent] Invalid Bedrock region');
    }

    const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            messages: [{ role: 'user', content: [{ text: prompt }] }],
            inferenceConfig: { maxTokens, temperature },
        }),
        signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
        const error = new Error(`[Agent] Bedrock request failed (${response.status})`);
        error.status = response.status;
        throw error;
    }

    const data = await response.json();
    const text = data?.output?.message?.content
        ?.filter(block => typeof block.text === 'string')
        .map(block => block.text)
        .join('');
    if (!text) {
        throw new Error('[Agent] Bedrock response contained no text');
    }

    return {
        text,
        usage: {
            prompt_tokens: data.usage?.inputTokens || 0,
            completion_tokens: data.usage?.outputTokens || 0,
            total_tokens: data.usage?.totalTokens || 0,
        },
    };
}
