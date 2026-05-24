/**
 * @fileoverview Verification script for Llama 4 via AWS Bedrock
 *
 * Tests the new direct Bedrock integration that replaced the old Lambda endpoint.
 *
 * Usage:
 *   node tests/verification/verify_llama_api.js
 *
 * Requires AWS credentials in environment or ~/.aws/credentials.
 */

import { callLlama } from '../../agents/api/providers/llama.js';
import { makeApiCall } from '../../agents/api_client.js';

async function testLlamaIntegration() {
    console.log('Testing Llama 4 via AWS Bedrock...\n');

    // ── Test 1: Direct provider call ─────────────────────────────────────────
    console.log('Test 1: Direct callLlama() → Bedrock Converse API');
    try {
        const { text, usage } = await callLlama(
            'In one sentence, what is HRV?',
            0.5,
            80
        );
        console.log(`  OK — response: "${text.substring(0, 120)}"`);
        console.log(`  Tokens: ${usage.prompt_tokens} in / ${usage.completion_tokens} out`);
    } catch (err) {
        console.error(`  FAIL: ${err.message}`);
    }

    console.log('');

    // ── Test 2: Full stack through makeApiCall ────────────────────────────────
    console.log('Test 2: makeApiCall() with useCase=conversational_agent (should route to Llama)');
    try {
        const result = await makeApiCall(
            'Reply with exactly three words: healthy, calm, focused.',
            [],
            false,
            0.3,
            20,
            'conversational_agent'
        );
        console.log(`  OK — reply: "${result.reply?.substring(0, 120)}"`);
        console.log(`  Provider: ${result.modelProvider}, Model: ${result.modelUsed}`);
    } catch (err) {
        console.error(`  FAIL: ${err.message}`);
    }
}

testLlamaIntegration().catch(console.error);
