/**
 * @fileoverview Llama Provider — AWS Bedrock Converse API
 *
 * Replaces the old Lambda/API-Gateway route that was broken.
 * Uses @aws-sdk/client-bedrock-runtime directly.
 *
 * How AWS credentials are resolved (standard SDK provider chain):
 *   1. Environment variables: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY [+ AWS_SESSION_TOKEN]
 *   2. ~/.aws/credentials file  (profile selected by AWS_PROFILE env var, default = "default")
 *   3. ECS task role / EC2 instance metadata role (for deployed environments)
 *
 * No API URL or API key is needed — the SDK handles SigV4 request signing.
 * Region is read from config.AWS_REGION (defaults to us-east-1).
 *
 * Model IDs — the "us." prefix selects on-demand cross-region inference profiles,
 * which do NOT require reserved throughput. Direct model IDs without "us." fail
 * with ValidationException unless you purchase reserved capacity.
 *
 * Model quick reference:
 *
 *   ID                                              Name              Params          Released
 *   ─────────────────────────────────────────────── ───────────────── ─────────────── ────────────
 *   us.meta.llama4-scout-17b-instruct-v1:0          Llama 4 Scout     17B active      Apr 5, 2025
 *                                                                      (109B total MoE, 16 experts)
 *   us.meta.llama4-maverick-17b-instruct-v1:0       Llama 4 Maverick  17B active      Apr 5, 2025
 *                                                                      (400B total MoE, 128 experts)
 *   us.meta.llama3-3-70b-instruct-v1:0              Llama 3.3 70B     70B dense       Dec 6, 2024
 *   us.meta.llama3-1-405b-instruct-v1:0             Llama 3.1 405B    405B dense      Jul 23, 2024
 *   mistral.mistral-large-3-675b-instruct           Mistral Large 3   ~123B dense*    Nov 2024
 *                                                   (* advertised as "675B" on Bedrock but
 *                                                      independent benchmarks suggest ~123B;
 *                                                      Meta naming inconsistency — verify before citing)
 *
 * Scout vs Maverick: both share the same 17B active parameter count per forward pass,
 * but Maverick uses 8× more experts (128 vs 16), giving it a larger effective capacity
 * and stronger reasoning at higher inference cost.
 *
 * Enable Llama 3.1 405B: AWS Console → Bedrock → Model access → Request access.
 */

import {
    BedrockRuntimeClient,
    ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import config from '../../../config.js';

// ── Model registry ────────────────────────────────────────────────────────────

export const LLAMA4_SCOUT    = 'us.meta.llama4-scout-17b-instruct-v1:0';
export const LLAMA4_MAVERICK = 'us.meta.llama4-maverick-17b-instruct-v1:0';
export const LLAMA3_70B      = 'us.meta.llama3-3-70b-instruct-v1:0';
export const LLAMA3_405B     = 'us.meta.llama3-1-405b-instruct-v1:0';
export const MISTRAL_675B    = 'mistral.mistral-large-3-675b-instruct';

// Ordered fallback list: Scout → Maverick → 3.3 70B
// 405B is NOT in the default fallback — it's expensive, use explicitly.
const FALLBACK_ORDER = [LLAMA4_SCOUT, LLAMA4_MAVERICK, LLAMA3_70B];

// ── Client (singleton per process) ───────────────────────────────────────────

let _client = null;

function getClient() {
    if (!_client) {
        _client = new BedrockRuntimeClient({
            region: config.AWS_REGION || 'us-east-1',
        });
    }
    return _client;
}

// ── Core call ────────────────────────────────────────────────────────────────

/**
 * Call Llama 4 (or fallback) on AWS Bedrock.
 *
 * @param {string} prompt
 * @param {number} temperature
 * @param {number} maxTokens
 * @param {string} [modelId] - Override model. Defaults to Llama 4 Scout.
 * @returns {Promise<{text: string, usage: {prompt_tokens, completion_tokens, total_tokens}}>}
 */
export async function callLlama(prompt, temperature, maxTokens, modelId) {
    const client = getClient();
    const modelsToTry = modelId ? [modelId] : FALLBACK_ORDER;
    let lastError = null;

    for (const model of modelsToTry) {
        try {
            const command = new ConverseCommand({
                modelId: model,
                messages: [
                    {
                        role: 'user',
                        content: [{ text: prompt }],
                    },
                ],
                inferenceConfig: {
                    maxTokens: maxTokens || 512,
                    temperature: typeof temperature === 'number' ? temperature : 0.7,
                },
            });

            const response = await client.send(command);

            const text =
                response?.output?.message?.content?.[0]?.text ?? '';

            const usage = {
                prompt_tokens:     response?.usage?.inputTokens  ?? 0,
                completion_tokens: response?.usage?.outputTokens ?? 0,
                total_tokens:      response?.usage?.totalTokens  ?? 0,
            };

            return { text, usage };

        } catch (error) {
            lastError = error;
            const code = error?.name || error?.code || '';

            // Only fall through to next model on throttling or service errors
            if (
                code === 'ThrottlingException' ||
                code === 'ServiceUnavailableException' ||
                code === 'ModelNotReadyException' ||
                (error.$metadata?.httpStatusCode ?? 0) >= 500
            ) {
                console.warn(`[Llama] ${model} unavailable (${code}), trying next model...`);
                continue;
            }

            // Fail fast on auth / validation / config errors
            throw error;
        }
    }

    throw lastError ?? new Error('[Llama] All Bedrock models failed');
}
